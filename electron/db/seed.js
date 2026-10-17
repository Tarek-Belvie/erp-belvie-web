const DEFAULTS = require("./defaults");
const { normalizeNom } = require("./normalize");

// Configuration structurelle uniquement : présente même sur une installation totalement vierge.
// Les données de démonstration (produits, couleurs, responsables, ateliers, opérateurs, articles,
// commandes) ne sont JAMAIS chargées ici — voir electron/db/demoData.js pour l'action explicite.

function seedEtapesIfEmpty(db) {
  const count = db.prepare("SELECT COUNT(*) AS n FROM etapes").get().n;
  if (count > 0) return;
  const insert = db.prepare(
    "INSERT INTO etapes (cle, libelle, pourcentage, ordre, optionnelle, actif) VALUES (@cle, @libelle, @pourcentage, @ordre, @optionnelle, 1)"
  );
  const tx = db.transaction((rows) => rows.forEach((r) => insert.run(r)));
  tx(DEFAULTS.ETAPES);
}

function seedListesStructurellesIfEmpty(db) {
  const insert = db.prepare(
    "INSERT INTO listes_valeurs (type, nom, nom_normalise, code, ordre, actif) VALUES (?, ?, ?, ?, ?, 1)"
  );
  function seedType(type, items, withCode) {
    const count = db.prepare("SELECT COUNT(*) AS n FROM listes_valeurs WHERE type = ?").get(type).n;
    if (count > 0) return;
    const tx = db.transaction(() => {
      items.forEach((item, i) => {
        if (withCode) insert.run(type, item.nom, normalizeNom(item.nom), item.code, i + 1);
        else insert.run(type, item, normalizeNom(item), null, i + 1);
      });
    });
    tx();
  }
  seedType("taille", DEFAULTS.TAILLES, false);
  seedType("saison", DEFAULTS.SAISONS, true);
  seedType("rayon", DEFAULTS.RAYONS, true);
}

function seedIfEmpty(db) {
  seedEtapesIfEmpty(db);
  seedListesStructurellesIfEmpty(db);
}

module.exports = { seedIfEmpty };
