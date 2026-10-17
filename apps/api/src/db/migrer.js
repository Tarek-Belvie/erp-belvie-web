#!/usr/bin/env node
// ================================================================================================
// Lanceur de migrations PostgreSQL.
//
//   npm run db:migrer               applique les migrations en attente (migrations/NNN_*.sql)
//   npm run db:migrer -- --statut   affiche l'état sans rien appliquer
//
// Règles (docs/regles-developpement.md) :
//   * une migration appliquée n'est JAMAIS modifiée : on en ajoute une nouvelle ;
//   * chaque migration s'exécute dans une transaction : tout ou rien ;
//   * l'empreinte de chaque fichier est enregistrée ; un fichier modifié après coup bloque le démarrage.
// ================================================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pg = require("pg");
const { chargerConfiguration } = require("../config");

const DOSSIER = path.join(__dirname, "../../migrations");

function listerFichiers() {
  return fs.readdirSync(DOSSIER).filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f)).sort();
}

async function migrer({ connectionString, statutSeul = false, journal = console.log } = {}) {
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY, empreinte TEXT NOT NULL, appliquee_le TIMESTAMPTZ NOT NULL DEFAULT now())`);
    // Un seul lanceur à la fois, même si plusieurs instances de l'API démarrent ensemble.
    await client.query("SELECT pg_advisory_lock(424242)");
    const appliquees = new Map((await client.query("SELECT version, empreinte FROM schema_migrations")).rows.map((r) => [r.version, r.empreinte]));
    const enAttente = [];
    for (const f of listerFichiers()) {
      const contenu = fs.readFileSync(path.join(DOSSIER, f), "utf8");
      const empreinte = crypto.createHash("sha256").update(contenu).digest("hex");
      if (appliquees.has(f)) {
        if (appliquees.get(f) !== empreinte) {
          throw new Error(`La migration ${f} a été modifiée après avoir été appliquée. Ne jamais modifier une migration appliquée : en créer une nouvelle.`);
        }
        continue;
      }
      enAttente.push({ f, contenu, empreinte });
    }
    if (statutSeul) {
      journal(`${appliquees.size} migration(s) appliquée(s), ${enAttente.length} en attente${enAttente.length ? " : " + enAttente.map((m) => m.f).join(", ") : ""}.`);
      return { appliquees: [...appliquees.keys()], enAttente: enAttente.map((m) => m.f) };
    }
    for (const m of enAttente) {
      journal(`→ ${m.f}`);
      await client.query("BEGIN");
      try {
        await client.query(m.contenu);
        await client.query("INSERT INTO schema_migrations (version, empreinte) VALUES ($1, $2)", [m.f, m.empreinte]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Échec de la migration ${m.f} (rien n'a été appliqué pour elle) : ${err.message}`);
      }
    }
    if (enAttente.length) journal(`${enAttente.length} migration(s) appliquée(s).`); else journal("Base à jour.");
    return { appliquees: enAttente.map((m) => m.f) };
  } finally {
    await client.query("SELECT pg_advisory_unlock(424242)").catch(() => {});
    await client.end();
  }
}

if (require.main === module) {
  const config = chargerConfiguration();
  migrer({ connectionString: config.databaseUrl, statutSeul: process.argv.includes("--statut") })
    .catch((err) => { console.error(err.message); process.exit(1); });
}

module.exports = { migrer };
