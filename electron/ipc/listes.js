const { normalizeNom, normalizeCode } = require("../db/normalize");

const TYPES = ["produit", "couleur", "responsable", "atelier", "taille", "saison", "rayon", "operateur", "coupe", "pointure", "categorie"];
// Types pour lesquels l'ordre d'affichage est pertinent (tailles, saisons, rayons).
const ORDERED_TYPES = ["taille", "saison", "rayon"];
// Types qui portent un code court unique (utilisé par le générateur de référence article).
const CODED_TYPES = ["saison", "rayon"];

function assertType(type) {
  if (!TYPES.includes(type)) throw new Error("Type de liste inconnu.");
}

// parentId : filtre les valeurs rattachees a une valeur parente (Type d'article -> Categorie via
// listes_valeurs.parent_id). C'est ce qui rend impossible une combinaison incoherente du genre
// « T-shirts et Polos » avec « Jean » : Jean n'est pas un enfant de cette categorie.
// La colonne peut ne pas exister sur une base anterieure a D2 : on l'ignore alors silencieusement.
function list(db, type, { includeInactive = false, parentId = undefined } = {}) {
  assertType(type);
  const aParent = db.prepare("PRAGMA table_info(listes_valeurs)").all().some((c) => c.name === "parent_id");
  const filtreParent = parentId !== undefined && parentId !== null && aParent ? " AND parent_id = " + Number(parentId) : "";
  const where = (includeInactive ? "WHERE type = ?" : "WHERE type = ? AND actif = 1") + filtreParent;
  const orderBy = ORDERED_TYPES.includes(type)
    ? "ORDER BY ordre ASC, nom COLLATE NOCASE ASC"
    : "ORDER BY nom COLLATE NOCASE ASC";
  return db.prepare(`SELECT * FROM listes_valeurs ${where} ${orderBy}`).all(type);
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

function create(db, type, nom, opts = {}) {
  assertType(type);
  const trimmed = String(nom || "").trim();
  if (!trimmed) throw new Error("Le nom ne peut pas être vide.");
  const norm = normalizeNom(trimmed);

  const existing = db.prepare("SELECT id, nom, actif FROM listes_valeurs WHERE type = ? AND nom_normalise = ?").get(type, norm);
  if (existing) {
    if (!existing.actif) {
      // On réactive plutôt que de créer un doublon si la même valeur avait été désactivée.
      db.prepare("UPDATE listes_valeurs SET actif = 1 WHERE id = ?").run(existing.id);
      return db.prepare("SELECT * FROM listes_valeurs WHERE id = ?").get(existing.id);
    }
    throw new Error(`"${existing.nom}" existe déjà dans cette liste.`);
  }

  const code = assertCodeValide(type, opts.code);
  if (code) {
    const dupCode = db.prepare("SELECT nom FROM listes_valeurs WHERE type = ? AND code = ?").get(type, code);
    if (dupCode) throw new Error(`Le code "${code}" est déjà utilisé par "${dupCode.nom}".`);
  }

  let finalOrdre = null;
  if (ORDERED_TYPES.includes(type)) {
    if (opts.ordre !== undefined && opts.ordre !== null) {
      finalOrdre = Number(opts.ordre);
    } else {
      const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM listes_valeurs WHERE type = ?").get(type).m || 0;
      finalOrdre = maxOrdre + 1;
    }
  }

  const aParent = db.prepare("PRAGMA table_info(listes_valeurs)").all().some((c) => c.name === "parent_id");
  const parentId = aParent && opts.parent_id != null ? Number(opts.parent_id) : null;
  const info = aParent
    ? db.prepare("INSERT INTO listes_valeurs (type, nom, nom_normalise, code, ordre, actif, parent_id) VALUES (?, ?, ?, ?, ?, 1, ?)")
        .run(type, trimmed, norm, code, finalOrdre, parentId)
    : db.prepare("INSERT INTO listes_valeurs (type, nom, nom_normalise, code, ordre, actif) VALUES (?, ?, ?, ?, ?, 1)")
        .run(type, trimmed, norm, code, finalOrdre);
  return db.prepare("SELECT * FROM listes_valeurs WHERE id = ?").get(info.lastInsertRowid);
}

function update(db, id, patch) {
  const current = db.prepare("SELECT * FROM listes_valeurs WHERE id = ?").get(id);
  if (!current) throw new Error("Valeur introuvable.");

  if (patch.nom !== undefined) {
    const trimmed = String(patch.nom).trim();
    if (!trimmed) throw new Error("Le nom ne peut pas être vide.");
    const norm = normalizeNom(trimmed);
    const dup = db.prepare("SELECT id FROM listes_valeurs WHERE type = ? AND nom_normalise = ? AND id <> ?").get(current.type, norm, id);
    if (dup) throw new Error(`"${trimmed}" existe déjà dans cette liste.`);
    db.prepare("UPDATE listes_valeurs SET nom = ?, nom_normalise = ? WHERE id = ?").run(trimmed, norm, id);
  }

  if (patch.code !== undefined) {
    const code = assertCodeValide(current.type, patch.code);
    if (code) {
      const dupCode = db.prepare("SELECT nom FROM listes_valeurs WHERE type = ? AND code = ? AND id <> ?").get(current.type, code, id);
      if (dupCode) throw new Error(`Le code "${code}" est déjà utilisé par "${dupCode.nom}".`);
    }
    db.prepare("UPDATE listes_valeurs SET code = ? WHERE id = ?").run(code, id);
  }

  if (patch.actif !== undefined) {
    db.prepare("UPDATE listes_valeurs SET actif = ? WHERE id = ?").run(patch.actif ? 1 : 0, id);
  }

  if (patch.ordre !== undefined) {
    db.prepare("UPDATE listes_valeurs SET ordre = ? WHERE id = ?").run(Number(patch.ordre), id);
  }

  if (patch.responsable_nom !== undefined) {
    const val = patch.responsable_nom == null ? null : String(patch.responsable_nom).trim() || null;
    db.prepare("UPDATE listes_valeurs SET responsable_nom = ? WHERE id = ?").run(val, id);
  }

  return db.prepare("SELECT * FROM listes_valeurs WHERE id = ?").get(id);
}

module.exports = { list, create, update, TYPES, ORDERED_TYPES, CODED_TYPES };
