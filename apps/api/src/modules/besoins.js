const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("../lib/asyncArray.js");
// Besoins en matières et fournitures — accès aux données.
//
// Ce module LIT, il n'écrit jamais. Aucun INSERT, aucun UPDATE, aucun DELETE : l'étape 1 du
// module Approvisionnement doit pouvoir être installée et retirée sans laisser la moindre trace
// dans la base, et en particulier sans toucher à quoi que ce soit de financier.
//
// Son rôle est de traduire ce que la base contient en l'entrée attendue par calculBesoins.js,
// qui ne connaît ni SQL ni Electron. La séparation n'est pas décorative : elle permet de vérifier
// le calcul sur des cas tordus sans monter une base, et de simuler des quantités sans rien
// écrire — simuler, ici, c'est appeler le même calcul avec d'autres quantités.

const { calculerBesoins, LIBELLES_ANOMALIES } = require("./calculBesoins");

// Version du format d'instantané de recette. Le moteur REFUSE une version qu'il ne connaît pas et
// revient à la fiche technique en le disant, plutôt que d'interpréter de travers un instantané
// qu'il ne comprend plus. Une mauvaise lecture silencieuse serait exactement le défaut que le gel
// est censé supprimer.
const FORMAT_RECETTE = 1;

function normaliser(texte) {
  return String(texte == null ? "" : texte)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function tableExiste(db, nom) {
  return !!(await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ?").get(nom));
}

async function colonneExiste(db, table, colonne) {
  return (await db.colonnes(table)).some((c) => c.name === colonne);
}

// ----------------------------------------------------------------------------------------------
// Recette figée
// ----------------------------------------------------------------------------------------------
/**
 * La recette technique figée sur une commande, s'il y en a une.
 *
 * Une commande décidée ne doit plus suivre les évolutions de la fiche : elle garde la recette qui
 * était la sienne au moment où elle a été figée. Tant qu'aucune recette n'est figée — c'est le cas
 * de toutes les commandes existantes au moment où cette fonction apparaît — on lit la fiche, et
 * les chiffres restent rigoureusement identiques à ce qu'ils étaient.
 *
 * Trois issues, et chacune est dite à l'appelant :
 *   - aucune recette figée        -> null, la fiche sera lue
 *   - une recette figée lisible   -> ses composants
 *   - une recette figée ILLISIBLE -> on revient à la fiche, mais en le signalant. Jamais en
 *     silence : un instantané qu'on ne sait plus lire doit se voir, pas se deviner.
 */
async function lireRecetteFigee(db, commandeId) {
  if (!(await tableExiste(db, "commandes_recette_figee"))) return null;
  const row = await db.prepare("SELECT * FROM commandes_recette_figee WHERE commande_id = ?").get(commandeId);
  if (!row) return null;

  const commun = {
    fiche_id: row.fiche_id,
    fiche_revision: row.fiche_revision,
    figee_le: row.figee_le,
    figee_motif: row.figee_motif,
    format_version: row.format_version,
  };

  if (row.format_version !== FORMAT_RECETTE) {
    return Object.assign({}, commun, {
      illisible: true,
      raison: "Format d'instantané inconnu (" + row.format_version + ", attendu " + FORMAT_RECETTE + ").",
    });
  }
  try {
    const composants = JSON.parse(row.composants_json);
    if (!Array.isArray(composants)) throw new Error("l'instantané n'est pas une liste de composants");
    return Object.assign({}, commun, { composants });
  } catch (err) {
    return Object.assign({}, commun, {
      illisible: true,
      raison: "Instantané de recette illisible : " + ((err && err.message) || "erreur inconnue"),
    });
  }
}

// ----------------------------------------------------------------------------------------------
// Lecture de la production
// ----------------------------------------------------------------------------------------------
async function lireProduction(db, commandeId) {
  return await db.prepare(`
    SELECT cl.couleur_id,
           lv.nom       AS couleur_nom,
           cl.taille_id,
           cl.taille_nom,
           cl.quantite
      FROM commande_lignes cl
      LEFT JOIN listes_valeurs lv ON lv.id = cl.couleur_id
     WHERE cl.commande_id = ?
     ORDER BY lv.ordre, lv.nom, cl.id
  `).all(commandeId);
}

// ----------------------------------------------------------------------------------------------
// Lecture des composants de la fiche technique
// ----------------------------------------------------------------------------------------------
/**
 * Les consommations par taille sont indexées sur ft_tailles.id, alors que la production est
 * exprimée en grilles_tailles_valeurs.id. On traduit ici, une fois pour toutes, plutôt que de
 * laisser le calcul s'en charger : c'est une affaire de stockage, pas de métier.
 */
/**
 * Les trois colonnes « hors approvisionnement » n'existent qu'après la migration de l'étape 2a.
 * On les lit si elles sont là, et on considère tout composant comme approvisionné sinon : une
 * base non migrée se comporte donc exactement comme avant.
 */
async function champsHorsAppro(db, table, alias) {
  if (!(await colonneExiste(db, table, "hors_approvisionnement"))) {
    return ", 0 AS hors_approvisionnement, NULL AS hors_appro_motif, NULL AS hors_appro_precision";
  }
  return ", " + alias + ".hors_approvisionnement, " + alias + ".hors_appro_motif, " + alias + ".hors_appro_precision";
}

async function lireMatieres(db, ficheId) {
  const matieres = await db.prepare(`
    SELECT m.id, m.nom, m.unite, m.perte_pourcent, m.matiere_catalogue_id,
           m.mode_consommation, m.consommation_technique
           ${await champsHorsAppro(db, "ft_matieres", "m")}
      FROM ft_matieres m
     WHERE m.fiche_id = ?
     ORDER BY m.ordre, m.id
  `).all(ficheId);

  const consoTaille = await db.prepare(`
    SELECT c.ft_matiere_id, t.grille_valeur_id, c.consommation_technique
      FROM ft_matiere_consommations_taille c
      JOIN ft_tailles t ON t.id = c.ft_taille_id
     WHERE t.fiche_id = ?
  `).all(ficheId);

  // consommation_technique sur ft_matiere_couleurs est la colonne ajoutée à l'étape 1 : elle
  // reste NULL dans l'immense majorité des cas, et n'est renseignée que lorsqu'une couleur
  // consomme réellement autrement.
  const couleurs = await db.prepare(`
    SELECT mc.ft_matiere_id, mc.couleur_produit_id, mc.matiere_couleur_id,
           mc.consommation_technique,
           cat.libelle AS coloris_libelle, cat.reference AS coloris_reference, cat.code AS coloris_code
      FROM ft_matiere_couleurs mc
      JOIN ft_matieres m ON m.id = mc.ft_matiere_id
      LEFT JOIN matiere_couleurs cat ON cat.id = mc.matiere_couleur_id
     WHERE m.fiche_id = ?
  `).all(ficheId);

  return matieres.map((m) => {
    const consommations_taille = {};
    consoTaille.filter((c) => c.ft_matiere_id === m.id && c.grille_valeur_id != null)
      .forEach((c) => { consommations_taille[c.grille_valeur_id] = c.consommation_technique; });

    const parCouleur = {};
    couleurs.filter((c) => c.ft_matiere_id === m.id).forEach((c) => {
      parCouleur[c.couleur_produit_id] = {
        // Le coloris non choisi reste une correspondance DÉCLARÉE mais incomplète : on la
        // distingue d'une correspondance absente, qui est une autre anomalie.
        cle: c.matiere_couleur_id != null ? "mc:" + c.matiere_couleur_id : "mc?:" + c.couleur_produit_id,
        libelle: c.coloris_libelle || "Coloris à choisir",
        reference: c.coloris_reference || null,
        consommation: c.consommation_technique,
        // Dit explicitement au moteur si le coloris a été ARRÊTÉ. Sans ce drapeau, il ne pouvait
        // pas distinguer « Noir 001 » d'un coloris encore en attente, et laissait passer une
        // commande de tissu dont personne ne connaissait la couleur.
        coloris_choisi: c.matiere_couleur_id != null,
      };
    });

    return {
      cle: "matiere:" + m.id,
      type: "matiere",
      nom: m.nom,
      unite: m.unite || null,
      reference: null,
      perte_pourcent: m.perte_pourcent || 0,
      catalogue_id: m.matiere_catalogue_id,
      mode_consommation: m.mode_consommation,
      consommation_base: m.consommation_technique,
      consommations_taille,
      couleurs: parCouleur,
      hors_approvisionnement: !!m.hors_approvisionnement,
      hors_appro_motif: m.hors_appro_motif || null,
      hors_appro_precision: m.hors_appro_precision || null,
    };
  });
}

async function lireFournitures(db, ficheId) {
  const fournitures = await db.prepare(`
    SELECT a.id, a.nom, a.unite, a.reference, a.accessoire_catalogue_id,
           a.consommation_par_piece, a.perte_pourcent, a.famille
           ${await champsHorsAppro(db, "ft_accessoires", "a")}
      FROM ft_accessoires a
     WHERE a.fiche_id = ?
     ORDER BY a.famille, a.ordre, a.id
  `).all(ficheId);

  const consoTaille = await db.prepare(`
    SELECT ft.ft_accessoire_id, t.grille_valeur_id, ft.consommation_par_piece
      FROM ft_fourniture_tailles ft
      JOIN ft_tailles t ON t.id = ft.ft_taille_id
     WHERE t.fiche_id = ?
  `).all(ficheId);

  const couleurs = await db.prepare(`
    SELECT fc.ft_accessoire_id, fc.couleur_produit_id, fc.couleur_fourniture,
           fc.reference, fc.consommation_par_piece
      FROM ft_fourniture_couleurs fc
      JOIN ft_accessoires a ON a.id = fc.ft_accessoire_id
     WHERE a.fiche_id = ?
  `).all(ficheId);

  return fournitures.map((f) => {
    const consommations_taille = {};
    const lignesTaille = consoTaille.filter((c) => c.ft_accessoire_id === f.id && c.grille_valeur_id != null);
    lignesTaille.forEach((c) => { consommations_taille[c.grille_valeur_id] = c.consommation_par_piece; });

    const parCouleur = {};
    couleurs.filter((c) => c.ft_accessoire_id === f.id).forEach((c) => {
      const choisi = !!(c.couleur_fourniture && String(c.couleur_fourniture).trim());
      const libelle = choisi ? c.couleur_fourniture : "Coloris à préciser";
      parCouleur[c.couleur_produit_id] = {
        // Les coloris de fourniture sont du texte libre : la clé de regroupement est donc le
        // libellé normalisé. Deux saisies « Noir » et « noir » se rejoignent, comme il se doit.
        // Un coloris non précisé reçoit en revanche une clé propre à la couleur produit, sinon
        // toutes les couleurs en attente se confondraient sur une seule ligne.
        cle: choisi ? "af:" + normaliser(libelle) : "af?:" + c.couleur_produit_id,
        libelle,
        reference: c.reference || f.reference || null,
        consommation: c.consommation_par_piece,
        coloris_choisi: choisi,
      };
    });

    return {
      cle: "fourniture:" + f.id,
      type: "fourniture",
      nom: f.nom,
      unite: f.unite || null,
      reference: f.reference || null,
      perte_pourcent: f.perte_pourcent || 0,
      catalogue_id: f.accessoire_catalogue_id,
      // Une fourniture passe en mode par taille dès qu'une grille de tailles existe pour elle.
      mode_consommation: lignesTaille.length > 0 ? "par_taille" : "moyenne",
      consommation_base: f.consommation_par_piece,
      consommations_taille,
      couleurs: parCouleur,
      hors_approvisionnement: !!f.hors_approvisionnement,
      hors_appro_motif: f.hors_appro_motif || null,
      hors_appro_precision: f.hors_appro_precision || null,
    };
  });
}

// ----------------------------------------------------------------------------------------------
// Engagements déjà pris sur cette production
// ----------------------------------------------------------------------------------------------
/**
 * Un achat se rattache à cette production de deux façons : soit il lui est directement lié
 * (achats.commande_id), soit il est partagé et réparti par achats_affectations. Les deux sont
 * lus, sans jamais compter deux fois le même achat.
 *
 * Le rattachement à une LIGNE de besoin est plus délicat :
 *  - les matières portent matiere_catalogue_id : le composant est identifié sans ambiguïté ;
 *  - la couleur, elle, est du texte libre dans achats.couleur. On ne rapproche donc que lorsque
 *    le libellé correspond, ou lorsque l'achat ne porte aucune couleur ;
 *  - les FOURNITURES ne portent aucun identifiant de catalogue dans achats : aucun rattachement
 *    fiable n'est possible aujourd'hui (voir la note de livraison).
 *
 * Tout ce qui n'a pas pu être rattaché est renvoyé à part, et affiché. Un engagement passé sous
 * silence ferait racheter une matière déjà commandée — ou, pire, laisserait croire qu'elle l'est.
 */
/**
 * Rapproche un élément acheté — un achat, ou une ligne de bon en préparation — de la ligne de
 * besoin qu'il sert.
 *
 * Le rapprochement se fait par l'identifiant de CATALOGUE, jamais par le libellé : deux
 * désignations voisines ne sont pas le même composant. Les matières passent par
 * matiere_catalogue_id, les fournitures par accessoire_catalogue_id — cette seconde voie est
 * l'apport de MP1, et c'est elle qui empêche de recommander une fourniture déjà achetée.
 *
 * Fonction UNIQUE, volontairement : les achats et les brouillons de bons doivent se rapprocher
 * exactement de la même façon. Deux implémentations finiraient par diverger, et l'écran
 * afficherait alors deux vérités pour la même ligne.
 */
function rapprocherDuBesoin(lignesBesoin, element) {
  const candidates = lignesBesoin.filter((l) => {
    if (l.type === "matiere") {
      return element.matiere_catalogue_id != null && l.catalogue_id === element.matiere_catalogue_id;
    }
    return element.accessoire_catalogue_id != null && l.catalogue_id === element.accessoire_catalogue_id;
  });

  if (candidates.length === 1 && !element.couleur) return candidates[0];
  if (candidates.length === 0) return null;

  const couleurNormalisee = normaliser(element.couleur);
  const trouvee = candidates.find((l) => normaliser(l.cible_libelle) === couleurNormalisee);
  if (trouvee) return trouvee;
  // Un composant sans déclinaison de couleur n'a qu'une ligne « Toutes couleurs » : un achat qui
  // porte malgré tout une couleur s'y rattache quand même.
  if (candidates.length === 1 && candidates[0].cible_cle === "*") return candidates[0];
  return null;
}

async function lireEngagements(db, commandeId, lignesBesoin) {
  // accessoire_catalogue_id n'existe qu'après la migration MP1. Sur une base qui ne l'a pas
  // encore reçue, on lit NULL : le comportement reste alors exactement celui d'avant.
  const champAccessoire = (await colonneExiste(db, "achats", "accessoire_catalogue_id"))
    ? "a.accessoire_catalogue_id"
    : "NULL AS accessoire_catalogue_id";

  const achats = await db.prepare(`
    SELECT a.id, a.designation, a.categorie, a.matiere_catalogue_id, ${champAccessoire},
           a.couleur, a.unite, a.quantite,
           CASE WHEN a.commande_id = ? THEN a.quantite ELSE aff.quantite_affectee END AS quantite_affectee,
           (SELECT COALESCE(SUM(r.quantite_recue), 0)
              FROM achats_receptions r WHERE r.achat_id = a.id) AS quantite_recue_totale
      FROM achats a
      LEFT JOIN achats_affectations aff
             ON aff.achat_id = a.id AND aff.commande_id = ?
     WHERE a.commande_id = ? OR aff.id IS NOT NULL
  `).all(commandeId, commandeId, commandeId);

  const rattaches = [];
  const nonRattaches = [];

  achats.forEach((a) => {
    const quantiteAffectee = Number(a.quantite_affectee) || 0;
    if (quantiteAffectee <= 0) return;

    // La quantité reçue est ramenée au prorata de la part affectée à CETTE production : un achat
    // partagé entre deux commandes n'a pas été reçu deux fois.
    const proportion = Number(a.quantite) > 0 ? quantiteAffectee / Number(a.quantite) : 1;
    const quantiteRecue = (Number(a.quantite_recue_totale) || 0) * proportion;

    const cible = rapprocherDuBesoin(lignesBesoin, a);

    if (cible) {
      rattaches.push({
        composant_cle: cible.composant_cle,
        cible_cle: cible.cible_cle,
        quantite_affectee: quantiteAffectee,
        quantite_recue: quantiteRecue,
      });
    } else {
      nonRattaches.push({
        achat_id: a.id,
        designation: a.designation,
        categorie: a.categorie,
        couleur: a.couleur || null,
        unite: a.unite || null,
        quantite_affectee: quantiteAffectee,
        quantite_recue: Math.round(quantiteRecue * 1000) / 1000,
        raison: (a.matiere_catalogue_id == null && a.accessoire_catalogue_id == null)
          ? (a.categorie === "fourniture"
            ? "Cet achat de fourniture n'est relié à aucune entrée du catalogue des fournitures"
            : "Achat non relié à une matière du catalogue")
          : "Aucune ligne de besoin ne correspond à ce composant et cette couleur",
      });
    }
  });

  return { rattaches, nonRattaches };
}

// ----------------------------------------------------------------------------------------------
// Quantités déjà posées sur des bons de commande EN PRÉPARATION
// ----------------------------------------------------------------------------------------------
/**
 * Un bon en brouillon n'écrit rien dans `achats` — c'est ce qui le rend librement modifiable et
 * supprimable. Mais sans ce décompte, préparer un second bon reproposerait les mêmes quantités,
 * et on commanderait deux fois.
 *
 * Ces quantités sont donc comptées À PART, et ne se mélangent jamais au « commandé » : un
 * brouillon n'est pas un engagement, et l'écran doit pouvoir montrer les deux séparément.
 * Elles ne modifient aucune des cinq quantités existantes.
 */
async function lireEnPreparation(db, commandeId, lignesBesoin) {
  if (!(await tableExiste(db, "bc_mp_lignes"))) return [];

  const lignes = await db.prepare(`
    SELECT l.matiere_catalogue_id, l.accessoire_catalogue_id, l.couleur, l.type,
           p.quantite_affectee, b.numero AS bon_numero
      FROM bc_mp_ligne_productions p
      JOIN bc_mp_lignes l ON l.id = p.bc_mp_ligne_id
      JOIN bc_mp b ON b.id = l.bc_mp_id
     WHERE p.commande_id = ? AND b.statut = 'brouillon'
  `).all(commandeId);

  const resultat = [];
  lignes.forEach((l) => {
    const quantite = Number(l.quantite_affectee) || 0;
    if (quantite <= 0) return;
    const cible = rapprocherDuBesoin(lignesBesoin, l);
    if (!cible) return;   // une ligne de brouillon sans besoin correspondant n'enlève rien
    resultat.push({
      composant_cle: cible.composant_cle,
      cible_cle: cible.cible_cle,
      quantite,
      bon_numero: l.bon_numero,
    });
  });
  return resultat;
}

// ----------------------------------------------------------------------------------------------
// Point d'entrée
// ----------------------------------------------------------------------------------------------
/**
 * Calcule les besoins d'une commande de fabrication.
 *
 * @param options.lignes_simulees  quantités de remplacement [{ couleur_id, taille_id, quantite }].
 *        Lorsqu'elles sont fournies, elles remplacent les quantités réelles le temps du calcul.
 *        RIEN n'est écrit : la commande n'est pas touchée, et un second appel sans ces lignes
 *        redonne exactement le résultat réel.
 */
async function calculerPourCommande(db, commandeId, options) {
  const o = options || {};

  // La photo et l'identité de l'article sont rendues ICI, et non reprises de la liste des
  // commandes : cet écran ne dépend ainsi d'aucun champ du module Commandes de production, dont
  // l'API ne nous appartient pas.
  // Le type de produit et la saison sont des RÉFÉRENCES vers listes_valeurs (produit_id,
  // saison_id), pas du texte porté par l'article : il faut donc les joindre. Les lire comme des
  // colonnes de `articles` ferait échouer la requête — « no such column ».
  const commande = await db.prepare(`
    SELECT c.id, c.numero, c.statut, c.quantite_totale, c.date_lancement, c.date_fin_prevue,
           c.article_id,
           a.designation AS article_designation,
           a.reference_principale AS article_reference,
           lvp.nom AS article_produit,
           lvs.nom AS article_saison,
           (SELECT p.photo_thumb_path FROM article_photos p
             WHERE p.article_id = a.id ORDER BY p.est_principale DESC, p.id LIMIT 1) AS article_photo
      FROM commandes c
      JOIN articles a ON a.id = c.article_id
      LEFT JOIN listes_valeurs lvp ON lvp.id = a.produit_id
      LEFT JOIN listes_valeurs lvs ON lvs.id = a.saison_id
     WHERE c.id = ?
  `).get(commandeId);
  if (!commande) throw new Error("Commande de fabrication introuvable.");

  const fiche = await db.prepare("SELECT id, statut FROM fiches_techniques WHERE article_id = ?").get(commande.article_id);

  const productionReelle = await lireProduction(db, commandeId);
  let production = productionReelle;
  let simulation = false;

  if (Array.isArray(o.lignes_simulees) && o.lignes_simulees.length > 0) {
    simulation = true;
    // Les quantités simulées se superposent aux lignes réelles, repérées par couleur et taille.
    // Une couleur ou une taille inconnue de la commande est ignorée : la simulation sert à faire
    // varier une production existante, pas à en inventer une autre.
    const index = new Map();
    o.lignes_simulees.forEach((l) => {
      index.set(String(l.couleur_id) + "|" + String(l.taille_id), Number(l.quantite) || 0);
    });
    production = productionReelle.map((l) => {
      const cle = String(l.couleur_id) + "|" + String(l.taille_id);
      return index.has(cle) ? Object.assign({}, l, { quantite: index.get(cle) }) : l;
    });
  }

  // --- La recette : figée sur la commande, ou lue dans la fiche -------------------------------
  // C'est ICI, et nulle part ailleurs, que se joue la protection d'une production décidée contre
  // une révision ultérieure de la fiche technique. Une seule condition, un seul endroit.
  const figee = await lireRecetteFigee(db, commandeId);
  const lisible = figee && !figee.illisible;
  const tousComposants = lisible
    ? figee.composants
    : (fiche ? (await lireMatieres(db, fiche.id)).concat(await lireFournitures(db, fiche.id)) : []);

  // Les composants déclarés hors approvisionnement sortent du calcul, mais pas de l'écran : ils
  // sont rendus à part, avec leur motif. Une ligne masquée est une ligne oubliée.
  const composants = tousComposants.filter((c) => !c.hors_approvisionnement);
  const horsApprovisionnement = tousComposants
    .filter((c) => c.hors_approvisionnement)
    .map((c) => ({
      cle: c.cle, type: c.type, nom: c.nom, unite: c.unite || null,
      motif: c.hors_appro_motif || null, precision: c.hors_appro_precision || null,
    }));

  const revisionActuelle = fiche && (await colonneExiste(db, "fiches_techniques", "revision"))
    ? ((await db.prepare("SELECT revision FROM fiches_techniques WHERE id = ?").get(fiche.id)) || {}).revision
    : null;

  const recette = {
    // fiche | figee | figee_illisible — et dans le dernier cas, la fiche a été lue malgré tout.
    source: lisible ? "figee" : (figee ? "figee_illisible" : "fiche"),
    fiche_revision_figee: figee ? figee.fiche_revision : null,
    fiche_revision_actuelle: revisionActuelle != null ? revisionActuelle : null,
    figee_le: figee ? figee.figee_le : null,
    figee_motif: figee ? figee.figee_motif : null,
    // Vrai quand la fiche a changé de révision depuis le gel : l'écran le signale, sans jamais
    // adopter la nouvelle révision de lui-même.
    revision_en_retard: !!(figee && revisionActuelle != null && figee.fiche_revision !== revisionActuelle),
    illisible_raison: figee && figee.illisible ? figee.raison : null,
  };

  // Premier passage sans engagement : il sert uniquement à connaître les lignes de besoin, donc
  // les cibles auxquelles rattacher les achats existants.
  const sansEngagement = calculerBesoins({ production, composants, engagements: [] });
  const engagements = simulation
    ? { rattaches: [], nonRattaches: [] }   // une simulation ne déduit aucun engagement réel
    : await lireEngagements(db, commandeId, sansEngagement.lignes);

  // Les bons en préparation ne sont comptés que sur le calcul RÉEL : une simulation ne se
  // compare qu'à elle-même, elle ne déduit ni engagement ni brouillon.
  const preparations = simulation
    ? []
    : await lireEnPreparation(db, commandeId, sansEngagement.lignes);

  const resultat = calculerBesoins({
    production, composants, engagements: engagements.rattaches, preparations,
  });

  return {
    commande: {
      id: commande.id,
      numero: commande.numero,
      statut: commande.statut,
      quantite_totale: commande.quantite_totale,
      date_lancement: commande.date_lancement,
      date_fin_prevue: commande.date_fin_prevue,
    },
    article: {
      id: commande.article_id,
      designation: commande.article_designation,
      produit: commande.article_produit,
      reference: commande.article_reference,
      saison: commande.article_saison,
      photo_path: commande.article_photo || null,
    },
    fiche: fiche ? { id: fiche.id, statut: fiche.statut } : null,
    recette,
    production_reelle: productionReelle,
    production_utilisee: production,
    simulation,
    lignes: resultat.lignes,
    totaux: resultat.totaux,
    anomalies: resultat.anomalies,
    calcul_incomplet: resultat.calcul_incomplet,
    libelles_anomalies: LIBELLES_ANOMALIES,
    hors_approvisionnement: horsApprovisionnement,
    engagements_non_rattaches: engagements.nonRattaches,
  };
}

// La liste des commandes à approvisionner n'est PAS fournie ici : `api.commandes.list()` existe
// déjà et remplit ce rôle. Une seconde fonction qui listerait les mêmes commandes finirait par
// diverger de la première — filtre différent, champ oublié — et il faudrait alors deviner
// laquelle fait foi. L'écran filtre lui-même sur le statut.

// ----------------------------------------------------------------------------------------------
// État d'approvisionnement d'un lot de commandes — pour la colonne « Appro » de la liste
// ----------------------------------------------------------------------------------------------
/**
 * Cette fonction ne liste rien et ne remplace pas `commandes:list`. Elle répond, pour des
 * identifiants obtenus ailleurs, à une question que seul le moteur de besoins peut trancher :
 * « cette production est-elle approvisionnée, et que lui manque-t-il ? » Sans elle, l'état
 * d'approvisionnement ne serait connu qu'après avoir ouvert chaque commande une par une — donc
 * impossible à trier ni à filtrer.
 *
 * Une seule information de la commande est renvoyée au passage : la DÉSIGNATION de l'article.
 * `commandes:list` renvoie le type de produit (« Sweat »), pas la désignation (« Sweat à capuche
 * zipée »), et c'est pourtant elle que l'utilisateur lit en premier. Elle est déjà lue par le
 * calcul : la redemander ailleurs serait une requête de plus pour rien.
 *
 * Le calcul se fait dans le processus principal, en un seul appel pour toutes les commandes :
 * N allers-retours depuis l'interface coûteraient bien plus cher que N calculs locaux.
 *
 * Une commande dont le calcul échoue revient avec son message d'erreur et n'interrompt pas les
 * autres. Une seule fiche technique incohérente ne doit pas vider la liste entière.
 *
 * Aucune écriture, ici non plus.
 */
const EPSILON = 1e-9;

async function etatsApprovisionnement(db, commandeIds) {
  const ids = (Array.isArray(commandeIds) ? commandeIds : [])
    .map((v) => Number(v))
    .filter((v) => Number.isFinite(v));

  return await mapSeq(ids, async id => {
    try {
      const r = await calculerPourCommande(db, id);
      const lignes = r.lignes;

      let aCommander = 0;
      let aRecevoir = 0;
      let enAnomalie = 0;
      let incompletes = 0;
      lignes.forEach((l) => {
        if (l.reste_a_commander > EPSILON) aCommander += 1;
        if (l.reste_a_recevoir > EPSILON) aRecevoir += 1;
        if (l.anomalies.length > 0) enAnomalie += 1;
        if (l.calcul_incomplet) incompletes += 1;
      });

      // La couverture se compte en LIGNES, jamais en quantités : additionner des mètres, des kilos
      // et des pièces donnerait un pourcentage qui ne veut rien dire. Une ligne est couverte dès
      // qu'il ne reste plus rien à commander dessus.
      const couverture = lignes.length > 0
        ? Math.round(((lignes.length - aCommander) / lignes.length) * 100)
        : null;

      let statut;
      if (!r.fiche) statut = "sans_fiche";
      else if (lignes.length === 0) statut = "sans_composant";
      else if (enAnomalie > 0) statut = "a_completer";
      else if (aCommander > 0) statut = "a_commander";
      else if (aRecevoir > 0) statut = "a_recevoir";
      else statut = "complet";

      return {
        commande_id: id,
        erreur: null,
        statut,
        article_designation: r.article.designation || null,
        nb_lignes: lignes.length,
        nb_lignes_a_commander: aCommander,
        nb_lignes_a_recevoir: aRecevoir,
        nb_lignes_en_anomalie: enAnomalie,
        couverture_pourcent: couverture,
        engagements_non_rattaches: r.engagements_non_rattaches.length,
        // Un calcul incomplet ne doit jamais se confondre avec un calcul complet, même dans une
        // liste : la couverture affichée porterait alors sur des chiffres qui ne couvrent pas
        // toute la production.
        calcul_incomplet: !!r.calcul_incomplet,
        nb_lignes_incompletes: incompletes,
        recette_source: r.recette.source,
        revision_en_retard: r.recette.revision_en_retard,
      };
    } catch (err) {
      return {
        commande_id: id,
        erreur: (err && err.message) || "Calcul impossible.",
        statut: "erreur",
        article_designation: null,
        nb_lignes: 0,
        nb_lignes_a_commander: 0,
        nb_lignes_a_recevoir: 0,
        nb_lignes_en_anomalie: 0,
        couverture_pourcent: null,
        engagements_non_rattaches: 0,
        calcul_incomplet: false,
        nb_lignes_incompletes: 0,
        recette_source: null,
        revision_en_retard: false,
      };
    }
  });
}

/**
 * Construit la recette technique d'une fiche : exactement ce que le moteur consomme, et donc
 * exactement ce qui sera figé sur une commande.
 *
 * Exportée pour que le module qui FIGE (étape 2c) n'ait pas à reconstruire cette lecture de son
 * côté. Une seconde façon de composer la recette finirait par diverger de celle-ci, et on
 * figerait alors autre chose que ce que le calcul utilise.
 *
 * Cette fonction LIT, comme tout le reste de ce fichier. L'écriture appartient à l'appelant.
 */
async function construireRecette(db, ficheId) {
  return {
    format_version: FORMAT_RECETTE,
    composants: (await lireMatieres(db, ficheId)).concat(await lireFournitures(db, ficheId)),
  };
}

module.exports = { calculerPourCommande, etatsApprovisionnement, construireRecette, FORMAT_RECETTE };
