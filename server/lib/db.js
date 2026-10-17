// ============================================================================
// Connexion PostgreSQL unique, partagée par toutes les routes — un seul pool,
// jamais une connexion par requête. Utilise shared/db-adapter.js, déjà
// validé sur les Lots 1/2/3 : aucune nouvelle logique de connexion ici.
// ============================================================================

const { Pool } = require("pg");
const { creerAdaptateurPostgres } = require("../../shared/db-adapter");

let pool = null;
let adapter = null;

function getAdapter() {
  if (!adapter) {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL absente des variables d'environnement.");
    }
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    adapter = creerAdaptateurPostgres(pool, require("pg"));
  }
  return adapter;
}

module.exports = { getAdapter };
