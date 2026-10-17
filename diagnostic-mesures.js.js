const { DatabaseSync } = require("node:sqlite");

const dbPath = process.env.APPDATA + "\\belvie-erp\\belvie.db";
const d = new DatabaseSync(dbPath, { readOnly: true });

console.log("--- mesures_catalogue ---");
console.log(
  d.prepare(
    "SELECT id, nom FROM mesures_catalogue ORDER BY nom"
  ).all()
);

console.log("--- modeles ---");
console.log(
  d.prepare(
    "SELECT COUNT(*) n FROM modeles_mesures"
  ).get()
);