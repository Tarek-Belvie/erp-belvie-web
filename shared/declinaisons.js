// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — déclinaisons (types, valeurs, variantes d'article).
//
// Adaptée de electron/ipc/declinaisons.js pour la Phase 1 (Lot 1 — Articles).
//
// DEUX vrais problèmes trouvés en adaptant, tous deux vérifiés avec du code
// réel avant correction (pas supposés) :
//
//   1. genererVariantes() utilisait GROUP_CONCAT(...) en SQL pour détecter
//      les combinaisons déjà existantes. GROUP_CONCAT est PROPRE À SQLITE —
//      testé : `SELECT GROUP_CONCAT('a')` échoue purement et simplement sur
//      PostgreSQL ("function group_concat does not exist"), ce n'est pas
//      une divergence subtile, la requête plante. Corrigé en réutilisant la
//      MÊME approche déjà utilisée par previsualiserImpact() : recalculer
//      les clés de combinaison en JavaScript à partir de listVariantes(),
//      jamais de fonction d'agrégation SQL spécifique à un moteur.
//
//   2. listTypes()/listValeurs() ont un ORDER BY ordre, nom (resp. valeur)
//      SANS LOWER() ni COLLATE — comportement CASSE-SENSIBLE de SQLite par
//      défaut. Confirmé divergent avec une collation PostgreSQL type
//      Supabase (majuscules/minuscules interclassées différemment). Corrigé
//      au niveau du SCHÉMA (COLLATE "C" sur declinaison_types.nom et
//      declinaison_valeurs.valeur), pas ici — même technique que pour
//      listes_valeurs.nom.
//
// Toutes les fonctions utilisant db.transaction() (synchrone, propre à
// better-sqlite3) sont adaptées à adapter.transaction(async (tx) => {...}).
//
// electron/ipc/declinaisons.js n'est PAS modifié.
// ============================================================================

const { normalizeNom } = require("./normalize");

async function genererCode(adapter, nom) {
  const base = String(nom || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "type";
  let code = base;
  let n = 2;
  while (await adapter.get("SELECT 1 AS x FROM declinaison_types WHERE code = ?", [code])) {
    code = base + "_" + n; n += 1;
  }
  return code;
}

async function listTypes(adapter, options) {
  const includeInactive = options && options.includeInactive;
  const types = await adapter.all(
    "SELECT * FROM declinaison_types " + (includeInactive ? "" : "WHERE actif = 1 ") + "ORDER BY ordre, nom", []
  );
  for (const t of types) {
    const c = await adapter.get("SELECT COUNT(*) AS n FROM declinaison_valeurs WHERE declinaison_type_id = ?", [t.id]);
    t.nb_valeurs = c.n;
  }
  return types;
}

async function createType(adapter, nom, options) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom du type de déclinaison est obligatoire.");
  const nomNormalise = normalizeNom(nomTrim);
  if (await adapter.get("SELECT 1 AS x FROM declinaison_types WHERE nom_normalise = ?", [nomNormalise])) {
    throw new Error("Un type de déclinaison avec ce nom existe déjà.");
  }
  const code = await genererCode(adapter, nomTrim);
  const affichageCouleur = options && options.affichage_couleur ? 1 : 0;
  const maxRow = await adapter.get("SELECT MAX(ordre) AS m FROM declinaison_types", []);
  const maxOrdre = (maxRow && maxRow.m) || 0;
  const info = await adapter.run(
    "INSERT INTO declinaison_types (code, nom, nom_normalise, affichage_couleur, ordre) VALUES (?, ?, ?, ?, ?) RETURNING id",
    [code, nomTrim, nomNormalise, affichageCouleur, maxOrdre + 1]
  );
  return adapter.get("SELECT * FROM declinaison_types WHERE id = ?", [info.lastInsertRowid]);
}

async function updateType(adapter, id, patch) {
  const type = await adapter.get("SELECT * FROM declinaison_types WHERE id = ?", [id]);
  if (!type) throw new Error("Type de déclinaison introuvable.");
  if (patch.nom !== undefined) {
    const nomTrim = String(patch.nom || "").trim();
    if (!nomTrim) throw new Error("Le nom du type de déclinaison est obligatoire.");
    const nomNormalise = normalizeNom(nomTrim);
    const doublon = await adapter.get("SELECT 1 AS x FROM declinaison_types WHERE nom_normalise = ? AND id <> ?", [nomNormalise, id]);
    if (doublon) throw new Error("Un type de déclinaison avec ce nom existe déjà.");
    await adapter.run("UPDATE declinaison_types SET nom = ?, nom_normalise = ? WHERE id = ?", [nomTrim, nomNormalise, id]);
  }
  if (patch.affichage_couleur !== undefined) {
    await adapter.run("UPDATE declinaison_types SET affichage_couleur = ? WHERE id = ?", [patch.affichage_couleur ? 1 : 0, id]);
  }
  if (patch.actif !== undefined) {
    await adapter.run("UPDATE declinaison_types SET actif = ? WHERE id = ?", [patch.actif ? 1 : 0, id]);
  }
  return adapter.get("SELECT * FROM declinaison_types WHERE id = ?", [id]);
}

async function listValeurs(adapter, typeId, options) {
  const includeInactive = options && options.includeInactive;
  return adapter.all(
    "SELECT * FROM declinaison_valeurs WHERE declinaison_type_id = ? " + (includeInactive ? "" : "AND actif = 1 ") + "ORDER BY ordre, valeur",
    [typeId]
  );
}

async function createValeur(adapter, typeId, valeur, options) {
  const type = await adapter.get("SELECT * FROM declinaison_types WHERE id = ?", [typeId]);
  if (!type) throw new Error("Type de déclinaison introuvable.");
  const valeurTrim = String(valeur || "").trim();
  if (!valeurTrim) throw new Error("La valeur est obligatoire.");
  const valeurNormalisee = normalizeNom(valeurTrim);
  if (await adapter.get("SELECT 1 AS x FROM declinaison_valeurs WHERE declinaison_type_id = ? AND valeur_normalisee = ?", [typeId, valeurNormalisee])) {
    throw new Error("Cette valeur existe déjà pour ce type de déclinaison.");
  }
  const couleurHex = options && options.couleur_hex ? String(options.couleur_hex).trim() : null;
  if (couleurHex && !/^#[0-9a-fA-F]{6}$/.test(couleurHex)) {
    throw new Error("Le code couleur doit être au format hexadécimal (ex : #1A2B3C).");
  }
  const maxRow = await adapter.get("SELECT MAX(ordre) AS m FROM declinaison_valeurs WHERE declinaison_type_id = ?", [typeId]);
  const maxOrdre = (maxRow && maxRow.m) || 0;
  const info = await adapter.run(
    "INSERT INTO declinaison_valeurs (declinaison_type_id, valeur, valeur_normalisee, couleur_hex, ordre) VALUES (?, ?, ?, ?, ?) RETURNING id",
    [typeId, valeurTrim, valeurNormalisee, couleurHex, maxOrdre + 1]
  );
  return adapter.get("SELECT * FROM declinaison_valeurs WHERE id = ?", [info.lastInsertRowid]);
}

async function updateValeur(adapter, id, patch) {
  const val = await adapter.get("SELECT * FROM declinaison_valeurs WHERE id = ?", [id]);
  if (!val) throw new Error("Valeur introuvable.");
  if (patch.valeur !== undefined) {
    const valeurTrim = String(patch.valeur || "").trim();
    if (!valeurTrim) throw new Error("La valeur est obligatoire.");
    const valeurNormalisee = normalizeNom(valeurTrim);
    const doublon = await adapter.get(
      "SELECT 1 AS x FROM declinaison_valeurs WHERE declinaison_type_id = ? AND valeur_normalisee = ? AND id <> ?",
      [val.declinaison_type_id, valeurNormalisee, id]
    );
    if (doublon) throw new Error("Cette valeur existe déjà pour ce type de déclinaison.");
    await adapter.run("UPDATE declinaison_valeurs SET valeur = ?, valeur_normalisee = ? WHERE id = ?", [valeurTrim, valeurNormalisee, id]);
  }
  if (patch.couleur_hex !== undefined) {
    const couleurHex = patch.couleur_hex ? String(patch.couleur_hex).trim() : null;
    if (couleurHex && !/^#[0-9a-fA-F]{6}$/.test(couleurHex)) {
      throw new Error("Le code couleur doit être au format hexadécimal (ex : #1A2B3C).");
    }
    await adapter.run("UPDATE declinaison_valeurs SET couleur_hex = ? WHERE id = ?", [couleurHex, id]);
  }
  if (patch.actif !== undefined) {
    await adapter.run("UPDATE declinaison_valeurs SET actif = ? WHERE id = ?", [patch.actif ? 1 : 0, id]);
  }
  return adapter.get("SELECT * FROM declinaison_valeurs WHERE id = ?", [id]);
}

async function getArticleDeclinaisonTypes(adapter, articleId) {
  return adapter.all(
    "SELECT adt.id AS association_id, adt.ordre, dt.* " +
    "FROM article_declinaison_types adt JOIN declinaison_types dt ON dt.id = adt.declinaison_type_id " +
    "WHERE adt.article_id = ? ORDER BY adt.ordre",
    [articleId]
  );
}

async function setArticleDeclinaisonTypes(adapter, articleId, typeIds) {
  await adapter.transaction(async (tx) => {
    await tx.run("DELETE FROM article_declinaison_types WHERE article_id = ?", [articleId]);
    for (let i = 0; i < typeIds.length; i++) {
      await tx.run("INSERT INTO article_declinaison_types (article_id, declinaison_type_id, ordre) VALUES (?, ?, ?)", [articleId, typeIds[i], i]);
    }
  });
  return getArticleDeclinaisonTypes(adapter, articleId);
}

async function articleHasVariantes(adapter, articleId) {
  const row = await adapter.get("SELECT COUNT(*) AS n FROM article_variantes WHERE article_id = ?", [articleId]);
  return row.n > 0;
}

async function reorderTypes(adapter, orderedIds) {
  await adapter.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.run("UPDATE declinaison_types SET ordre = ? WHERE id = ?", [i, orderedIds[i]]);
    }
  });
  return listTypes(adapter, { includeInactive: true });
}

async function reorderValeurs(adapter, typeId, orderedIds) {
  await adapter.transaction(async (tx) => {
    for (let i = 0; i < orderedIds.length; i++) {
      await tx.run("UPDATE declinaison_valeurs SET ordre = ? WHERE id = ? AND declinaison_type_id = ?", [i, orderedIds[i], typeId]);
    }
  });
  return listValeurs(adapter, typeId, { includeInactive: true });
}

async function getArticleDeclinaisonValeurs(adapter, articleId) {
  return adapter.all(
    "SELECT adv.declinaison_type_id, adv.declinaison_valeur_id, dv.valeur, dv.couleur_hex, dv.ordre " +
    "FROM article_declinaison_valeurs adv JOIN declinaison_valeurs dv ON dv.id = adv.declinaison_valeur_id " +
    "WHERE adv.article_id = ? ORDER BY dv.ordre",
    [articleId]
  );
}

function cleCombo(paires) {
  return paires.map((p) => p.typeId + ":" + p.valeurId).sort().join(",");
}

async function previsualiserImpact(adapter, articleId, selections) {
  const combinaisons = produitCartesien(selections);
  const clesAttendues = new Set(combinaisons.map((c) => cleCombo(c)));

  const existantes = await listVariantes(adapter, articleId, { includeInactive: true });
  let conservees = 0;
  const aReactiverIds = [];
  const obsoletesIds = [];
  const clesExistantes = new Set();
  for (const v of existantes) {
    const paires = v.valeurs.map((x) => ({ typeId: x.declinaison_type_id, valeurId: x.declinaison_valeur_id }));
    const cle = cleCombo(paires);
    clesExistantes.add(cle);
    if (clesAttendues.has(cle)) {
      if (v.actif) conservees += 1;
      else aReactiverIds.push(v.id);
    } else if (v.actif) {
      obsoletesIds.push(v.id);
    }
  }
  const nouvelles = combinaisons.filter((c) => !clesExistantes.has(cleCombo(c))).length;

  return {
    total_attendu: combinaisons.length,
    conservees,
    a_reactiver: aReactiverIds.length,
    a_reactiver_ids: aReactiverIds,
    nouvelles,
    obsoletes: obsoletesIds.length,
    obsoletes_ids: obsoletesIds,
    deja_utilisees_ailleurs: 0,
  };
}

async function appliquerConfiguration(adapter, articleId, typeIds, selections) {
  const impact = await previsualiserImpact(adapter, articleId, selections);

  await adapter.transaction(async (tx) => {
    await tx.run("DELETE FROM article_declinaison_types WHERE article_id = ?", [articleId]);
    for (let i = 0; i < typeIds.length; i++) {
      await tx.run("INSERT INTO article_declinaison_types (article_id, declinaison_type_id, ordre) VALUES (?, ?, ?)", [articleId, typeIds[i], i]);
    }

    await tx.run("DELETE FROM article_declinaison_valeurs WHERE article_id = ?", [articleId]);
    for (const typeId of Object.keys(selections)) {
      for (const valeurId of (selections[typeId] || [])) {
        await tx.run("INSERT INTO article_declinaison_valeurs (article_id, declinaison_type_id, declinaison_valeur_id) VALUES (?, ?, ?)", [articleId, Number(typeId), Number(valeurId)]);
      }
    }

    for (const id of impact.obsoletes_ids) await tx.run("UPDATE article_variantes SET actif = 0 WHERE id = ?", [id]);
    for (const id of impact.a_reactiver_ids) await tx.run("UPDATE article_variantes SET actif = 1 WHERE id = ?", [id]);
  });

  return {
    types: await getArticleDeclinaisonTypes(adapter, articleId),
    valeurs: await getArticleDeclinaisonValeurs(adapter, articleId),
    impact,
  };
}

async function listVariantes(adapter, articleId, options) {
  const includeInactive = options && options.includeInactive;
  const variantes = await adapter.all(
    "SELECT * FROM article_variantes WHERE article_id = ? " + (includeInactive ? "" : "AND actif = 1 ") + "ORDER BY id",
    [articleId]
  );
  for (const v of variantes) {
    v.valeurs = await adapter.all(
      "SELECT avv.declinaison_type_id, dt.nom AS type_nom, dt.code AS type_code, " +
      "avv.declinaison_valeur_id, dv.valeur, dv.couleur_hex " +
      "FROM article_variante_valeurs avv " +
      "JOIN declinaison_types dt ON dt.id = avv.declinaison_type_id " +
      "JOIN declinaison_valeurs dv ON dv.id = avv.declinaison_valeur_id " +
      "WHERE avv.article_variante_id = ? ORDER BY dt.ordre",
      [v.id]
    );
  }
  return variantes;
}

async function getVariante(adapter, varianteId) {
  const v = await adapter.get("SELECT * FROM article_variantes WHERE id = ?", [varianteId]);
  if (!v) return null;
  v.valeurs = await adapter.all(
    "SELECT avv.declinaison_type_id, dt.nom AS type_nom, dt.code AS type_code, " +
    "avv.declinaison_valeur_id, dv.valeur, dv.couleur_hex " +
    "FROM article_variante_valeurs avv " +
    "JOIN declinaison_types dt ON dt.id = avv.declinaison_type_id " +
    "JOIN declinaison_valeurs dv ON dv.id = avv.declinaison_valeur_id " +
    "WHERE avv.article_variante_id = ? ORDER BY dt.ordre",
    [varianteId]
  );
  return v;
}

function produitCartesien(selections) {
  const typeIds = Object.keys(selections).filter((k) => selections[k] && selections[k].length > 0);
  if (typeIds.length === 0) return [];
  let combinaisons = [[]];
  for (const typeId of typeIds) {
    const suivantes = [];
    for (const combo of combinaisons) {
      for (const valeurId of selections[typeId]) {
        suivantes.push(combo.concat([{ typeId: Number(typeId), valeurId: Number(valeurId) }]));
      }
    }
    combinaisons = suivantes;
  }
  return combinaisons;
}

// GROUP_CONCAT (SQLite uniquement) remplacé par un calcul des clés existantes en JavaScript, via
// listVariantes() — voir explication en tête de fichier. Portable par construction.
async function genererVariantes(adapter, articleId, selections) {
  const article = await adapter.get("SELECT id FROM articles WHERE id = ?", [articleId]);
  if (!article) throw new Error("Article introuvable.");

  const combinaisons = produitCartesien(selections);
  if (combinaisons.length === 0) throw new Error("Sélectionnez au moins une valeur pour générer des déclinaisons.");

  const existantes = await listVariantes(adapter, articleId, { includeInactive: true });
  const clesExistantes = new Set(
    existantes.map((v) => cleCombo(v.valeurs.map((x) => ({ typeId: x.declinaison_type_id, valeurId: x.declinaison_valeur_id }))))
  );

  let creees = 0;
  await adapter.transaction(async (tx) => {
    for (const combo of combinaisons) {
      const cle = cleCombo(combo);
      if (clesExistantes.has(cle)) continue;

      const info = await tx.run("INSERT INTO article_variantes (article_id) VALUES (?) RETURNING id", [articleId]);
      for (const c of combo) {
        await tx.run("INSERT INTO article_variante_valeurs (article_variante_id, declinaison_type_id, declinaison_valeur_id) VALUES (?, ?, ?)", [info.lastInsertRowid, c.typeId, c.valeurId]);
      }
      clesExistantes.add(cle);
      creees += 1;
    }
  });

  return {
    total_attendu: combinaisons.length,
    deja_existantes: combinaisons.length - creees,
    creees,
    total: combinaisons.length,
    variantes: await listVariantes(adapter, articleId, { includeInactive: true }),
  };
}

async function updateVariante(adapter, varianteId, patch) {
  const v = await adapter.get("SELECT * FROM article_variantes WHERE id = ?", [varianteId]);
  if (!v) throw new Error("Variante introuvable.");
  const champs = ["sku", "code_barres", "reference_interne", "actif"];
  const fields = champs.filter((f) => patch[f] !== undefined);
  if (fields.length > 0) {
    const valeurs = fields.map((f) => (f === "actif" ? (patch[f] ? 1 : 0) : patch[f]));
    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    await adapter.run(`UPDATE article_variantes SET ${setClause} WHERE id = ?`, [...valeurs, varianteId]);
  }
  return getVariante(adapter, varianteId);
}

async function deleteVariante(adapter, varianteId) {
  const v = await adapter.get("SELECT * FROM article_variantes WHERE id = ?", [varianteId]);
  if (!v) throw new Error("Variante introuvable.");
  await adapter.run("DELETE FROM article_variantes WHERE id = ?", [varianteId]);
  return { deleted: true };
}

module.exports = {
  listTypes, createType, updateType, reorderTypes,
  listValeurs, createValeur, updateValeur, reorderValeurs,
  getArticleDeclinaisonTypes, setArticleDeclinaisonTypes, getArticleDeclinaisonValeurs,
  articleHasVariantes, previsualiserImpact, appliquerConfiguration,
  listVariantes, getVariante, genererVariantes, updateVariante, deleteVariante,
};
