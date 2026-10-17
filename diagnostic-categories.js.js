const { DatabaseSync } = require("node:sqlite");

const dbPath = process.env.APPDATA + "\\belvie-erp\\belvie.db";
const d = new DatabaseSync(dbPath, { readOnly: true });

for (const t of ["produit", "categorie", "rayon"]) {
  console.log("--- " + t + " ---");
  console.log(
    d.prepare(
      "SELECT id, nom, actif FROM listes_valeurs WHERE type=?"
    ).all(t)
  );
}

console.log("--- articles ---");
console.log(
  d.prepare(
    "SELECT COUNT(*) total, COUNT(produit_id) avec_produit, COUNT(categorie_id) avec_categorie FROM articles"
  ).get()
);

console.log("--- modeles ---");
console.log(
  d.prepare("SELECT COUNT(*) n FROM modeles_mesures").get()
);