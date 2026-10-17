// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — listes_valeurs (référentiels).
//
// Adaptée de electron/ipc/listes.js pour la Phase 1. Comportement identique
// visé sur SQLite ET PostgreSQL, vérifié par le script comparatif
// server/test-listes-comparaison.js — jamais supposé.
//
// Deux changements RÉELS par rapport à l'original (les seuls nécessaires,
// aucun autre) :
//   1. `db.prepare(...).get/all/run(...)` (synchrone, propre à better-sqlite3)
//      devient `await adapter.get/all/run(...)` (interface uniforme async,
//      voir shared/db-adapter.js) — plus aucune trace de better-sqlite3 ici.
//   2. `ORDER BY nom COLLATE NOCASE ASC` (syntaxe SQLite uniquement, absente
//      de PostgreSQL) devient `ORDER BY LOWER(nom) ASC` — standard SQL,
//      identique sur les deux moteurs. Testé explicitement avec des noms
//      accentués dans le script comparatif pour confirmer un tri identique.
//
// electron/ipc/listes.js n'est PAS modifié et reste la version utilisée par
// l'app Electron actuelle tant que le branchement (étape ultérieure,
// distincte) n'a pas été validé.
// ============================================================================

const TYPES = ["produit", "couleur", "responsable", "atelier", "taille", "saison", "rayon", "operateur", "coupe", "pointure", "categorie"];
const ORDERED_TYPES = ["taille", "saison", "rayon"];
const CODED_TYPES = ["saison", "rayon"];

function normalizeNom(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function normalizeCode(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

function assertType(type) {
  if (!TYPES.includes(type)) throw new Error("Type de liste inconnu.");
}

async function list(adapter, type, { includeInactive = false } = {}) {
  assertType(type);
  const where = includeInactive ? "WHERE type = ?" : "WHERE type = ? AND actif = 1";
  const orderBy = ORDERED_TYPES.includes(type)
    ? "ORDER BY ordre ASC, LOWER(nom) ASC"
    : "ORDER BY LOWER(nom) ASC";
  return adapter.all(`SELECT * FROM listes_valeurs ${where} ${orderBy}`, [type]);
}

function assertCodeValide(type, code) {
  if (!CODED_TYPES.includes(type)) return null;
  const norm = normalizeCode(code);
  if (!norm) throw new Error("Le code est obligatoire pour ce type de liste.");
  if (!/^[A-Z0-9]{1,6}$/.test(norm)) {
    throw new Error("Le code doit contenir uniquement des lettres et des chiffres (6 caractères maximum).");
  }
  return norm;
}

async function create(adapter, type, nom, opts = {}) {
  assertType(type);
  const trimmed = String(nom || "").trim();
  if (!trimmed) throw new Error("Le nom ne peut pas être vide.");
  const norm = normalizeNom(trimmed);

  const existing = await adapter.get("SELECT id, nom, actif FROM listes_valeurs WHERE type = ? AND nom_normalise = ?", [type, norm]);
  if (existing) {
    if (!existing.actif) {
      await adapter.run("UPDATE listes_valeurs SET actif = 1 WHERE id = ?", [existing.id]);
      return adapter.get("SELECT * FROM listes_valeurs WHERE id = ?", [existing.id]);
    }
    throw new Error(`"${existing.nom}" existe déjà dans cette liste.`);
  }

  const code = assertCodeValide(type, opts.code);
  if (code) {
    const dupCode = await adapter.get("SELECT nom FROM listes_valeurs WHERE type = ? AND code = ?", [type, code]);
    if (dupCode) throw new Error(`Le code "${code}" est déjà utilisé par "${dupCode.nom}".`);
  }

  let finalOrdre = null;
  if (ORDERED_TYPES.includes(type)) {
    if (opts.ordre !== undefined && opts.ordre !== null) {
      finalOrdre = Number(opts.ordre);
    } else {
      const maxRow = await adapter.get("SELECT MAX(ordre) AS m FROM listes_valeurs WHERE type = ?", [type]);
      finalOrdre = (maxRow && maxRow.m) || 0;
      finalOrdre += 1;
    }
  }

  const info = await adapter.run(
    "INSERT INTO listes_valeurs (type, nom, nom_normalise, code, ordre, actif) VALUES (?, ?, ?, ?, ?, 1) RETURNING id",
    [type, trimmed, norm, code, finalOrdre]
  );
  return adapter.get("SELECT * FROM listes_valeurs WHERE id = ?", [info.lastInsertRowid]);
}

async function update(adapter, id, patch) {
  const current = await adapter.get("SELECT * FROM listes_valeurs WHERE id = ?", [id]);
  if (!current) throw new Error("Valeur introuvable.");

  if (patch.nom !== undefined) {
    const trimmed = String(patch.nom).trim();
    if (!trimmed) throw new Error("Le nom ne peut pas être vide.");
    const norm = normalizeNom(trimmed);
    const dup = await adapter.get("SELECT id FROM listes_valeurs WHERE type = ? AND nom_normalise = ? AND id <> ?", [current.type, norm, id]);
    if (dup) throw new Error(`"${trimmed}" existe déjà dans cette liste.`);
    await adapter.run("UPDATE listes_valeurs SET nom = ?, nom_normalise = ? WHERE id = ?", [trimmed, norm, id]);
  }

  if (patch.code !== undefined) {
    const code = assertCodeValide(current.type, patch.code);
    if (code) {
      const dupCode = await adapter.get("SELECT nom FROM listes_valeurs WHERE type = ? AND code = ? AND id <> ?", [current.type, code, id]);
      if (dupCode) throw new Error(`Le code "${code}" est déjà utilisé par "${dupCode.nom}".`);
    }
    await adapter.run("UPDATE listes_valeurs SET code = ? WHERE id = ?", [code, id]);
  }

  if (patch.actif !== undefined) {
    await adapter.run("UPDATE listes_valeurs SET actif = ? WHERE id = ?", [patch.actif ? 1 : 0, id]);
  }

  if (patch.ordre !== undefined) {
    await adapter.run("UPDATE listes_valeurs SET ordre = ? WHERE id = ?", [Number(patch.ordre), id]);
  }

  if (patch.responsable_nom !== undefined) {
    const val = patch.responsable_nom == null ? null : String(patch.responsable_nom).trim() || null;
    await adapter.run("UPDATE listes_valeurs SET responsable_nom = ? WHERE id = ?", [val, id]);
  }

  return adapter.get("SELECT * FROM listes_valeurs WHERE id = ?", [id]);
}

module.exports = { list, create, update, TYPES, ORDERED_TYPES, CODED_TYPES };
