const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("../lib/asyncArray.js");
// Préparation des bons de commande MP — regroupement des besoins de plusieurs productions.
//
// CE MODULE NE FAIT QUE LIRE. Il ne contient pas une seule écriture, pas même dans ses propres
// tables : son rôle est de proposer, celui de bcMp.js est d'enregistrer. La séparation n'est pas
// cosmétique — elle permet d'ouvrir l'écran de préparation, d'y jouer avec les quantités et de
// le refermer sans que rien n'ait bougé en base.
//
// Il ne refait AUCUN calcul de besoin : il appelle calculerPourCommande, exactement comme l'écran
// des besoins. Réécrire ici une règle de consommation, de perte ou de rapprochement d'achat
// serait la garantie que les deux écrans finissent par annoncer des chiffres différents.
//
// Ce qu'il ajoute, et qui n'existait nulle part : le regroupement INTER-PRODUCTIONS. Trois
// commandes qui consomment le même sergé noir donnent une seule ligne d'achat, avec le détail de
// ce que chaque production doit recevoir.

const { calculerPourCommande } = require("./besoins");

const EPSILON = 0.0001;

function arrondir(v) {
  return Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;
}

function normaliser(v) {
  return String(v == null ? "" : v)
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .trim().toLowerCase();
}

// ------------------------------------------------------------------------------------------------
// Unité d'achat
// ------------------------------------------------------------------------------------------------
// Les achats n'acceptent que kg, m, piece et lot (contrainte du schéma). L'unité de la fiche, elle,
// est du texte libre pour les fournitures : « pièce », « paire », « bobine », « jeu »…
//
// Seules les équivalences CERTAINES sont traduites. Une bobine n'est pas une pièce, une paire non
// plus : deviner reviendrait à commander la mauvaise quantité sans que rien ne le signale. Dans le
// doute, l'unité reste à choisir, et l'écran le demande.
const EQUIVALENCES_UNITE = {
  "kg": "kg", "kilo": "kg", "kilos": "kg", "kilogramme": "kg", "kilogrammes": "kg",
  "m": "m", "metre": "m", "metres": "m", "ml": "m", "metre lineaire": "m",
  "piece": "piece", "pieces": "piece", "pce": "piece", "pcs": "piece", "pc": "piece", "u": "piece", "unite": "piece",
  "lot": "lot", "lots": "lot",
};

function deduireUniteAchat(uniteFiche) {
  return EQUIVALENCES_UNITE[normaliser(uniteFiche)] || null;
}

// ------------------------------------------------------------------------------------------------
// Conditionnement : proposer, jamais imposer
// ------------------------------------------------------------------------------------------------
/**
 * Votre décision : l'arrondi au conditionnement entier est FACULTATIF, avec proposition
 * automatique. Cette fonction ne fait donc que calculer la proposition — rien ici ne l'applique.
 *
 * 1 460 m à commander en rouleaux de 100 m : 14,6 rouleaux, proposition 15 rouleaux = 1 500 m.
 * Un fournisseur qui accepte un demi-rouleau reste servi par 14,6, et c'est à vous d'en décider.
 */
function proposerConditionnement(quantite, tailleConditionnement) {
  const q = Number(quantite);
  const taille = Number(tailleConditionnement);
  if (!(q > 0) || !(taille > 0)) return null;
  const exact = q / taille;
  const arrondiSup = Math.ceil(exact - EPSILON);
  return {
    nombre_exact: arrondir(exact),
    nombre_arrondi: arrondiSup,
    quantite_arrondie: arrondir(arrondiSup * taille),
    supplement: arrondir(arrondiSup * taille - q),
    deja_juste: Math.abs(arrondiSup - exact) < EPSILON,
  };
}

// ------------------------------------------------------------------------------------------------
// Fournisseurs proposés
// ------------------------------------------------------------------------------------------------
/**
 * Deux sources, dans cet ordre de confiance :
 *   1. `prix_fournisseurs` — un tarif saisi, encore valide aujourd'hui. Il porte un prix.
 *   2. l'historique de `achats` — un fournisseur chez qui ce composant a déjà été acheté. Il ne
 *      porte PAS de prix : un montant engagé divisé par une quantité donnerait un prix unitaire
 *      reconstitué, qui peut inclure du transport ou une remise. Un prix inventé serait pire que
 *      pas de prix, puisqu'il se laisserait valider sans qu'on le relise.
 *
 * LECTURE SEULE sur les deux tables, et aucune autre table financière n'est touchée.
 */
async function fournisseursProposes(db, type, catalogueId) {
  if (!catalogueId) return [];
  const colonne = type === "matiere" ? "matiere_catalogue_id" : "accessoire_catalogue_id";

  const tarifs = await db.prepare(`
    SELECT p.fournisseur_id, f.nom AS fournisseur_nom, p.prix_ht, p.unite, p.date_debut_validite
      FROM prix_fournisseurs p
      JOIN fournisseurs f ON f.id = p.fournisseur_id
     WHERE p.${colonne} = ?
       AND (p.date_fin_validite IS NULL OR p.date_fin_validite >= aujourdhui())
       AND f.actif = 1
     ORDER BY p.date_debut_validite DESC, p.id DESC
  `).all(catalogueId);

  const historique = (await colonneExiste(db, "achats", colonne)) ? await db.prepare(`
    SELECT a.fournisseur_id, f.nom AS fournisseur_nom,
           MAX(COALESCE(a.date_engagement, a.created_at)) AS derniere_fois,
           COUNT(*) AS nb_achats
      FROM achats a
      JOIN fournisseurs f ON f.id = a.fournisseur_id
     WHERE a.${colonne} = ? AND f.actif = 1
     GROUP BY a.fournisseur_id, f.nom
     ORDER BY derniere_fois DESC
  `).all(catalogueId) : [];

  const parFournisseur = new Map();
  tarifs.forEach((t) => {
    if (parFournisseur.has(t.fournisseur_id)) return;   // le tarif le plus récent gagne
    parFournisseur.set(t.fournisseur_id, {
      fournisseur_id: t.fournisseur_id,
      fournisseur_nom: t.fournisseur_nom,
      prix_ht: t.prix_ht,
      unite_tarif: t.unite,
      depuis: t.date_debut_validite,
      origine: "tarif",
      nb_achats: 0,
    });
  });
  historique.forEach((h) => {
    const connu = parFournisseur.get(h.fournisseur_id);
    if (connu) { connu.nb_achats = h.nb_achats; connu.derniere_fois = h.derniere_fois; return; }
    parFournisseur.set(h.fournisseur_id, {
      fournisseur_id: h.fournisseur_id,
      fournisseur_nom: h.fournisseur_nom,
      prix_ht: null,
      unite_tarif: null,
      derniere_fois: h.derniere_fois,
      origine: "historique",
      nb_achats: h.nb_achats,
    });
  });

  // Un tarif saisi passe devant un simple historique ; à origine égale, le plus utilisé d'abord.
  return Array.from(parFournisseur.values()).sort((a, b) => {
    if (a.origine !== b.origine) return a.origine === "tarif" ? -1 : 1;
    return (b.nb_achats || 0) - (a.nb_achats || 0);
  });
}

async function colonneExiste(db, table, colonne) {
  try {
    return (await db.colonnes(table)).some((c) => c.name === colonne);
  } catch (_) { return false; }
}

// ------------------------------------------------------------------------------------------------
// Le regroupement
// ------------------------------------------------------------------------------------------------
/**
 * Clé de regroupement : type, composant du catalogue, cible (le coloris), unité de la fiche.
 *
 * Le composant est identifié par son identifiant de CATALOGUE, jamais par sa désignation : deux
 * fiches peuvent nommer « Sergé » et « Sergé polyester » la même matière. Un composant non relié
 * au catalogue ne peut pas être regroupé en confiance — il reçoit une clé qui lui est propre, et
 * la ligne est signalée.
 *
 * L'unité de la fiche entre dans la clé : additionner des mètres et des kilos d'une même matière
 * donnerait un nombre qui ne veut rien dire.
 */
function cleRegroupement(ligne) {
  const composant = ligne.catalogue_id != null
    ? "cat:" + ligne.catalogue_id
    : "nom:" + normaliser(ligne.composant_nom);
  return [ligne.type, composant, ligne.cible_cle, normaliser(ligne.unite)].join("|");
}

/**
 * Regroupe les besoins de plusieurs productions en lignes d'achat candidates.
 *
 * @param {Array<number>} commandeIds   les productions à servir
 * @returns {{ productions, lignes, totaux, erreurs }}
 */
async function regrouper(db, commandeIds) {
  const ids = (Array.isArray(commandeIds) ? commandeIds : [])
    .map((v) => Number(v)).filter((v) => Number.isFinite(v));
  const uniques = Array.from(new Set(ids));

  const productions = [];
  const erreurs = [];
  const groupes = new Map();

  for (const commandeId of uniques) {
    let resultat;
    try {
      resultat = await calculerPourCommande(db, commandeId);
    } catch (err) {
      erreurs.push({ commande_id: commandeId, message: err.message });
      continue;
    }

    productions.push({
      commande_id: commandeId,
      numero: resultat.commande ? resultat.commande.numero : null,
      statut: resultat.commande ? resultat.commande.statut : null,
      article_designation: resultat.article ? resultat.article.designation : null,
      reference: resultat.article ? resultat.article.reference : null,
      quantite_totale: resultat.commande ? resultat.commande.quantite_totale : null,
      date_fin_prevue: resultat.commande ? resultat.commande.date_fin_prevue : null,
      // L'état de la recette est repris tel quel : préparer un bon sur une production dont la
      // recette est figée sur une ancienne révision doit se voir ici aussi, pas seulement dans
      // l'écran des besoins.
      recette: resultat.recette || null,
      nb_lignes: resultat.lignes.length,
    });

    resultat.lignes.forEach((l) => {
      const cle = cleRegroupement(l);
      if (!groupes.has(cle)) {
        groupes.set(cle, {
          cle,
          type: l.type,
          catalogue_id: l.catalogue_id,
          catalogue_non_relie: l.catalogue_id == null,
          designation: l.composant_nom,
          cible_cle: l.cible_cle,
          cible_libelle: l.cible_libelle,
          reference: l.reference || null,
          unite_fiche: l.unite || null,
          unite: deduireUniteAchat(l.unite),
          anomalies: [],
          productions: [],
          quantite_necessaire: 0,
          quantite_commandee: 0,
          quantite_en_preparation: 0,
          reste_a_commander: 0,
          reste_a_preparer: 0,
          quantite_inconnue: false,
        });
      }
      const g = groupes.get(cle);

      g.quantite_necessaire = arrondir(g.quantite_necessaire + (Number(l.quantite_necessaire) || 0));
      g.quantite_commandee = arrondir(g.quantite_commandee + (Number(l.quantite_commandee) || 0));
      g.quantite_en_preparation = arrondir(g.quantite_en_preparation + (Number(l.quantite_en_preparation) || 0));
      g.reste_a_commander = arrondir(g.reste_a_commander + (Number(l.reste_a_commander) || 0));
      g.reste_a_preparer = arrondir(g.reste_a_preparer + (Number(l.reste_a_preparer) || 0));
      if (l.calcul_impossible) g.quantite_inconnue = true;
      (l.anomalies || []).forEach((a) => { if (g.anomalies.indexOf(a) === -1) g.anomalies.push(a); });
      if (!g.reference && l.reference) g.reference = l.reference;

      g.productions.push({
        commande_id: commandeId,
        numero: resultat.commande ? resultat.commande.numero : null,
        article_designation: resultat.article ? resultat.article.designation : null,
        quantite_necessaire: l.quantite_necessaire,
        quantite_commandee: l.quantite_commandee,
        quantite_en_preparation: l.quantite_en_preparation,
        reste_a_commander: l.reste_a_commander,
        // Le POIDS de cette production dans la ligne regroupée. C'est lui qui servira à répartir
        // la quantité commandée, et c'est bcMp.js qui fera ce calcul — pas l'interface.
        poids: Math.max(0, Number(l.reste_a_preparer) || 0),
      });
    });
  }

  const lignes = await mapSeq(Array.from(groupes.values()), async g => {
    const coloris = etatColoris(g);
    const fournisseurs = await fournisseursProposes(db, g.type, g.catalogue_id);
    const retenu = fournisseurs.find((f) => f.prix_ht != null) || fournisseurs[0] || null;
    return Object.assign(g, {
      // Combien chaque production doit recevoir : c'est le poids, et il n'y a pas d'autre
      // définition. Une ligne dont tous les poids sont nuls n'a plus rien à préparer.
      a_preparer: g.reste_a_preparer > EPSILON,
      coloris_requis: coloris.requis,
      coloris_connu: coloris.connu,
      coloris_manquant: coloris.requis && !coloris.connu,
      // Ce qui empêcherait de VALIDER le bon définitif (MP3). En brouillon, rien n'est bloqué :
      // on prépare justement pour voir ce qui manque.
      bloquant_validation: construireBlocages(g, coloris),
      unite_a_choisir: g.unite == null,
      fournisseurs_proposes: fournisseurs,
      fournisseur_propose_id: retenu ? retenu.fournisseur_id : null,
      prix_propose: retenu ? retenu.prix_ht : null,
      nb_productions: g.productions.length,
    });
  });

  // Les lignes qui ont quelque chose à préparer d'abord ; à égalité, les matières avant les
  // fournitures, puis par désignation. L'ordre de l'écran, décidé ici pour qu'il soit le même
  // partout.
  lignes.sort((a, b) => {
    if (a.a_preparer !== b.a_preparer) return a.a_preparer ? -1 : 1;
    if (a.type !== b.type) return a.type === "matiere" ? -1 : 1;
    return String(a.designation).localeCompare(String(b.designation), "fr");
  });

  return {
    productions,
    lignes,
    erreurs,
    totaux: {
      nb_productions: productions.length,
      nb_lignes: lignes.length,
      nb_a_preparer: lignes.filter((l) => l.a_preparer).length,
      nb_coloris_manquants: lignes.filter((l) => l.coloris_manquant).length,
      nb_quantite_inconnue: lignes.filter((l) => l.quantite_inconnue).length,
      nb_unite_a_choisir: lignes.filter((l) => l.unite_a_choisir).length,
      nb_catalogue_non_relie: lignes.filter((l) => l.catalogue_non_relie).length,
    },
  };
}

/**
 * Le coloris est-il nécessaire, et est-il connu ?
 *
 * La règle, inscrite au § 7 bis du document d'architecture : une ligne dont la cible vaut
 * « Toutes couleurs » désigne un composant identique quelle que soit la couleur du vêtement — fil,
 * étiquette de composition — et n'a besoin d'aucun coloris. Toute autre ligne en a besoin.
 *
 * On ne devine jamais à partir du libellé : c'est la CLÉ de cible qui tranche. « * » signifie
 * qu'aucune correspondance de couleur n'est déclarée sur ce composant.
 */
function etatColoris(groupe) {
  const requis = groupe.cible_cle !== "*";
  const manquants = ["correspondance_couleur_absente", "coloris_non_choisi"];
  const connu = requis && !manquants.some((a) => groupe.anomalies.indexOf(a) !== -1);
  return { requis, connu: requis ? connu : true };
}

function construireBlocages(groupe, coloris) {
  const blocages = [];
  if (coloris.requis && !coloris.connu) {
    blocages.push({
      code: "coloris_inconnu",
      message: "Le coloris de « " + groupe.designation + " » n'est pas arrêté pour "
        + groupe.cible_libelle + " : impossible de commander la bonne couleur.",
      ou_corriger: "Fiche technique → onglet " + (groupe.type === "matiere" ? "Matières" : "Fournitures")
        + " → coloris de la ligne",
    });
  }
  if (groupe.quantite_inconnue) {
    blocages.push({
      code: "quantite_inconnue",
      message: "La quantité de « " + groupe.designation + " » n'a pas pu être calculée pour toutes "
        + "les tailles ou couleurs : une consommation manque.",
      ou_corriger: "Fiche technique → consommation de la ligne",
    });
  }
  if (groupe.unite == null) {
    blocages.push({
      code: "unite_a_choisir",
      message: "L'unité d'achat de « " + groupe.designation + " » n'est pas déterminée"
        + (groupe.unite_fiche ? " (« " + groupe.unite_fiche + " » sur la fiche)" : "")
        + " : choisissez kg, m, pièce ou lot.",
      ou_corriger: "sur cette ligne, colonne Unité",
    });
  }
  if (groupe.catalogue_non_relie) {
    blocages.push({
      code: "catalogue_non_relie",
      message: "« " + groupe.designation + " » n'est relié à aucun composant du catalogue : "
        + "son achat ne pourra pas être rapproché du besoin.",
      ou_corriger: "Fiche technique → relier la ligne au catalogue",
    });
  }
  return blocages;
}

module.exports = {
  regrouper, proposerConditionnement, deduireUniteAchat,
  fournisseursProposes, cleRegroupement,
};
