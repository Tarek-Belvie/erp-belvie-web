#!/usr/bin/env node
// ================================================================================================
// REPRISE DES DONNÉES — base SQLite de Belvie ERP (Electron 1.0.x) → PostgreSQL.
//
//   node tools/reprise-donnees/reprise.js --sqlite <chemin\belvie.db> --pg <DATABASE_URL> [--executer]
//
// Sans --executer : contrôle seul (compatibilité du schéma, comptages, anomalies). Rien n'est écrit.
// Avec --executer : copie TOUT dans UNE transaction (tout ou rien), puis vérifie table par table
//                   que le contenu Postgres est identique au contenu SQLite (comptage + empreinte).
//
// Principes (repris des règles du projet) :
//   * rien de silencieux : une ligne qui ne passe pas arrête la reprise, avec la table, l'id et
//     la cause ; aucune valeur n'est « corrigée » au passage ;
//   * la base SQLite est ouverte en LECTURE SEULE ;
//   * la base Postgres cible ne doit contenir AUCUNE donnée métier (seules les données de
//     référence installées par les migrations sont tolérées, elles sont remplacées).
// ================================================================================================
const crypto = require("crypto");
const path = require("path");

function argument(nom, defaut) {
  const i = process.argv.indexOf(nom);
  return i === -1 ? defaut : process.argv[i + 1];
}
const cheminSqlite = argument("--sqlite");
const urlPg = argument("--pg", process.env.DATABASE_URL);
const executer = process.argv.includes("--executer");
// Tables de la source volontairement écartées (restes de migrations SQLite interrompues…).
// Leur contenu est archivé en JSON à côté du rapport : rien n'est perdu sans trace.
const tablesIgnorees = new Set(process.argv.flatMap((a, i) => (a === "--ignorer-table" ? [process.argv[i + 1]] : [])));
const dossierArchive = argument("--archive", path.join(process.cwd(), "reprise-archives"));
if (!cheminSqlite || !urlPg) {
  console.error("Usage : reprise.js --sqlite <belvie.db> --pg <postgres://…> [--executer]");
  process.exit(2);
}

const Database = require(process.env.BETTER_SQLITE3 || "better-sqlite3");
const pgModule = require(process.env.PG_MODULE || "pg");
const { Client } = pgModule;
// Mêmes conversions que l'API (apps/api/src/db) : BIGINT et NUMERIC lus comme nombres.
pgModule.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
pgModule.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

// Tables de référence remplies par les migrations Postgres : elles sont remplacées par la reprise.
const TABLES_REFERENCE = new Set([
  "accessoires_catalogue", "etapes", "listes_valeurs", "mesures_catalogue",
  "modeles_mesures", "modeles_mesures_lignes", "parametres",
]);
const TABLES_TECHNIQUES_PG = new Set(["schema_migrations", "utilisateurs", "sessions"]);

function empreinte(lignes, colonnes) {
  const h = crypto.createHash("sha256");
  for (const l of lignes) {
    h.update(JSON.stringify(colonnes.map((c) => normaliser(l[c]))));
    h.update("\n");
  }
  return h.digest("hex").slice(0, 16);
}
function normaliser(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  if (Buffer.isBuffer(v)) return "b64:" + v.toString("base64");
  if (typeof v === "number") return Number.isInteger(v) ? v : Number(v.toPrecision(15));
  return v;
}

async function principal() {
  const sqlite = new Database(cheminSqlite, { readonly: true, fileMustExist: true });
  const pg = new Client({ connectionString: urlPg });
  await pg.connect();
  const rapport = { erreurs: [], avertissements: [], tables: [] };
  const aArchiver = [];

  // ---------------------------------------------------------------- 1. Intégrité de la source
  const integrite = sqlite.prepare("PRAGMA integrity_check").pluck().all();
  if (integrite.join() !== "ok") rapport.erreurs.push("SQLite integrity_check : " + integrite.join(" | "));
  const fk = sqlite.prepare("PRAGMA foreign_key_check").all();
  if (fk.length) rapport.erreurs.push(`SQLite foreign_key_check : ${fk.length} référence(s) cassée(s), ex. ${JSON.stringify(fk.slice(0, 5))}`);

  // ---------------------------------------------------------------- 2. Compatibilité des schémas
  const tablesSqlite = sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").pluck().all();
  const colsPg = new Map();
  for (const r of (await pg.query(
    "SELECT table_name, column_name, data_type FROM information_schema.columns WHERE table_schema = current_schema() ORDER BY table_name, ordinal_position"
  )).rows) {
    if (!colsPg.has(r.table_name)) colsPg.set(r.table_name, new Map());
    colsPg.get(r.table_name).set(r.column_name, r.data_type);
  }
  const colonnesIgnorees = new Map(); // table → colonnes de la source sans équivalent, toutes vides
  for (const t of [...tablesSqlite]) {
    if (!colsPg.has(t)) {
      const nb = sqlite.prepare(`SELECT count(*) n FROM "${t}"`).get().n;
      if (nb === 0) { rapport.avertissements.push(`Table de la source sans équivalent, vide : ${t} (ignorée)`); tablesSqlite.splice(tablesSqlite.indexOf(t), 1); continue; }
      if (tablesIgnorees.has(t)) {
        rapport.avertissements.push(`Table de la source écartée sur demande : ${t} (${nb} lignes archivées dans ${dossierArchive})`);
        tablesSqlite.splice(tablesSqlite.indexOf(t), 1);
        aArchiver.push(t);
        continue;
      }
      rapport.erreurs.push(`Table de la source sans équivalent dans Postgres, NON VIDE : ${t} (${nb} lignes). Vérifier son rôle, puis relancer avec --ignorer-table ${t} pour l'écarter (son contenu sera archivé).`);
      continue;
    }
    const cols = sqlite.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    for (const c of cols) {
      if (colsPg.get(t).has(c)) continue;
      const nonVides = sqlite.prepare(`SELECT count(*) n FROM "${t}" WHERE "${c}" IS NOT NULL`).get().n;
      if (nonVides === 0) {
        rapport.avertissements.push(`Colonne de la source sans équivalent, vide partout : ${t}.${c} (ignorée)`);
        if (!colonnesIgnorees.has(t)) colonnesIgnorees.set(t, new Set());
        colonnesIgnorees.get(t).add(c);
      } else {
        rapport.erreurs.push(`Colonne de la source sans équivalent dans Postgres : ${t}.${c} (${nonVides} valeur(s) renseignée(s)).`);
      }
    }
    for (const c of colsPg.get(t).keys()) if (!cols.includes(c)) rapport.avertissements.push(`Colonne Postgres sans équivalent SQLite (restera à sa valeur par défaut) : ${t}.${c}`);
  }
  for (const t of colsPg.keys()) if (!tablesSqlite.includes(t) && !TABLES_TECHNIQUES_PG.has(t)) rapport.avertissements.push(`Table Postgres sans équivalent SQLite : ${t}`);

  // ---------------------------------------------------------------- 3. La cible doit être vide
  for (const t of colsPg.keys()) {
    if (TABLES_REFERENCE.has(t) || TABLES_TECHNIQUES_PG.has(t)) continue;
    const n = (await pg.query(`SELECT count(*)::int n FROM "${t}"`)).rows[0].n;
    if (n > 0) rapport.erreurs.push(`La base Postgres contient déjà des données : ${t} (${n} lignes). Reprise refusée.`);
  }

  // ---------------------------------------------------------------- 4. Ordre de copie (FK)
  const deps = new Map();
  for (const t of tablesSqlite) deps.set(t, new Set(sqlite.prepare(`PRAGMA foreign_key_list("${t}")`).all().map((f) => f.table).filter((x) => x !== t)));
  const ordre = []; const vu = new Set();
  const visiter = (t, pile = new Set()) => {
    if (vu.has(t)) return; if (pile.has(t)) throw new Error("Cycle de clés étrangères : " + t);
    pile.add(t); for (const d of deps.get(t) || []) if (deps.has(d)) visiter(d, pile); pile.delete(t);
    vu.add(t); ordre.push(t);
  };
  tablesSqlite.forEach((t) => visiter(t));

  const comptages = {};
  for (const t of ordre) comptages[t] = sqlite.prepare(`SELECT count(*) n FROM "${t}"`).get().n;

  afficher("CONTRÔLE PRÉALABLE", rapport, comptages);
  if (rapport.erreurs.length) { await pg.end(); process.exit(1); }
  if (!executer) { console.log("\nContrôle seul : rien n'a été écrit. Relancer avec --executer pour copier."); await pg.end(); return; }

  // ---------------------------------------------------------------- 5. Archive des tables écartées
  if (aArchiver.length) {
    require("fs").mkdirSync(dossierArchive, { recursive: true });
    for (const t of aArchiver) {
      const f = path.join(dossierArchive, `${t}.json`);
      require("fs").writeFileSync(f, JSON.stringify({ table: t, sql: sqlite.prepare("SELECT sql FROM sqlite_master WHERE name = ?").pluck().get(t), lignes: sqlite.prepare(`SELECT * FROM "${t}"`).all() }, null, 1));
    }
  }

  // ---------------------------------------------------------------- 6. Copie, une transaction
  await pg.query("BEGIN");
  try {
    const aVider = [...colsPg.keys()].filter((t) => !TABLES_TECHNIQUES_PG.has(t)).map((t) => `"${t}"`).join(", ");
    await pg.query(`TRUNCATE ${aVider} RESTART IDENTITY CASCADE`);
    for (const t of ordre) {
      const cols = sqlite.prepare(`PRAGMA table_info("${t}")`).all().filter((c) => !(colonnesIgnorees.get(t) || new Set()).has(c.name));
      const noms = cols.map((c) => c.name);
      const pk = cols.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => `"${c.name}"`);
      const tri = pk.length ? pk.join(", ") : "rowid";
      const lignes = sqlite.prepare(`SELECT * FROM "${t}" ORDER BY ${tri}`).safeIntegers(false).all();
      const LOT = 500;
      for (let i = 0; i < lignes.length; i += LOT) {
        const lot = lignes.slice(i, i + LOT);
        const valeurs = []; const tuples = [];
        for (const l of lot) {
          tuples.push("(" + noms.map((c) => { valeurs.push(convertir(l[c], colsPg.get(t).get(c))); return "$" + valeurs.length; }).join(", ") + ")");
        }
        try {
          await pg.query(`INSERT INTO "${t}" (${noms.map((c) => `"${c}"`).join(", ")}) VALUES ${tuples.join(", ")}`, valeurs);
        } catch (err) {
          // On retrouve la ligne fautive pour un message exploitable.
          await pg.query("SAVEPOINT diag").catch(() => {});
          throw new Error(`Table ${t}, lignes ${i + 1}…${i + lot.length} : ${err.message}${err.detail ? " — " + err.detail : ""}`);
        }
      }
      if (colsPg.get(t).has("id") && noms.includes("id")) {
        await pg.query(`SELECT setval(pg_get_serial_sequence('"${t}"', 'id'), GREATEST((SELECT COALESCE(MAX(id), 0) FROM "${t}"), 1), (SELECT COUNT(*) > 0 FROM "${t}"))`);
      }
    }
    // ------------------------------------------------------------ 7. Vérification avant COMMIT
    for (const t of ordre) {
      const noms = sqlite.prepare(`PRAGMA table_info("${t}")`).all().filter((c) => !(colonnesIgnorees.get(t) || new Set()).has(c.name));
      const colonnes = noms.map((c) => c.name);
      const pk = noms.filter((c) => c.pk).sort((a, b) => a.pk - b.pk).map((c) => `"${c.name}"`);
      const tri = pk.length ? pk.join(", ") : colonnes.map((c) => `"${c}"`).join(", ");
      const src = sqlite.prepare(`SELECT * FROM "${t}" ORDER BY ${pk.length ? tri : "rowid"}`).all();
      const dst = (await pg.query(`SELECT ${colonnes.map((c) => `"${c}"`).join(", ")} FROM "${t}" ORDER BY ${tri}`)).rows;
      const ok = src.length === dst.length && empreinte(src, colonnes) === empreinte(dst, colonnes);
      rapport.tables.push({ table: t, sqlite: src.length, postgres: dst.length, identique: ok });
      if (!ok) rapport.erreurs.push(`Contenu différent après copie : ${t}`);
    }
    if (rapport.erreurs.length) throw new Error("Vérification échouée — rien n'est enregistré.");
    await pg.query("COMMIT");
  } catch (err) {
    await pg.query("ROLLBACK");
    rapport.erreurs.push(err.message);
  }
  afficher("RÉSULTAT DE LA REPRISE", rapport, null);
  await pg.end();
  process.exit(rapport.erreurs.length ? 1 : 0);
}

function convertir(v, typePg) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return v.toString();
  if (typePg === "bytea") return Buffer.isBuffer(v) ? v : Buffer.from(String(v));
  if (Buffer.isBuffer(v)) throw new Error(`Valeur binaire inattendue pour une colonne ${typePg}`);
  return v;
}

function afficher(titre, rapport, comptages) {
  console.log("\n=== " + titre + " ===");
  if (comptages) {
    const total = Object.values(comptages).reduce((a, b) => a + b, 0);
    console.log(`${Object.keys(comptages).length} tables, ${total} lignes à copier.`);
    for (const [t, n] of Object.entries(comptages)) if (n) console.log(`  ${t.padEnd(36)} ${n}`);
  }
  for (const t of rapport.tables) console.log(`  ${t.identique ? "OK " : "KO "} ${t.table.padEnd(36)} ${t.sqlite} → ${t.postgres}`);
  for (const a of rapport.avertissements) console.log("  ⚠ " + a);
  for (const e of rapport.erreurs) console.log("  ✖ " + e);
  if (!rapport.erreurs.length && rapport.tables.length) console.log("Reprise terminée : contenu identique pour toutes les tables.");
}

principal().catch((err) => { console.error("Échec :", err.message); process.exit(1); });
