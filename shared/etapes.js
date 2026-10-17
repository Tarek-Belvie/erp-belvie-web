// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — etapes (étapes de production).
//
// Adaptée de electron/ipc/etapes.js pour la Phase 1. Comportement identique
// visé sur SQLite ET PostgreSQL, vérifié par le script comparatif
// server/test-etapes-comparaison.js — jamais supposé.
//
// Point de vigilance RÉEL trouvé et corrigé en adaptant (testé avec du vrai
// code des deux côtés avant d'écrire quoi que ce soit ici) :
//
//   La détection de doublon utilisait `LOWER(TRIM(libelle)) = LOWER(TRIM(?))`
//   en SQL. Or LOWER() ne se comporte PAS pareil sur les deux moteurs pour
//   les caractères accentués :
//     - SQLite  : LOWER() ne replie QUE les lettres ASCII (A-Z). "ÉTAPE" et
//       "étape" restent DIFFÉRENTS (vérifié : LOWER('ÉTAPE') = 'Étape').
//     - PostgreSQL : LOWER() replie aussi les accents (locale-consciente).
//       "ÉTAPE" et "étape" deviennent ÉGAUX (vérifié : les deux donnent
//       'étape').
//   Contrairement au problème de tri déjà résolu pour listes_valeurs (fixé
//   par COLLATE "C" sur la colonne), celui-ci ne se corrige PAS au niveau du
//   schéma : COLLATE agit sur la comparaison, pas sur ce que LOWER()
//   calcule. La comparaison de doublon est donc faite ICI, en JavaScript
//   pur (lowerAsciiSeul), identique sur les deux moteurs par construction —
//   plus aucune trace de LOWER() SQL dans ce fichier.
//
// electron/ipc/etapes.js n'est PAS modifié.
// ============================================================================

// Reproduit exactement le LOWER() de SQLite : replie UNIQUEMENT les lettres
// ASCII A-Z, laisse tout caractère accentué inchangé (jamais de repli
// Unicode complet, contrairement à PostgreSQL).
function lowerAsciiSeul(s) {
  return String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
}

function slugify(text) {
  const base = String(text)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // enlève les accents
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return base || "etape";
}

const EDITABLE_FIELDS = ["libelle", "ordre", "optionnelle", "actif"];

async function list(adapter, { includeInactive = false } = {}) {
  const where = includeInactive ? "" : "WHERE actif = 1";
  return adapter.all(`SELECT * FROM etapes ${where} ORDER BY ordre ASC`, []);
}

// Comparaison de doublon en JavaScript, jamais en SQL — voir explication en
// tête de fichier. Ne filtre PAS sur `actif` : un libellé désactivé bloque
// toujours la création d'un doublon (comportement exact de la référence,
// aucune réactivation automatique ici, contrairement à listes.js).
async function assertUniqueLibelle(adapter, libelle, excludeId) {
  const toutes = await adapter.all("SELECT id, libelle FROM etapes WHERE id <> ?", [excludeId ?? -1]);
  const cible = lowerAsciiSeul(String(libelle).trim());
  const dup = toutes.find((e) => lowerAsciiSeul(String(e.libelle).trim()) === cible);
  if (dup) throw new Error(`Une étape nommée "${libelle}" existe déjà.`);
}

async function create(adapter, payload) {
  const libelle = String(payload.libelle || "").trim();
  if (!libelle) throw new Error("Le nom de l'étape ne peut pas être vide.");
  await assertUniqueLibelle(adapter, libelle);

  const maxRow = await adapter.get("SELECT MAX(ordre) AS m FROM etapes", []);
  const maxOrdre = (maxRow && maxRow.m) || 0;

  let cle = slugify(libelle);
  let suffix = 2;
  while (await adapter.get("SELECT 1 AS x FROM etapes WHERE cle = ?", [cle])) {
    cle = `${slugify(libelle)}_${suffix++}`;
  }

  const info = await adapter.run(
    "INSERT INTO etapes (cle, libelle, pourcentage, ordre, optionnelle, actif) VALUES (?, ?, 0, ?, ?, 1) RETURNING id",
    [cle, libelle, payload.ordre || maxOrdre + 1, payload.optionnelle ? 1 : 0]
  );
  return adapter.get("SELECT * FROM etapes WHERE id = ?", [info.lastInsertRowid]);
}

async function update(adapter, id, payload) {
  const current = await adapter.get("SELECT * FROM etapes WHERE id = ?", [id]);
  if (!current) throw new Error("Étape introuvable.");

  let finalPayload = { ...payload };
  if (finalPayload.libelle !== undefined) {
    const libelle = String(finalPayload.libelle).trim();
    if (!libelle) throw new Error("Le nom de l'étape ne peut pas être vide.");
    await assertUniqueLibelle(adapter, libelle, id);
    finalPayload.libelle = libelle;
  }

  const fields = Object.keys(finalPayload).filter((k) => EDITABLE_FIELDS.includes(k));
  if (fields.length === 0) return current;

  for (const boolField of ["actif", "optionnelle"]) {
    if (typeof finalPayload[boolField] === "boolean") finalPayload[boolField] = finalPayload[boolField] ? 1 : 0;
  }

  const setClause = fields.map((f) => `${f} = ?`).join(", ");
  const valeurs = fields.map((f) => finalPayload[f]);
  await adapter.run(`UPDATE etapes SET ${setClause} WHERE id = ?`, [...valeurs, id]);
  return adapter.get("SELECT * FROM etapes WHERE id = ?", [id]);
}

module.exports = { list, create, update };
