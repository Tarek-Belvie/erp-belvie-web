const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("../lib/asyncArray.js");
const { normalizeNom } = require("../lib/normalize");

async function getOrCreateMesureCatalogue(db, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la mesure est obligatoire.");
  const nomNormalise = normalizeNom(nomTrim);
  let entry = await db.prepare("SELECT * FROM mesures_catalogue WHERE nom_normalise = ?").get(nomNormalise);
  if (!entry) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM mesures_catalogue").get()).m || 0;
    const info = await db.prepare("INSERT INTO mesures_catalogue (nom, nom_normalise, ordre) VALUES (?, ?, ?)").run(nomTrim, nomNormalise, maxOrdre + 1);
    entry = await db.prepare("SELECT * FROM mesures_catalogue WHERE id = ?").get(info.lastInsertRowid);
  }
  return entry;
}

// Vue d'ensemble pour Paramètres : chaque type de produit avec ses modèles (0, 1 ou plusieurs).
async function listProduitsAvecStatut(db) {
  const produits = await db.prepare("SELECT id, nom FROM listes_valeurs WHERE type = 'produit' AND actif = 1 ORDER BY ordre, nom").all();
  const modeles = await db.prepare(
    "SELECT m.id, m.nom, m.produit_id, m.actif, " +
    "(SELECT COUNT(*) FROM modeles_mesures_lignes WHERE modele_id = m.id) AS nb_lignes " +
    "FROM modeles_mesures m ORDER BY m.nom"
  ).all();
  return produits.map((p) => ({
    produit_id: p.id,
    produit_nom: p.nom,
    modeles: modeles.filter((m) => m.produit_id === p.id),
  }));
}

async function listByProduitId(db, produitId, options) {
  const seulementActifs = !options || options.actifsSeulement !== false;
  const rows = await db.prepare(
    "SELECT * FROM modeles_mesures WHERE produit_id = ?" + (seulementActifs ? " AND actif = 1" : "") + " ORDER BY nom"
  ).all(produitId);
  return await mapSeq(
    rows,
    async m => Object.assign({}, m, { lignes: await listLignes(db, m.id) })
  );
}

async function listLignes(db, modeleId) {
  return await db.prepare(
    "SELECT l.id, l.repere, l.unite, l.tolerance_plus, l.tolerance_moins, l.commentaire, l.ordre, " +
    "COALESCE(l.groupe, 'principale') AS groupe, mc.id AS mesure_catalogue_id, mc.nom " +
    "FROM modeles_mesures_lignes l JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
    // Tri par GROUPE puis ordre : reordonner a l'interieur d'un groupe ne peut jamais entremeler
  // visuellement Principales et Details.
  "WHERE l.modele_id = ? ORDER BY CASE COALESCE(l.groupe,'principale') WHEN 'principale' THEN 0 ELSE 1 END, l.ordre, mc.nom"
  ).all(modeleId);
}

async function getById(db, modeleId) {
  const modele = await db.prepare("SELECT * FROM modeles_mesures WHERE id = ?").get(modeleId);
  if (!modele) return null;
  return Object.assign({}, modele, { lignes: await listLignes(db, modeleId) });
}

async function create(db, produitId, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom du modèle est obligatoire.");
  const info = await db.prepare("INSERT INTO modeles_mesures (nom, produit_id) VALUES (?, ?)").run(nomTrim, produitId);
  return await getById(db, info.lastInsertRowid);
}

// Duplique un modèle existant (toutes ses lignes) sous un nouveau nom, pour le même type de
// produit — pratique pour partir d'un modèle proche plutôt que de tout ressaisir.
async function dupliquer(db, modeleId, nouveauNom) {
  const source = await getById(db, modeleId);
  if (!source) throw new Error("Modèle introuvable.");
  const nomTrim = String(nouveauNom || "").trim() || `${source.nom} (copie)`;
  const info = await db.prepare("INSERT INTO modeles_mesures (nom, produit_id) VALUES (?, ?)").run(nomTrim, source.produit_id);
  const nouveauId = info.lastInsertRowid;
  const insertLigne = db.prepare(
    "INSERT INTO modeles_mesures_lignes (modele_id, mesure_catalogue_id, repere, unite, tolerance_plus, tolerance_moins, commentaire, groupe, ordre) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );

  for (const l of source.lignes) {
    await insertLigne.run(nouveauId, l.mesure_catalogue_id, l.repere, l.unite, l.tolerance_plus, l.tolerance_moins, l.commentaire, l.groupe, l.ordre);
  }

  return await getById(db, nouveauId);
}

async function updateNom(db, modeleId, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom du modèle est obligatoire.");
  await db.prepare("UPDATE modeles_mesures SET nom = ?, updated_at = maintenant() WHERE id = ?").run(nomTrim, modeleId);
  return await getById(db, modeleId);
}

async function setActif(db, modeleId, actif) {
  await db.prepare("UPDATE modeles_mesures SET actif = ?, updated_at = maintenant() WHERE id = ?").run(actif ? 1 : 0, modeleId);
  return await getById(db, modeleId);
}

async function deleteModele(db, modeleId) {
  await db.prepare("DELETE FROM modeles_mesures WHERE id = ?").run(modeleId); // cascade sur les lignes
  return { deleted: true };
}

async function addLigne(db, modeleId, nom, options) {
  const catalogue = await getOrCreateMesureCatalogue(db, nom);
  const existing = await db.prepare("SELECT 1 FROM modeles_mesures_lignes WHERE modele_id = ? AND mesure_catalogue_id = ?").get(modeleId, catalogue.id);
  if (!existing) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM modeles_mesures_lignes WHERE modele_id = ?").get(modeleId)).m || 0;
    const opts = options || {};
    await db.prepare(
      "INSERT INTO modeles_mesures_lignes (modele_id, mesure_catalogue_id, repere, unite, tolerance_plus, tolerance_moins, commentaire, groupe, ordre) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(modeleId, catalogue.id, opts.repere || null, opts.unite || null, opts.tolerance_plus || null, opts.tolerance_moins || null, opts.commentaire || null,
      opts.groupe || groupeDeMesure(catalogue.nom), maxOrdre + 1);
  }
  return await getById(db, modeleId);
}

// Bibliothèque de départ : les jeux de mesures courants du prêt-à-porter, pour éviter de tout
// ressaisir à la main à chaque nouveau type de produit. Un simple POINT DE DÉPART — chaque ligne
// reste ensuite ajoutable, supprimable, réordonnable et modifiable normalement, exactement comme
// une ligne créée à la main (addLigne / removeLigne / updateLigne / reorderLignes).
//
// Rien n'est écrit en base au démarrage : ces jeux ne deviennent des lignes réelles que lorsque
// l'utilisateur clique « Charger un jeu de mesures standard » sur un modèle donné.
//
// VOCABULAIRE STANDARDISÉ — règle à tenir absolument.
// mesures_catalogue.nom_normalise est UNIQUE de façon GLOBALE : deux façons d'écrire la même
// mesure créent deux entrées concurrentes qui ne se rejoindront jamais. On écrit donc toujours :
//   "1/2 poitrine"   et jamais "Largeur poitrine", "Demi-poitrine" ou "Tour de poitrine / 2"
//   "1/2 ceinture"   et jamais "Tour de taille"
//   "1/2 bas"        et jamais "Largeur bas"
// Toute mesure prise à plat sur un demi-vêtement commence par "1/2 ". Les longueurs, hauteurs,
// profondeurs, ouvertures et positions gardent leur nom direct.
// Avant d'ajouter un libellé ici, vérifier qu'aucune variante n'existe déjà dans les jeux
// ci-dessous : un synonyme introduit ici pollue le catalogue de toute l'application.

// --- Bases communes, réutilisées par plusieurs jeux ---------------------------------------------
// Déclarées une fois puis composées : le jour où "1/2 poitrine" doit être renommé, il n'y a qu'un
// seul endroit à corriger, et tous les jeux qui en dépendent suivent.

const BASE_HAUT_MAILLE = [
  "Longueur totale", "1/2 poitrine", "1/2 bas", "Largeur épaules", "Longueur épaule",
  "Profondeur emmanchure", "1/2 biceps", "Longueur manche", "Ouverture manche",
  "Largeur encolure", "Profondeur encolure devant", "Profondeur encolure dos",
];

// Les hauteurs ET largeurs de bord-cote vont ensemble. « Hauteur poignet » et « Largeur poignet »
// restent des mesures du vetement, pas du bord-cote : elles sont donc PRINCIPALES.
const BAS_POIGNET = [
  "Hauteur bord-côte bas", "Largeur bord-côte bas",
  "Hauteur bord-côte poignet", "Largeur bord-côte poignet",
  "Hauteur poignet", "Largeur poignet",
];

const BASE_VESTE = [
  "Longueur totale devant", "Longueur totale dos", "1/2 poitrine", "1/2 taille", "1/2 bas",
  "Largeur épaules", "Carrure devant", "Carrure dos", "Profondeur emmanchure", "1/2 biceps",
  "1/2 coude", "Longueur manche", "Ouverture manche", "Largeur poignet", "Hauteur poignet",
  "Largeur encolure", "Hauteur col", "Longueur fermeture principale", "Position poche",
  "Ouverture / longueur poche",
];

const BASE_BAS = [
  "1/2 ceinture", "1/2 bassin", "1/2 cuisse", "1/2 genou", "1/2 bas",
  "Longueur côté", "Longueur entrejambe", "Fourche devant", "Fourche dos", "Hauteur ceinture",
];

// --- Les 14 jeux ---------------------------------------------------------------------------------
const MODELES_STANDARDS = {
  // 1. HAUTS EN MAILLE
  haut_maille: {
    label: "Haut en maille (base)",
    famille: "Hauts en maille",
    mesures: BASE_HAUT_MAILLE,
  },
  polo: {
    label: "Polo",
    famille: "Hauts en maille",
    mesures: BASE_HAUT_MAILLE.concat([
      "Longueur col", "Hauteur col", "Largeur col", "Longueur patte", "Largeur patte",
    ]),
  },
  pull: {
    label: "Pull",
    famille: "Hauts en maille",
    // Couvre col rond, demi-montant et col montant : les lignes inutiles se suppriment.
    mesures: BASE_HAUT_MAILLE.concat([
      "Largeur col", "Hauteur col", "Hauteur bord-côte bas", "Hauteur poignet", "Largeur poignet",
    ]),
  },
  sweat: {
    label: "Sweat",
    famille: "Hauts en maille",
    mesures: BASE_HAUT_MAILLE.concat(BAS_POIGNET).concat([
      "Hauteur bord-côte col", "Largeur bord-côte col",
    ]),
  },
  hoodie: {
    label: "Hoodie",
    famille: "Hauts en maille",
    mesures: BASE_HAUT_MAILLE.concat(BAS_POIGNET).concat([
      "Hauteur capuche", "Largeur capuche", "Profondeur capuche", "Ouverture capuche",
      "Largeur poche kangourou", "Hauteur poche kangourou", "Position poche kangourou",
    ]),
  },
  debardeur: {
    label: "Débardeur",
    famille: "Hauts en maille",
    // Version simplifiée de la base : ni manche, ni épaule au sens classique.
    mesures: [
      "Longueur totale", "1/2 poitrine", "1/2 bas", "Largeur épaules / bretelles",
      "Largeur bretelle", "Profondeur emmanchure", "Ouverture emmanchure",
      "Largeur encolure", "Profondeur encolure devant", "Profondeur encolure dos",
    ],
  },

  // 2. CHEMISES / SURCHEMISES — même tableau : ce sont les valeurs et l'aisance qui changent,
  // pas les points de mesure.
  chemise: {
    label: "Chemise / Surchemise",
    famille: "Chemises",
    mesures: [
      "Longueur totale dos", "Longueur totale devant", "1/2 poitrine", "1/2 taille", "1/2 bas",
      "Largeur épaules", "Carrure devant", "Carrure dos", "Profondeur emmanchure", "1/2 biceps",
      "Longueur manche", "Ouverture manche", "Largeur poignet", "Hauteur poignet",
      "Tour / longueur col", "Hauteur col", "Largeur pied de col",
      "Longueur patte devant", "Largeur patte devant", "Hauteur empiècement dos",
    ],
  },

  // 3. VESTES / BLOUSONS
  veste_blouson: {
    label: "Veste / Blouson",
    famille: "Vestes",
    mesures: BASE_VESTE,
  },

  // 4. SANS MANCHES
  gilet_sans_manches: {
    label: "Gilet / Doudoune sans manches",
    famille: "Vestes",
    mesures: [
      "Longueur totale devant", "Longueur totale dos", "1/2 poitrine", "1/2 taille", "1/2 bas",
      "Largeur épaules", "Carrure devant", "Carrure dos", "Profondeur emmanchure",
      "Ouverture emmanchure", "Largeur encolure", "Hauteur col",
      "Longueur fermeture principale", "Position poche", "Ouverture / longueur poche",
    ],
  },

  // 5. PANTALONS
  pantalon: {
    label: "Pantalon",
    famille: "Bas",
    mesures: [
      "1/2 ceinture", "1/2 bassin", "1/2 cuisse", "1/2 genou", "1/2 bas de jambe",
      "Longueur côté", "Longueur entrejambe", "Fourche devant", "Fourche dos",
      "Hauteur ceinture", "Largeur ceinture", "Longueur braguette",
      "Ouverture poche côté", "Position poche côté", "Position poche dos", "Largeur poche dos",
    ],
  },

  // 6. JOGGING / MAILLE — la ceinture élastiquée se mesure détendue ET étirée.
  jogging: {
    label: "Jogging / Pantalon en maille",
    famille: "Bas",
    mesures: [
      "1/2 ceinture détendue", "1/2 ceinture étirée", "1/2 bassin", "1/2 cuisse", "1/2 genou",
      "1/2 bas", "Longueur côté", "Longueur entrejambe", "Fourche devant", "Fourche dos",
      "Hauteur ceinture", "Longueur élastique", "Longueur cordon",
      "Ouverture poche", "Position poche",
    ],
  },

  // 7. SHORTS
  short: {
    label: "Short",
    famille: "Bas",
    mesures: [
      "1/2 ceinture", "1/2 bassin", "1/2 cuisse", "1/2 ouverture bas",
      "Longueur côté", "Longueur entrejambe", "Fourche devant", "Fourche dos",
      "Hauteur ceinture", "Ouverture poche", "Position poche", "Longueur fente côté",
    ],
  },

  // 8. SHORT DE BAIN — reste dans la famille Shorts, mais avec son propre jeu.
  short_bain: {
    label: "Short de bain",
    famille: "Bas",
    mesures: [
      "1/2 ceinture détendue", "1/2 ceinture étirée", "1/2 bassin", "1/2 cuisse",
      "1/2 ouverture bas", "Longueur côté", "Longueur entrejambe", "Fourche devant", "Fourche dos",
      "Hauteur ceinture", "Longueur élastique", "Longueur cordon",
      "Ouverture poche", "Profondeur poche", "Position poche", "Longueur fente côté",
      "Longueur filet / doublure intérieure",
    ],
  },

  // 9. BERMUDA / PANTACOURT
  bermuda: {
    label: "Bermuda / Pantacourt",
    famille: "Bas",
    mesures: BASE_BAS.concat(["Ouverture poche", "Position poche"]),
  },
};

// --- Compléments optionnels ----------------------------------------------------------------------
// Particularités TECHNIQUES, pas des catégories : une veste à capuche reste une veste. Ces jeux
// s'ajoutent PAR-DESSUS un tableau déjà chargé, sans rien remplacer (addLigne fusionne).
// "cible" indique les jeux auxquels le complément s'applique, pour que l'interface ne propose que
// ce qui a du sens.
const COMPLEMENTS_STANDARDS = {
  bord_cote_bomber: {
    label: "Bord-côte (bomber / teddy)",
    cible: ["veste_blouson"],
    mesures: [
      "Hauteur bord-côte bas", "Hauteur bord-côte poignet",
      "Largeur bord-côte poignet", "Hauteur col bord-côte",
    ],
  },
  capuche: {
    label: "Capuche",
    cible: ["veste_blouson", "gilet_sans_manches", "sweat", "haut_maille"],
    mesures: ["Hauteur capuche", "Largeur capuche", "Profondeur capuche", "Ouverture capuche"],
  },
  ceinture_elastiquee: {
    label: "Ceinture élastiquée",
    cible: ["short", "bermuda", "pantalon"],
    mesures: [
      "1/2 ceinture détendue", "1/2 ceinture étirée", "Longueur élastique", "Longueur cordon",
    ],
  },
  bas_bord_cote: {
    label: "Bas avec bord-côte",
    cible: ["jogging", "pantalon"],
    mesures: [
      "Hauteur bord-côte bas", "1/2 ouverture bas détendue", "1/2 ouverture bas étirée",
    ],
  },
};

// Classement d'une mesure en groupe. La regle est volontairement ETROITE : seul le concept
// « bord-cote » fait une mesure de detail. « Largeur poignet », « Hauteur poignet » ou
// « Largeur encolure » restent PRINCIPALES — ce sont des mesures du vetement, pas de sa finition.
function groupeDeMesure(nom) {
  const n = String(nom == null ? "" : nom)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /bord[- ]?cote/.test(n) ? "detail" : "principale";
}

function listModelesStandards() {
  return Object.entries(MODELES_STANDARDS).map(([cle, v]) => ({
    cle: cle, label: v.label, famille: v.famille, nb_mesures: v.mesures.length,
  }));
}

// Compléments applicables, éventuellement filtrés sur le jeu de base déjà utilisé : proposer
// "Bord-côte (bomber)" sur un short n'aiderait personne. Sans filtre, tout est renvoyé.
function listComplementsStandards(cleBase) {
  return Object.entries(COMPLEMENTS_STANDARDS)
    .filter(([, v]) => !cleBase || v.cible.indexOf(cleBase) !== -1)
    .map(([cle, v]) => ({ cle: cle, label: v.label, nb_mesures: v.mesures.length, cible: v.cible }));
}

// Ajoute un complément PAR-DESSUS le tableau existant, sans rien remplacer : addLigne ignore une
// mesure déjà présente, et les repères reprennent après la dernière ligne du modèle.
async function chargerComplementStandard(db, modeleId, cle) {
  const complement = COMPLEMENTS_STANDARDS[cle];
  if (!complement) throw new Error("Complément standard inconnu.");
  const existant = await getById(db, modeleId);
  if (!existant) throw new Error("Modèle introuvable.");
  let rang = existant.lignes.length;

  for (const nom of complement.mesures) {
    await addLigne(db, modeleId, nom, { repere: REPERES[rang] || null, unite: "cm", groupe: groupeDeMesure(nom) });
    rang += 1;
  }

  return await getById(db, modeleId);
}

// Charge un jeu standard dans un modèle : repères A, B, C... attribués dans l'ordre, unité "cm"
// par défaut (le cas le plus courant), tolérances laissées vides — à ajuster ensuite au cas par
// cas. N'écrase jamais une ligne déjà présente (même logique de fusion que addLigne).
const REPERES = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

async function chargerModeleStandard(db, modeleId, cle) {
  const standard = MODELES_STANDARDS[cle];
  if (!standard) throw new Error("Modèle standard inconnu.");

  for (const [i, nom] of standard.mesures.entries()) {
    await addLigne(db, modeleId, nom, { repere: REPERES[i] || null, unite: "cm", groupe: groupeDeMesure(nom) });
  }

  return await getById(db, modeleId);
}

async function updateLigne(db, modeleId, ligneId, patch) {
  const champs = ["repere", "unite", "tolerance_plus", "tolerance_moins", "commentaire"].filter((f) => patch[f] !== undefined);
  if (champs.length > 0) {
    const params = { id: ligneId };
    champs.forEach((f) => { params[f] = patch[f] || null; });
    const setClause = champs.map((f) => `${f} = @${f}`).join(", ");
    await db.prepare(`UPDATE modeles_mesures_lignes SET ${setClause} WHERE id = @id`).run(params);
  }
  return await getById(db, modeleId);
}

async function removeLigne(db, modeleId, ligneId) {
  await db.prepare("DELETE FROM modeles_mesures_lignes WHERE id = ?").run(ligneId);
  return await getById(db, modeleId);
}

async function reorderLignes(db, modeleId, orderedLigneIds) {
  const update = db.prepare("UPDATE modeles_mesures_lignes SET ordre = ? WHERE id = ?");
  const tx = db.transaction(async () => {
    for (const [i, id] of orderedLigneIds.entries()) {
      await update.run(i, id);
    }
  });
  await tx();
  return await getById(db, modeleId);
}

module.exports = {
  groupeDeMesure,
  listProduitsAvecStatut, listByProduitId, getById, create, dupliquer, updateNom, setActif, deleteModele,
  addLigne, updateLigne, removeLigne, reorderLignes, listModelesStandards, chargerModeleStandard,
  listComplementsStandards, chargerComplementStandard,
};
