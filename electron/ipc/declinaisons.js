const { normalizeNom } = require("../db/normalize");

function genererCode(db, nom) {
  const base = String(nom || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "type";
  let code = base;
  let n = 2;
  const exists = db.prepare("SELECT 1 FROM declinaison_types WHERE code = ?");
  while (exists.get(code)) { code = base + "_" + n; n += 1; }
  return code;
}

function listTypes(db, options) {
  const includeInactive = options && options.includeInactive;
  const types = db.prepare(
    "SELECT * FROM declinaison_types " + (includeInactive ? "" : "WHERE actif = 1 ") + "ORDER BY ordre, nom"
  ).all();
  const countStmt = db.prepare("SELECT COUNT(*) AS n FROM declinaison_valeurs WHERE declinaison_type_id = ?");
  return types.map(function (t) { return Object.assign({}, t, { nb_valeurs: countStmt.get(t.id).n }); });
}

function createType(db, nom, options) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom du type de déclinaison est obligatoire.");
  const nomNormalise = normalizeNom(nomTrim);
  if (db.prepare("SELECT 1 FROM declinaison_types WHERE nom_normalise = ?").get(nomNormalise)) {
    throw new Error("Un type de déclinaison avec ce nom existe déjà.");
  }
  const code = genererCode(db, nomTrim);
  const affichageCouleur = options && options.affichage_couleur ? 1 : 0;
  const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM declinaison_types").get().m || 0;
  const info = db.prepare(
    "INSERT INTO declinaison_types (code, nom, nom_normalise, affichage_couleur, ordre) VALUES (?, ?, ?, ?, ?)"
  ).run(code, nomTrim, nomNormalise, affichageCouleur, maxOrdre + 1);
  return db.prepare("SELECT * FROM declinaison_types WHERE id = ?").get(info.lastInsertRowid);
}

function updateType(db, id, patch) {
  const type = db.prepare("SELECT * FROM declinaison_types WHERE id = ?").get(id);
  if (!type) throw new Error("Type de déclinaison introuvable.");
  if (patch.nom !== undefined) {
    const nomTrim = String(patch.nom || "").trim();
    if (!nomTrim) throw new Error("Le nom du type de déclinaison est obligatoire.");
    const nomNormalise = normalizeNom(nomTrim);
    const doublon = db.prepare("SELECT 1 FROM declinaison_types WHERE nom_normalise = ? AND id <> ?").get(nomNormalise, id);
    if (doublon) throw new Error("Un type de déclinaison avec ce nom existe déjà.");
    db.prepare("UPDATE declinaison_types SET nom = ?, nom_normalise = ? WHERE id = ?").run(nomTrim, nomNormalise, id);
  }
  if (patch.affichage_couleur !== undefined) {
    db.prepare("UPDATE declinaison_types SET affichage_couleur = ? WHERE id = ?").run(patch.affichage_couleur ? 1 : 0, id);
  }
  if (patch.actif !== undefined) {
    db.prepare("UPDATE declinaison_types SET actif = ? WHERE id = ?").run(patch.actif ? 1 : 0, id);
  }
  return db.prepare("SELECT * FROM declinaison_types WHERE id = ?").get(id);
}

function listValeurs(db, typeId, options) {
  const includeInactive = options && options.includeInactive;
  return db.prepare(
    "SELECT * FROM declinaison_valeurs WHERE declinaison_type_id = ? " + (includeInactive ? "" : "AND actif = 1 ") + "ORDER BY ordre, valeur"
  ).all(typeId);
}

function createValeur(db, typeId, valeur, options) {
  const type = db.prepare("SELECT * FROM declinaison_types WHERE id = ?").get(typeId);
  if (!type) throw new Error("Type de déclinaison introuvable.");
  const valeurTrim = String(valeur || "").trim();
  if (!valeurTrim) throw new Error("La valeur est obligatoire.");
  const valeurNormalisee = normalizeNom(valeurTrim);
  if (db.prepare("SELECT 1 FROM declinaison_valeurs WHERE declinaison_type_id = ? AND valeur_normalisee = ?").get(typeId, valeurNormalisee)) {
    throw new Error("Cette valeur existe déjà pour ce type de déclinaison.");
  }
  const couleurHex = options && options.couleur_hex ? String(options.couleur_hex).trim() : null;
  if (couleurHex && !/^#[0-9a-fA-F]{6}$/.test(couleurHex)) {
    throw new Error("Le code couleur doit être au format hexadécimal (ex : #1A2B3C).");
  }
  const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM declinaison_valeurs WHERE declinaison_type_id = ?").get(typeId).m || 0;
  const info = db.prepare(
    "INSERT INTO declinaison_valeurs (declinaison_type_id, valeur, valeur_normalisee, couleur_hex, ordre) VALUES (?, ?, ?, ?, ?)"
  ).run(typeId, valeurTrim, valeurNormalisee, couleurHex, maxOrdre + 1);
  return db.prepare("SELECT * FROM declinaison_valeurs WHERE id = ?").get(info.lastInsertRowid);
}

function updateValeur(db, id, patch) {
  const val = db.prepare("SELECT * FROM declinaison_valeurs WHERE id = ?").get(id);
  if (!val) throw new Error("Valeur introuvable.");
  if (patch.valeur !== undefined) {
    const valeurTrim = String(patch.valeur || "").trim();
    if (!valeurTrim) throw new Error("La valeur est obligatoire.");
    const valeurNormalisee = normalizeNom(valeurTrim);
    const doublon = db.prepare("SELECT 1 FROM declinaison_valeurs WHERE declinaison_type_id = ? AND valeur_normalisee = ? AND id <> ?").get(val.declinaison_type_id, valeurNormalisee, id);
    if (doublon) throw new Error("Cette valeur existe déjà pour ce type de déclinaison.");
    db.prepare("UPDATE declinaison_valeurs SET valeur = ?, valeur_normalisee = ? WHERE id = ?").run(valeurTrim, valeurNormalisee, id);
  }
  if (patch.couleur_hex !== undefined) {
    const couleurHex = patch.couleur_hex ? String(patch.couleur_hex).trim() : null;
    if (couleurHex && !/^#[0-9a-fA-F]{6}$/.test(couleurHex)) {
      throw new Error("Le code couleur doit être au format hexadécimal (ex : #1A2B3C).");
    }
    db.prepare("UPDATE declinaison_valeurs SET couleur_hex = ? WHERE id = ?").run(couleurHex, id);
  }
  if (patch.actif !== undefined) {
    db.prepare("UPDATE declinaison_valeurs SET actif = ? WHERE id = ?").run(patch.actif ? 1 : 0, id);
  }
  return db.prepare("SELECT * FROM declinaison_valeurs WHERE id = ?").get(id);
}

function getArticleDeclinaisonTypes(db, articleId) {
  return db.prepare(
    "SELECT adt.id AS association_id, adt.ordre, dt.* " +
    "FROM article_declinaison_types adt " +
    "JOIN declinaison_types dt ON dt.id = adt.declinaison_type_id " +
    "WHERE adt.article_id = ? ORDER BY adt.ordre"
  ).all(articleId);
}

function setArticleDeclinaisonTypes(db, articleId, typeIds) {
  const tx = db.transaction(function () {
    db.prepare("DELETE FROM article_declinaison_types WHERE article_id = ?").run(articleId);
    const insert = db.prepare("INSERT INTO article_declinaison_types (article_id, declinaison_type_id, ordre) VALUES (?, ?, ?)");
    typeIds.forEach(function (typeId, i) { insert.run(articleId, typeId, i); });
  });
  tx();
  return getArticleDeclinaisonTypes(db, articleId);
}

function articleHasVariantes(db, articleId) {
  const row = db.prepare("SELECT COUNT(*) AS n FROM article_variantes WHERE article_id = ?").get(articleId);
  return row.n > 0;
}

function reorderTypes(db, orderedIds) {
  const update = db.prepare("UPDATE declinaison_types SET ordre = ? WHERE id = ?");
  const tx = db.transaction(function () { orderedIds.forEach(function (id, i) { update.run(i, id); }); });
  tx();
  return listTypes(db, { includeInactive: true });
}

function reorderValeurs(db, typeId, orderedIds) {
  const update = db.prepare("UPDATE declinaison_valeurs SET ordre = ? WHERE id = ? AND declinaison_type_id = ?");
  const tx = db.transaction(function () { orderedIds.forEach(function (id, i) { update.run(i, id, typeId); }); });
  tx();
  return listValeurs(db, typeId, { includeInactive: true });
}

function getArticleDeclinaisonValeurs(db, articleId) {
  return db.prepare(
    "SELECT adv.declinaison_type_id, adv.declinaison_valeur_id, dv.valeur, dv.couleur_hex, dv.ordre " +
    "FROM article_declinaison_valeurs adv " +
    "JOIN declinaison_valeurs dv ON dv.id = adv.declinaison_valeur_id " +
    "WHERE adv.article_id = ? ORDER BY dv.ordre"
  ).all(articleId);
}

function cleCombo(paires) {
  return paires.map(function (p) { return p.typeId + ":" + p.valeurId; }).sort().join(",");
}

// Compare la configuration ACTUELLE d'un article à une NOUVELLE sélection proposée, et détaille
// précisément l'impact avant toute confirmation — jamais un avertissement générique. Distingue
// 4 catégories : conservées (déjà actives), à réactiver (existent mais désactivées, redeviennent
// valides), nouvelles (à créer), obsolètes (actives aujourd'hui, à désactiver).
function previsualiserImpact(db, articleId, selections) {
  const combinaisons = produitCartesien(selections);
  const clesAttendues = new Set(combinaisons.map(function (c) { return cleCombo(c); }));

  const existantes = listVariantes(db, articleId, { includeInactive: true });
  let conservees = 0;
  const aReactiverIds = [];
  const obsoletesIds = [];
  const clesExistantes = new Set();
  for (const v of existantes) {
    const paires = v.valeurs.map(function (x) { return { typeId: x.declinaison_type_id, valeurId: x.declinaison_valeur_id }; });
    const cle = cleCombo(paires);
    clesExistantes.add(cle);
    if (clesAttendues.has(cle)) {
      if (v.actif) conservees += 1;
      else aReactiverIds.push(v.id);
    } else if (v.actif) {
      obsoletesIds.push(v.id);
    }
  }
  const nouvelles = combinaisons.filter(function (c) { return !clesExistantes.has(cleCombo(c)); }).length;

  return {
    total_attendu: combinaisons.length,
    conservees: conservees,
    a_reactiver: aReactiverIds.length,
    a_reactiver_ids: aReactiverIds,
    nouvelles: nouvelles,
    obsoletes: obsoletesIds.length,
    obsoletes_ids: obsoletesIds,
    deja_utilisees_ailleurs: 0, // Phase 1 : rien ne référence encore article_variantes ; prévu pour la Phase 2
  };
}

// Applique la nouvelle configuration : types associés, valeurs autorisées par type, désactivation
// (jamais suppression physique) des variantes devenues obsolètes, ET réactivation de celles dont
// la combinaison redevient valide. Ne génère PAS les nouvelles variantes : ça reste l'action
// séparée de l'assistant.
function appliquerConfiguration(db, articleId, typeIds, selections) {
  const impact = previsualiserImpact(db, articleId, selections);

  const tx = db.transaction(function () {
    db.prepare("DELETE FROM article_declinaison_types WHERE article_id = ?").run(articleId);
    const insertType = db.prepare("INSERT INTO article_declinaison_types (article_id, declinaison_type_id, ordre) VALUES (?, ?, ?)");
    typeIds.forEach(function (typeId, i) { insertType.run(articleId, typeId, i); });

    db.prepare("DELETE FROM article_declinaison_valeurs WHERE article_id = ?").run(articleId);
    const insertValeur = db.prepare("INSERT INTO article_declinaison_valeurs (article_id, declinaison_type_id, declinaison_valeur_id) VALUES (?, ?, ?)");
    Object.keys(selections).forEach(function (typeId) {
      (selections[typeId] || []).forEach(function (valeurId) {
        insertValeur.run(articleId, Number(typeId), Number(valeurId));
      });
    });

    if (impact.obsoletes_ids.length > 0) {
      const desactiver = db.prepare("UPDATE article_variantes SET actif = 0 WHERE id = ?");
      impact.obsoletes_ids.forEach(function (id) { desactiver.run(id); });
    }
    if (impact.a_reactiver_ids.length > 0) {
      const reactiver = db.prepare("UPDATE article_variantes SET actif = 1 WHERE id = ?");
      impact.a_reactiver_ids.forEach(function (id) { reactiver.run(id); });
    }
  });
  tx();

  return { types: getArticleDeclinaisonTypes(db, articleId), valeurs: getArticleDeclinaisonValeurs(db, articleId), impact: impact };
}

function listVariantes(db, articleId, options) {
  const includeInactive = options && options.includeInactive;
  const variantes = db.prepare(
    "SELECT * FROM article_variantes WHERE article_id = ? " + (includeInactive ? "" : "AND actif = 1 ") + "ORDER BY id"
  ).all(articleId);
  const valeursStmt = db.prepare(
    "SELECT avv.declinaison_type_id, dt.nom AS type_nom, dt.code AS type_code, " +
    "avv.declinaison_valeur_id, dv.valeur, dv.couleur_hex " +
    "FROM article_variante_valeurs avv " +
    "JOIN declinaison_types dt ON dt.id = avv.declinaison_type_id " +
    "JOIN declinaison_valeurs dv ON dv.id = avv.declinaison_valeur_id " +
    "WHERE avv.article_variante_id = ? ORDER BY dt.ordre"
  );
  return variantes.map(function (v) {
    return Object.assign({}, v, { valeurs: valeursStmt.all(v.id) });
  });
}

function getVariante(db, varianteId) {
  const v = db.prepare("SELECT * FROM article_variantes WHERE id = ?").get(varianteId);
  if (!v) return null;
  const valeurs = db.prepare(
    "SELECT avv.declinaison_type_id, dt.nom AS type_nom, dt.code AS type_code, " +
    "avv.declinaison_valeur_id, dv.valeur, dv.couleur_hex " +
    "FROM article_variante_valeurs avv " +
    "JOIN declinaison_types dt ON dt.id = avv.declinaison_type_id " +
    "JOIN declinaison_valeurs dv ON dv.id = avv.declinaison_valeur_id " +
    "WHERE avv.article_variante_id = ? ORDER BY dt.ordre"
  ).all(varianteId);
  return Object.assign({}, v, { valeurs: valeurs });
}

function produitCartesien(selections) {
  const typeIds = Object.keys(selections).filter(function (k) { return selections[k] && selections[k].length > 0; });
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

function genererVariantes(db, articleId, selections) {
  const article = db.prepare("SELECT id FROM articles WHERE id = ?").get(articleId);
  if (!article) throw new Error("Article introuvable.");

  const combinaisons = produitCartesien(selections);
  if (combinaisons.length === 0) throw new Error("Sélectionnez au moins une valeur pour générer des déclinaisons.");

  const existantes = db.prepare(
    "SELECT av.id, GROUP_CONCAT(avv.declinaison_type_id || ':' || avv.declinaison_valeur_id) AS cle " +
    "FROM article_variantes av " +
    "JOIN article_variante_valeurs avv ON avv.article_variante_id = av.id " +
    "WHERE av.article_id = ? GROUP BY av.id"
  ).all(articleId);
  const clesExistantes = new Set(existantes.map(function (e) { return e.cle.split(",").sort().join(","); }));

  let creees = 0;
  const tx = db.transaction(function () {
    const insertVariante = db.prepare("INSERT INTO article_variantes (article_id) VALUES (?)");
    const insertValeur = db.prepare("INSERT INTO article_variante_valeurs (article_variante_id, declinaison_type_id, declinaison_valeur_id) VALUES (?, ?, ?)");

    for (const combo of combinaisons) {
      const cle = combo.map(function (c) { return c.typeId + ":" + c.valeurId; }).sort().join(",");
      if (clesExistantes.has(cle)) continue;

      const info = insertVariante.run(articleId);
      for (const c of combo) insertValeur.run(info.lastInsertRowid, c.typeId, c.valeurId);
      clesExistantes.add(cle);
      creees += 1;
    }
  });
  tx();
  return {
    total_attendu: combinaisons.length,
    deja_existantes: combinaisons.length - creees,
    creees: creees,
    total: combinaisons.length,
    variantes: listVariantes(db, articleId, { includeInactive: true }),
  };
}

function updateVariante(db, varianteId, patch) {
  const v = db.prepare("SELECT * FROM article_variantes WHERE id = ?").get(varianteId);
  if (!v) throw new Error("Variante introuvable.");
  const champs = ["sku", "code_barres", "reference_interne", "actif"];
  const fields = champs.filter(function (f) { return patch[f] !== undefined; });
  if (fields.length > 0) {
    const params = { id: varianteId };
    fields.forEach(function (f) { params[f] = f === "actif" ? (patch[f] ? 1 : 0) : patch[f]; });
    const setClause = fields.map(function (f) { return f + " = @" + f; }).join(", ");
    db.prepare("UPDATE article_variantes SET " + setClause + " WHERE id = @id").run(params);
  }
  return getVariante(db, varianteId);
}

function deleteVariante(db, varianteId) {
  const v = db.prepare("SELECT * FROM article_variantes WHERE id = ?").get(varianteId);
  if (!v) throw new Error("Variante introuvable.");
  db.prepare("DELETE FROM article_variantes WHERE id = ?").run(varianteId);
  return { deleted: true };
}

module.exports = {
  listTypes: listTypes,
  createType: createType,
  updateType: updateType,
  reorderTypes: reorderTypes,
  listValeurs: listValeurs,
  createValeur: createValeur,
  updateValeur: updateValeur,
  reorderValeurs: reorderValeurs,
  getArticleDeclinaisonTypes: getArticleDeclinaisonTypes,
  setArticleDeclinaisonTypes: setArticleDeclinaisonTypes,
  getArticleDeclinaisonValeurs: getArticleDeclinaisonValeurs,
  articleHasVariantes: articleHasVariantes,
  previsualiserImpact: previsualiserImpact,
  appliquerConfiguration: appliquerConfiguration,
  listVariantes: listVariantes,
  getVariante: getVariante,
  genererVariantes: genererVariantes,
  updateVariante: updateVariante,
  deleteVariante: deleteVariante,
};
