function list(db, { includeInactive = false } = {}) {
  const where = includeInactive ? "" : "WHERE actif = 1";
  return db.prepare(`SELECT * FROM etapes ${where} ORDER BY ordre ASC`).all();
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

function assertUniqueLibelle(db, libelle, excludeId) {
  const dup = db
    .prepare("SELECT id FROM etapes WHERE LOWER(TRIM(libelle)) = LOWER(TRIM(?)) AND id <> ?")
    .get(libelle, excludeId ?? -1);
  if (dup) throw new Error(`Une étape nommée "${libelle}" existe déjà.`);
}

const EDITABLE_FIELDS = ["libelle", "ordre", "optionnelle", "actif"];

function update(db, id, payload) {
  const current = db.prepare("SELECT * FROM etapes WHERE id = ?").get(id);
  if (!current) throw new Error("Étape introuvable.");

  if (payload.libelle !== undefined) {
    const libelle = String(payload.libelle).trim();
    if (!libelle) throw new Error("Le nom de l'étape ne peut pas être vide.");
    assertUniqueLibelle(db, libelle, id);
    payload = { ...payload, libelle };
  }

  const fields = Object.keys(payload).filter((k) => EDITABLE_FIELDS.includes(k));
  if (fields.length === 0) return current;
  const bindable = { ...payload, id };
  // SQLite n'accepte pas les booléens JS comme paramètre lié : on les convertit en 0/1.
  for (const boolField of ["actif", "optionnelle"]) {
    if (typeof bindable[boolField] === "boolean") bindable[boolField] = bindable[boolField] ? 1 : 0;
  }
  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  db.prepare(`UPDATE etapes SET ${setClause} WHERE id = @id`).run(bindable);
  return db.prepare("SELECT * FROM etapes WHERE id = ?").get(id);
}

// Le pourcentage n'est plus piloté par l'interface (saisie simplifiée) : la colonne reste en
// base à 0 par défaut, disponible pour un futur suivi quantitatif sans être utilisée aujourd'hui.
function create(db, payload) {
  const libelle = String(payload.libelle || "").trim();
  if (!libelle) throw new Error("Le nom de l'étape ne peut pas être vide.");
  assertUniqueLibelle(db, libelle);

  const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM etapes").get().m || 0;

  let cle = slugify(libelle);
  let suffix = 2;
  while (db.prepare("SELECT 1 FROM etapes WHERE cle = ?").get(cle)) {
    cle = `${slugify(libelle)}_${suffix++}`;
  }

  const info = db
    .prepare(
      `INSERT INTO etapes (cle, libelle, pourcentage, ordre, optionnelle, actif) VALUES (@cle, @libelle, 0, @ordre, @optionnelle, 1)`
    )
    .run({
      cle,
      libelle,
      ordre: payload.ordre || maxOrdre + 1,
      optionnelle: payload.optionnelle ? 1 : 0,
    });
  return db.prepare("SELECT * FROM etapes WHERE id = ?").get(info.lastInsertRowid);
}

module.exports = { list, update, create };
