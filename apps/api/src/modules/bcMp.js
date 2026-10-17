const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("../lib/asyncArray.js");
// Bons de commande matières premières et fournitures (BC MP) — MP1 : brouillons uniquement.
//
// CE MODULE N'ÉCRIT RIEN DANS `achats`, NI DANS AUCUNE TABLE FINANCIÈRE. Il ne touche que
// bc_mp, bc_mp_lignes, bc_mp_ligne_productions et compteurs_bc_mp. La création des engagements
// — un `achats` par ligne, une `achats_affectations` par production servie — appartient à MP3,
// et sera livrée seule, avec sa comparaison avant/après sur vos chiffres réels.
//
// Un brouillon est donc exactement ce que son nom dit : modifiable, supprimable, et invisible
// pour la finance. La seule chose qu'il consomme est un NUMÉRO, attribué dès la création et
// jamais réutilisé — un numéro recyclé rend un historique incompréhensible.

const crypto = require("crypto");

const STATUTS = ["brouillon", "valide", "envoye", "solde", "annule"];

/** Transaction explicite : le même code s'exécute en production et dans les tests. */
async function enTransaction(db, fn) {
  // PostgreSQL : une seule connexion pour toute la transaction, tout ou rien (voir src/db).
  return await db.transaction(fn)();
}

// ------------------------------------------------------------------------------------------------
// Numérotation MP001-26
// ------------------------------------------------------------------------------------------------
/**
 * Format : MP + numéro sur 3 chiffres minimum + tiret + année sur 2 chiffres. MP001-26, MP002-26…
 * et MP1000-26 au-delà de 999, sans troncature — un numéro tronqué cesserait d'être unique.
 *
 * Le compteur repart à 1 chaque année, avec le nouveau suffixe.
 *
 * La boucle de vérification n'est pas une précaution de style : elle protège d'un compteur
 * désynchronisé après une restauration de sauvegarde, exactement comme le fait déjà la
 * numérotation des BC PF. Sans elle, deux documents pourraient porter le même numéro.
 */
function formaterNumero(sequence, annee2) {
  return "MP" + String(sequence).padStart(3, "0") + "-" + annee2;
}

async function genererNumero(db, dateRef) {
  const date = dateRef ? new Date(dateRef) : new Date();
  const annee = date.getFullYear();
  const annee2 = String(annee).slice(-2);

  const row = await db.prepare("SELECT dernier_numero FROM compteurs_bc_mp WHERE annee = ?").get(annee);
  let suivant = row ? Number(row.dernier_numero) + 1 : 1;

  const existe = db.prepare("SELECT 1 FROM bc_mp WHERE numero = ?");
  while (await existe.get(formaterNumero(suivant, annee2))) suivant += 1;

  if (row) await db.prepare("UPDATE compteurs_bc_mp SET dernier_numero = ? WHERE annee = ?").run(suivant, annee);
  else await db.prepare("INSERT INTO compteurs_bc_mp (annee, dernier_numero) VALUES (?, ?)").run(annee, suivant);

  return formaterNumero(suivant, annee2);
}

// ------------------------------------------------------------------------------------------------
// Conditionnement : un vrai multiplicateur
// ------------------------------------------------------------------------------------------------
/**
 * « 3 cartons de 500 » valent 1 500 pièces. La quantité est donc CALCULÉE, jamais ressaisie à
 * côté du conditionnement — deux saisies pour une même grandeur finissent toujours par se
 * contredire.
 *
 * Deux façons de renseigner une ligne, et une seule règle :
 *   - on donne un nombre de conditionnements -> quantite = nombre × taille du conditionnement ;
 *   - on donne directement une quantité       -> le nombre de conditionnements s'en déduit.
 *
 * Le nombre de conditionnements n'est pas arrondi à l'entier supérieur ici : un fournisseur peut
 * accepter un demi-rouleau, et c'est à l'utilisateur d'en décider. L'écran de MP2 proposera
 * l'arrondi, il ne l'imposera pas.
 */
function resoudreQuantite(payload, existant) {
  const base = existant || {};
  const taille = payload.conditionnement_quantite !== undefined
    ? Number(payload.conditionnement_quantite)
    : (base.conditionnement_quantite != null ? Number(base.conditionnement_quantite) : 1);

  if (!(taille > 0)) throw new Error("La taille du conditionnement doit être supérieure à zéro.");

  if (payload.nombre_conditionnements !== undefined && payload.nombre_conditionnements !== null
      && payload.nombre_conditionnements !== "") {
    const nombre = Number(payload.nombre_conditionnements);
    if (!(nombre > 0)) throw new Error("Le nombre de conditionnements doit être supérieur à zéro.");
    return { conditionnement_quantite: taille, nombre_conditionnements: nombre, quantite: arrondir(nombre * taille) };
  }

  const quantite = payload.quantite !== undefined
    ? Number(payload.quantite)
    : (base.quantite != null ? Number(base.quantite) : NaN);
  if (!(quantite > 0)) throw new Error("La quantité doit être supérieure à zéro.");

  return {
    conditionnement_quantite: taille,
    nombre_conditionnements: taille === 1 ? null : arrondir(quantite / taille),
    quantite: arrondir(quantite),
  };
}

function arrondir(v) {
  return Math.round((Number(v) + Number.EPSILON) * 1000) / 1000;
}

// ------------------------------------------------------------------------------------------------
// Lecture
// ------------------------------------------------------------------------------------------------
async function get(db, bonId) {
  const bon = await db.prepare(`
    SELECT b.*, f.nom AS fournisseur_nom_actuel
      FROM bc_mp b LEFT JOIN fournisseurs f ON f.id = b.fournisseur_id
     WHERE b.id = ?
  `).get(bonId);
  if (!bon) return null;

  const lignes = await db.prepare("SELECT * FROM bc_mp_lignes WHERE bc_mp_id = ? ORDER BY ordre, id").all(bonId);
  const productions = await db.prepare(`
    SELECT p.*, c.numero AS commande_numero, c.statut AS commande_statut
      FROM bc_mp_ligne_productions p
      JOIN bc_mp_lignes l ON l.id = p.bc_mp_ligne_id
      LEFT JOIN commandes c ON c.id = p.commande_id
     WHERE l.bc_mp_id = ?
  `).all(bonId);

  let totalHt = 0;
  let lignesSansPrix = 0;
  const lignesCompletes = lignes.map((l) => {
    const prix = l.prix_unitaire_ht;
    const montant = prix != null ? arrondir(Number(l.quantite) * Number(prix)) : null;
    if (montant != null) totalHt += montant; else lignesSansPrix += 1;
    return Object.assign({}, l, {
      montant_ht: montant,
      productions: productions.filter((p) => p.bc_mp_ligne_id === l.id),
    });
  });

  return Object.assign({}, bon, {
    lignes: lignesCompletes,
    total_ht: arrondir(totalHt),
    // Un prix manquant bloquera la validation (MP3). On le compte dès maintenant pour que l'écran
    // puisse le dire avant, plutôt que de refuser au dernier moment sans explication.
    lignes_sans_prix: lignesSansPrix,
    // Les productions servies, sans doublon : c'est le regroupement multi-productions, vu du bon.
    commandes_servies: Array.from(new Set(productions.map((p) => p.commande_id)))
      .map((id) => {
        const p = productions.find((x) => x.commande_id === id);
        return { commande_id: id, numero: p.commande_numero, statut: p.commande_statut };
      }),
  });
}

async function list(db, filtres) {
  const f = filtres || {};
  const clauses = [];
  const params = {};
  if (f.statut) { clauses.push("b.statut = @statut"); params.statut = f.statut; }
  if (f.fournisseurId) { clauses.push("b.fournisseur_id = @fournisseurId"); params.fournisseurId = f.fournisseurId; }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";

  return await db.prepare(`
    SELECT b.id, b.numero, b.statut, b.fournisseur_id, b.date_commande, b.date_livraison_souhaitee,
           COALESCE(b.fournisseur_nom, f.nom) AS fournisseur,
           (SELECT COUNT(*) FROM bc_mp_lignes l WHERE l.bc_mp_id = b.id) AS nb_lignes,
           (SELECT COALESCE(SUM(l.quantite * l.prix_unitaire_ht), 0)
              FROM bc_mp_lignes l WHERE l.bc_mp_id = b.id) AS total_ht,
           (SELECT COUNT(*) FROM bc_mp_lignes l
             WHERE l.bc_mp_id = b.id AND l.prix_unitaire_ht IS NULL) AS lignes_sans_prix,
           (SELECT COUNT(DISTINCT p.commande_id)
              FROM bc_mp_ligne_productions p
              JOIN bc_mp_lignes l ON l.id = p.bc_mp_ligne_id
             WHERE l.bc_mp_id = b.id) AS nb_productions
      FROM bc_mp b LEFT JOIN fournisseurs f ON f.id = b.fournisseur_id
      ${where}
     ORDER BY b.id DESC
  `).all(params);
}

// ------------------------------------------------------------------------------------------------
// Écriture — brouillons seulement
// ------------------------------------------------------------------------------------------------
async function assertBrouillon(db, bonId) {
  const bon = await db.prepare("SELECT id, statut, numero FROM bc_mp WHERE id = ?").get(bonId);
  if (!bon) throw new Error("Bon de commande introuvable.");
  if (bon.statut !== "brouillon") {
    throw new Error("Le bon " + bon.numero + " n'est plus en brouillon : il n'est plus modifiable.");
  }
  return bon;
}

/**
 * Crée un bon en brouillon pour UN fournisseur.
 *
 * Les lignes sont facultatives à la création : on peut créer le bon puis le garnir. Le numéro est
 * attribué tout de suite, dans la même transaction que l'insertion — un compteur avancé sans
 * document correspondant laisserait un trou inexplicable dans la numérotation.
 */
async function creerInterne(db, payload) {
  const p = payload || {};
  if (!p.fournisseur_id) throw new Error("Le fournisseur est obligatoire : un bon de commande ne concerne qu'un seul fournisseur.");
  const fournisseur = await db.prepare("SELECT * FROM fournisseurs WHERE id = ?").get(p.fournisseur_id);
  if (!fournisseur) throw new Error("Fournisseur introuvable.");

  const numero = await genererNumero(db, p.date_commande);
  const uuid = crypto.randomUUID();
  const info = await db.prepare(`
    INSERT INTO bc_mp (uuid, numero, fournisseur_id, statut, date_commande,
                       date_livraison_souhaitee, conditions_paiement, notes,
                       observations_internes, cree_par_id)
    VALUES (?, ?, ?, 'brouillon', COALESCE(?, aujourdhui()), ?, ?, ?, ?, ?)
  `).run(uuid, numero, p.fournisseur_id, p.date_commande || null,
    p.date_livraison_souhaitee || null,
    p.conditions_paiement || fournisseur.conditions_paiement_defaut || null,
    p.notes || null, p.observations_internes || null, p.cree_par_id || null);

  const bonId = Number(info.lastInsertRowid);

  for (const [i, ligne] of (p.lignes || []).entries()) {
    await insererLigne(db, bonId, ligne, i);
  }

  return bonId;
}

async function creer(db, payload) {
  return await enTransaction(db, async () => await get(db, await creerInterne(db, payload)));
}

/**
 * Crée PLUSIEURS bons — un par fournisseur — dans UNE SEULE transaction.
 *
 * C'est ce que produit l'écran de préparation : on part des besoins de plusieurs productions, on
 * attribue un fournisseur à chaque ligne, et il en sort autant de bons que de fournisseurs. Tout
 * ou rien : si le troisième bon est refusé (une répartition qui ne tombe pas juste, un fournisseur
 * supprimé entre-temps), les deux premiers ne restent pas en base. Un lot à moitié créé laisserait
 * des numéros attribués à des bons qu'on croirait complets.
 */
async function creerLot(db, bons) {
  const liste = Array.isArray(bons) ? bons : [];
  if (liste.length === 0) throw new Error("Aucun bon à créer.");

  const fournisseurs = liste.map((b) => b && b.fournisseur_id);
  const doublon = fournisseurs.find((f, i) => fournisseurs.indexOf(f) !== i);
  if (doublon != null) {
    throw new Error("Un seul bon par fournisseur : le fournisseur " + doublon + " apparaît deux fois dans le lot.");
  }

  return await enTransaction(db, async () => await mapSeq(liste, async b => await get(db, await creerInterne(db, b))));
}

/**
 * Ce que produit le bouton « Enregistrer » de l'écran de préparation, en UNE transaction.
 *
 * Deux destinations possibles pour les lignes préparées, et souvent les deux à la fois :
 *   - `nouveaux` : un bon neuf par fournisseur ;
 *   - `ajouts`   : des lignes ajoutées à un brouillon qui existe déjà pour ce fournisseur.
 *
 * Les deux passent par la même transaction, délibérément. Une préparation enregistrée à moitié —
 * deux bons créés, le troisième refusé — laisserait l'utilisateur sans aucun moyen de savoir ce
 * qui est parti et ce qui reste à faire, et le prochain regroupement déduirait des quantités
 * fantômes.
 */
async function enregistrerPreparation(db, payload) {
  const p = payload || {};
  const nouveaux = Array.isArray(p.nouveaux) ? p.nouveaux : [];
  const ajouts = Array.isArray(p.ajouts) ? p.ajouts : [];
  if (nouveaux.length === 0 && ajouts.length === 0) throw new Error("Aucune ligne à enregistrer.");

  const fournisseurs = nouveaux.map((b) => b && b.fournisseur_id);
  const doublon = fournisseurs.find((f, i) => fournisseurs.indexOf(f) !== i);
  if (doublon != null) {
    throw new Error("Un seul bon par fournisseur : le fournisseur " + doublon + " apparaît deux fois dans le lot.");
  }

  return await enTransaction(db, async () => {
    const crees = await mapSeq(nouveaux, async b => await creerInterne(db, b));
    const completes = await mapSeq(ajouts, async a => {
      const bon = await assertBrouillon(db, a.bon_id);
      const max = (await db.prepare("SELECT COALESCE(MAX(ordre), -1) AS m FROM bc_mp_lignes WHERE bc_mp_id = ?").get(a.bon_id)).m;

      for (const [i, ligne] of (a.lignes || []).entries()) {
        await insererLigne(db, a.bon_id, ligne, Number(max) + 1 + i);
      }

      await db.prepare("UPDATE bc_mp SET updated_at = maintenant() WHERE id = ?").run(a.bon_id);
      return bon.id;
    });
    return {
      crees: await mapSeq(crees, async id => await get(db, id)),
      completes: await mapSeq(completes, async id => await get(db, id)),
    };
  });
}

const CHAMPS_ENTETE = [
  "date_livraison_souhaitee", "conditions_paiement", "notes", "observations_internes",
];

async function mettreAJour(db, bonId, patch) {
  await assertBrouillon(db, bonId);
  const p = patch || {};
  const champs = CHAMPS_ENTETE.filter((c) => p[c] !== undefined);
  if (champs.length > 0) {
    const set = champs.map((c) => c + " = @" + c).join(", ");
    const params = { id: bonId };
    champs.forEach((c) => { params[c] = p[c] === "" ? null : p[c]; });
    await db.prepare("UPDATE bc_mp SET " + set + ", updated_at = maintenant() WHERE id = @id").run(params);
  }
  return await get(db, bonId);
}

async function supprimer(db, bonId) {
  const bon = await assertBrouillon(db, bonId);
  // Le NUMÉRO n'est pas rendu au compteur : un numéro attribué ne se réutilise jamais, même si
  // le document disparaît. Un trou dans la série est lisible ; un doublon ne l'est pas.
  return await enTransaction(db, async () => {
    await db.prepare("DELETE FROM bc_mp_ligne_productions WHERE bc_mp_ligne_id IN (SELECT id FROM bc_mp_lignes WHERE bc_mp_id = ?)").run(bonId);
    await db.prepare("DELETE FROM bc_mp_lignes WHERE bc_mp_id = ?").run(bonId);
    await db.prepare("DELETE FROM bc_mp WHERE id = ?").run(bonId);
    return { supprime: true, numero: bon.numero };
  });
}

// ------------------------------------------------------------------------------------------------
// Lignes
// ------------------------------------------------------------------------------------------------
const UNITES_ACHAT = ["kg", "m", "piece", "lot"];

function assertLigneValide(ligne) {
  if (ligne.type !== "matiere" && ligne.type !== "fourniture") {
    throw new Error("Le type d'une ligne doit être « matiere » ou « fourniture ».");
  }
  if (!ligne.designation || !String(ligne.designation).trim()) {
    throw new Error("La désignation est obligatoire.");
  }
  if (ligne.unite != null && ligne.unite !== "" && UNITES_ACHAT.indexOf(ligne.unite) === -1) {
    throw new Error(
      "Unité d'achat non reconnue : « " + ligne.unite + " ». Les achats n'acceptent que " +
      UNITES_ACHAT.join(", ") + ". L'unité de la fiche technique reste affichée à côté."
    );
  }
  if (ligne.matiere_catalogue_id && ligne.accessoire_catalogue_id) {
    throw new Error("Une ligne ne peut pas désigner à la fois une matière et une fourniture du catalogue.");
  }
}

async function insererLigne(db, bonId, ligne, ordre) {
  assertLigneValide(ligne);
  const q = resoudreQuantite(ligne, null);

  const info = await db.prepare(`
    INSERT INTO bc_mp_lignes (bc_mp_id, type, matiere_catalogue_id, accessoire_catalogue_id,
      designation, reference, couleur, unite, unite_fiche,
      conditionnement_libelle, conditionnement_quantite, nombre_conditionnements,
      quantite, prix_unitaire_ht, ordre)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(bonId, ligne.type, ligne.matiere_catalogue_id || null, ligne.accessoire_catalogue_id || null,
    String(ligne.designation).trim(), ligne.reference || null, ligne.couleur || null,
    ligne.unite || null, ligne.unite_fiche || null,
    ligne.conditionnement_libelle || null, q.conditionnement_quantite, q.nombre_conditionnements,
    q.quantite, ligne.prix_unitaire_ht != null && ligne.prix_unitaire_ht !== "" ? Number(ligne.prix_unitaire_ht) : null,
    ordre != null ? ordre : 0);

  const ligneId = Number(info.lastInsertRowid);
  await repartirSurProductions(db, ligneId, ligne.productions, q.quantite);
  return ligneId;
}

/**
 * La répartition d'une ligne entre les productions qu'elle sert.
 *
 * Elle est OBLIGATOIRE et doit couvrir exactement la quantité de la ligne : c'est elle qui, à la
 * validation, deviendra les `achats_affectations`. Une ligne dont la répartition ne tombe pas
 * juste produirait un engagement mal réparti entre les productions, donc un coût de revient faux
 * — et personne ne s'en apercevrait avant la clôture.
 *
 * La tolérance d'un millième absorbe les arrondis d'affichage, rien de plus.
 */
/**
 * Deux façons de dire comment une ligne se répartit entre les productions qu'elle sert :
 *
 *   - chaque production porte sa `quantite_affectee` — la répartition est donnée telle quelle ;
 *   - chaque production porte un `poids` (son reste à préparer) — la répartition est CALCULÉE au
 *     prorata, et la dernière part absorbe le millième d'arrondi.
 *
 * Le second mode existe pour que ce calcul vive à UN SEUL endroit. L'écran de préparation laisse
 * modifier la quantité totale d'une ligne ; si la répartition était recalculée dans l'interface,
 * la même règle serait écrite deux fois et finirait par diverger — avec, à la clé, un engagement
 * mal réparti entre les productions et un coût de revient faux que personne ne verrait.
 */
function repartirParPoids(productions, quantiteLigne) {
  const liste = Array.isArray(productions) ? productions.slice() : [];
  const aDesQuantites = liste.some((p) => p && p.quantite_affectee != null && p.quantite_affectee !== "");
  const aDesPoids = liste.some((p) => p && Number(p.poids) > 0);
  if (liste.length === 0 || aDesQuantites || !aDesPoids) return liste;

  const total = liste.reduce((s, p) => s + Math.max(0, Number(p.poids) || 0), 0);
  if (!(total > 0)) return liste;

  let cumul = 0;
  return liste.map((p, i) => {
    const part = i === liste.length - 1
      ? arrondir(Number(quantiteLigne) - cumul)
      : arrondir((Number(quantiteLigne) * Math.max(0, Number(p.poids) || 0)) / total);
    cumul = arrondir(cumul + part);
    return Object.assign({}, p, { quantite_affectee: part });
  });
}

async function repartirSurProductions(db, ligneId, productions, quantiteLigne) {
  const liste = repartirParPoids(productions, quantiteLigne);
  if (liste.length === 0) {
    throw new Error("Une ligne doit servir au moins une production : c'est ce lien qui permet de ne pas commander deux fois.");
  }

  let total = 0;
  const insert = db.prepare(
    "INSERT INTO bc_mp_ligne_productions (bc_mp_ligne_id, commande_id, quantite_affectee) VALUES (?, ?, ?)"
  );

  for (const p of liste) {
    const q = Number(p.quantite_affectee);
    if (!(q > 0)) throw new Error("Chaque production servie doit recevoir une quantité positive.");
    const commande = await db.prepare("SELECT id FROM commandes WHERE id = ? AND deleted_at IS NULL").get(p.commande_id);
    if (!commande) throw new Error("Commande de fabrication introuvable : " + p.commande_id);
    total += q;
    await insert.run(ligneId, p.commande_id, q);
  }

  if (Math.abs(total - Number(quantiteLigne)) > 0.001) {
    throw new Error(
      "La répartition entre productions (" + arrondir(total) + ") ne correspond pas à la quantité " +
      "de la ligne (" + arrondir(quantiteLigne) + ")."
    );
  }
}

async function ajouterLigne(db, bonId, ligne) {
  await assertBrouillon(db, bonId);
  return await enTransaction(db, async () => {
    const max = (await db.prepare("SELECT COALESCE(MAX(ordre), -1) AS m FROM bc_mp_lignes WHERE bc_mp_id = ?").get(bonId)).m;
    await insererLigne(db, bonId, ligne, Number(max) + 1);
    return await get(db, bonId);
  });
}

const CHAMPS_LIGNE = [
  "designation", "reference", "couleur", "unite", "unite_fiche",
  "conditionnement_libelle", "prix_unitaire_ht",
];

async function mettreAJourLigne(db, ligneId, patch) {
  const existant = await db.prepare("SELECT * FROM bc_mp_lignes WHERE id = ?").get(ligneId);
  if (!existant) throw new Error("Ligne de bon introuvable.");
  await assertBrouillon(db, existant.bc_mp_id);
  const p = patch || {};

  const fusion = Object.assign({}, existant, p);
  assertLigneValide(fusion);
  const touchePourLaQuantite = p.quantite !== undefined
    || p.nombre_conditionnements !== undefined
    || p.conditionnement_quantite !== undefined;
  const q = touchePourLaQuantite ? resoudreQuantite(p, existant) : null;

  return await enTransaction(db, async () => {
    const champs = CHAMPS_LIGNE.filter((c) => p[c] !== undefined);
    const params = { id: ligneId };
    champs.forEach((c) => { params[c] = p[c] === "" ? null : p[c]; });
    let set = champs.map((c) => c + " = @" + c).join(", ");

    if (q) {
      set = (set ? set + ", " : "") +
        "quantite = @quantite, conditionnement_quantite = @cq, nombre_conditionnements = @nc";
      params.quantite = q.quantite;
      params.cq = q.conditionnement_quantite;
      params.nc = q.nombre_conditionnements;
    }
    if (set) await db.prepare("UPDATE bc_mp_lignes SET " + set + " WHERE id = @id").run(params);

    // La répartition est refaite dès que la quantité bouge : laisser l'ancienne en place
    // produirait une ligne dont la somme des parts ne vaut plus la quantité.
    if (p.productions !== undefined || q) {
      const quantiteFinale = q ? q.quantite : Number(existant.quantite);
      // Quand la quantité change sans qu'une nouvelle répartition soit fournie, les parts
      // existantes servent de POIDS et non de quantités : reprises telles quelles, leur somme ne
      // vaudrait plus la quantité de la ligne et la modification serait refusée. C'est pourtant
      // l'action la plus courante de l'écran de préparation : ajuster une quantité.
      const nouvelles = p.productions !== undefined
        ? p.productions
        : (await db.prepare("SELECT commande_id, quantite_affectee FROM bc_mp_ligne_productions WHERE bc_mp_ligne_id = ?")
            .all(ligneId))
            .map((r) => ({ commande_id: r.commande_id, poids: r.quantite_affectee }));
      await db.prepare("DELETE FROM bc_mp_ligne_productions WHERE bc_mp_ligne_id = ?").run(ligneId);
      await repartirSurProductions(db, ligneId, nouvelles, quantiteFinale);
    }

    await db.prepare("UPDATE bc_mp SET updated_at = maintenant() WHERE id = ?").run(existant.bc_mp_id);
    return await get(db, existant.bc_mp_id);
  });
}

async function supprimerLigne(db, ligneId) {
  const existant = await db.prepare("SELECT * FROM bc_mp_lignes WHERE id = ?").get(ligneId);
  if (!existant) throw new Error("Ligne de bon introuvable.");
  await assertBrouillon(db, existant.bc_mp_id);
  return await enTransaction(db, async () => {
    await db.prepare("DELETE FROM bc_mp_ligne_productions WHERE bc_mp_ligne_id = ?").run(ligneId);
    await db.prepare("DELETE FROM bc_mp_lignes WHERE id = ?").run(ligneId);
    await db.prepare("UPDATE bc_mp SET updated_at = maintenant() WHERE id = ?").run(existant.bc_mp_id);
    return await get(db, existant.bc_mp_id);
  });
}

module.exports = {
  creer, creerLot, enregistrerPreparation, get, list, mettreAJour, supprimer,
  ajouterLigne, mettreAJourLigne, supprimerLigne,
  genererNumero, formaterNumero, resoudreQuantite, repartirParPoids,
  STATUTS, UNITES_ACHAT,
};
