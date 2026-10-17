// ============================================================================
// TEST COMPARATIF SQLite / PostgreSQL — shared/etapes.js (Phase 1).
//
// À EXÉCUTER SUR VOTRE MACHINE. Lit DATABASE_URL depuis votre .env local —
// sa valeur n'est jamais affichée, jamais journalisée.
//
// Préparation (déjà faite si listes.js a été validé) :
//   npm install pg --save-dev
//
// Exécution :
//   node server/test-etapes-comparaison.js
// ============================================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const { creerAdaptateurSqlite, creerAdaptateurPostgres } = require("../shared/db-adapter");
const etapes = require("../shared/etapes");

function chargerEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env introuvable à la racine du projet.");
  }
  const lignes = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const ligne of lignes) {
    const m = ligne.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2].trim();
  }
}
chargerEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL absente de .env. Arrêt.");
  process.exit(1);
}

let resultats = { ok: 0, echec: 0 };

function trierClesRecursif(valeur) {
  if (Array.isArray(valeur)) return valeur.map(trierClesRecursif);
  if (valeur !== null && typeof valeur === "object") {
    const trie = {};
    for (const cle of Object.keys(valeur).sort()) trie[cle] = trierClesRecursif(valeur[cle]);
    return trie;
  }
  return valeur;
}

function comparer(nomTest, valSqlite, valPostgres, { ignorerChamps = [] } = {}) {
  const nettoyer = (v) => {
    if (v == null) return v;
    const copie = { ...v };
    for (const champ of ignorerChamps) delete copie[champ];
    return copie;
  };
  const a = trierClesRecursif(Array.isArray(valSqlite) ? valSqlite.map(nettoyer) : nettoyer(valSqlite));
  const b = trierClesRecursif(Array.isArray(valPostgres) ? valPostgres.map(nettoyer) : nettoyer(valPostgres));
  const identique = JSON.stringify(a) === JSON.stringify(b);
  if (identique) {
    resultats.ok++;
    console.log(`  OK   ${nomTest}`);
  } else {
    resultats.echec++;
    console.log(`  ECHEC ${nomTest}`);
    console.log(`         SQLite  : ${JSON.stringify(a)}`);
    console.log(`         Postgres: ${JSON.stringify(b)}`);
  }
}

async function comparerErreurs(nomTest, fnSqlite, fnPostgres) {
  let msgSqlite = null, msgPostgres = null;
  try { await fnSqlite(); } catch (e) { msgSqlite = e.message; }
  try { await fnPostgres(); } catch (e) { msgPostgres = e.message; }
  comparer(nomTest, msgSqlite, msgPostgres);
}

async function main() {
  console.log("=== 1. Verification structurelle prealable (etapes) ===");
  const sqliteDbPath = path.join(__dirname, "test-etapes-comparaison.sqlite");
  if (fs.existsSync(sqliteDbPath)) fs.unlinkSync(sqliteDbPath);
  const rawDb = new Database(sqliteDbPath);
  rawDb.exec(`
    CREATE TABLE etapes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      cle TEXT NOT NULL UNIQUE,
      libelle TEXT NOT NULL,
      pourcentage INTEGER NOT NULL DEFAULT 0,
      ordre INTEGER NOT NULL,
      optionnelle INTEGER NOT NULL DEFAULT 0,
      actif INTEGER NOT NULL DEFAULT 1
    );
  `);
  const sqliteAdapter = creerAdaptateurSqlite(rawDb);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const postgresAdapter = creerAdaptateurPostgres(pool, require("pg"));

  const colsSqlite = rawDb.prepare("PRAGMA table_info(etapes)").all().map((c) => c.name).sort();
  const colsPgRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'etapes' ORDER BY column_name");
  const colsPostgres = colsPgRes.rows.map((r) => r.column_name).sort();
  const colsIdentiques = JSON.stringify(colsSqlite) === JSON.stringify(colsPostgres);
  console.log(`  Colonnes SQLite   : ${colsSqlite.join(", ")}`);
  console.log(`  Colonnes Postgres : ${colsPostgres.join(", ")}`);
  console.log(colsIdentiques ? "  OK : structures identiques.\n" : "  ECHEC : structures DIFFERENTES.\n");
  if (!colsIdentiques) { rawDb.close(); await pool.end(); process.exit(1); }

  await pool.query("DELETE FROM etapes WHERE libelle LIKE 'TEST\\_%' ESCAPE '\\'");

  console.log("=== 2. Creation ===");
  const c1s = await etapes.create(sqliteAdapter, { libelle: "TEST_Coupe" });
  const c1p = await etapes.create(postgresAdapter, { libelle: "TEST_Coupe" });
  comparer("create()", c1s, c1p, { ignorerChamps: ["id"] });

  console.log("=== 3. Doublon exact ===");
  await comparerErreurs(
    "create() doublon exact",
    () => etapes.create(sqliteAdapter, { libelle: "TEST_Coupe" }),
    () => etapes.create(postgresAdapter, { libelle: "TEST_Coupe" })
  );

  console.log("=== 4. Découpe vs découpe (casse ASCII seule, doit etre doublon des 2 cotes) ===");
  await comparerErreurs(
    "create() 'TEST_découpe' apres 'TEST_Découpe'",
    async () => { await etapes.create(sqliteAdapter, { libelle: "TEST_Découpe" }); await etapes.create(sqliteAdapter, { libelle: "TEST_découpe" }); },
    async () => { await etapes.create(postgresAdapter, { libelle: "TEST_Découpe" }); await etapes.create(postgresAdapter, { libelle: "TEST_découpe" }); }
  );

  console.log("=== 5. ÉTAPE vs étape (accent majuscule -- point de vigilance identifie) ===");
  await comparerErreurs(
    "create() 'TEST_étape' apres 'TEST_ÉTAPE'",
    async () => { await etapes.create(sqliteAdapter, { libelle: "TEST_ÉTAPE" }); await etapes.create(sqliteAdapter, { libelle: "TEST_étape" }); },
    async () => { await etapes.create(postgresAdapter, { libelle: "TEST_ÉTAPE" }); await etapes.create(postgresAdapter, { libelle: "TEST_étape" }); }
  );

  console.log("=== 6. Etape vs Étape (E ascii vs E accentue -- doivent rester differents) ===");
  await comparerErreurs(
    "create() 'TEST_Étape2' apres 'TEST_Etape2'",
    async () => { await etapes.create(sqliteAdapter, { libelle: "TEST_Etape2" }); await etapes.create(sqliteAdapter, { libelle: "TEST_Étape2" }); },
    async () => { await etapes.create(postgresAdapter, { libelle: "TEST_Etape2" }); await etapes.create(postgresAdapter, { libelle: "TEST_Étape2" }); }
  );
  const listeApresS = (await etapes.list(sqliteAdapter, { includeInactive: true })).filter((e) => e.libelle.startsWith("TEST_Etape2") || e.libelle.startsWith("TEST_Étape2")).map((e) => e.libelle).sort();
  const listeApresP = (await etapes.list(postgresAdapter, { includeInactive: true })).filter((e) => e.libelle.startsWith("TEST_Etape2") || e.libelle.startsWith("TEST_Étape2")).map((e) => e.libelle).sort();
  comparer("Les deux variantes Etape2/Étape2 coexistent bien", listeApresS, listeApresP);

  console.log("=== 7. Espaces avant/apres le libelle ===");
  await comparerErreurs(
    "create() '  TEST_Finition  ' apres 'TEST_Finition'",
    async () => { await etapes.create(sqliteAdapter, { libelle: "TEST_Finition" }); await etapes.create(sqliteAdapter, { libelle: "  TEST_Finition  " }); },
    async () => { await etapes.create(postgresAdapter, { libelle: "TEST_Finition" }); await etapes.create(postgresAdapter, { libelle: "  TEST_Finition  " }); }
  );

  console.log("=== 8. Libelle vide ou invalide ===");
  await comparerErreurs(
    "create() libelle vide",
    () => etapes.create(sqliteAdapter, { libelle: "   " }),
    () => etapes.create(postgresAdapter, { libelle: "   " })
  );
  await comparerErreurs(
    "create() libelle absent",
    () => etapes.create(sqliteAdapter, {}),
    () => etapes.create(postgresAdapter, {})
  );

  console.log("=== 9. Modification vers un libelle deja existant ===");
  const cModS = await etapes.create(sqliteAdapter, { libelle: "TEST_Repassage" });
  const cModP = await etapes.create(postgresAdapter, { libelle: "TEST_Repassage" });
  await comparerErreurs(
    "update() libelle -> doublon existant (TEST_Coupe)",
    () => etapes.update(sqliteAdapter, cModS.id, { libelle: "TEST_Coupe" }),
    () => etapes.update(postgresAdapter, cModP.id, { libelle: "TEST_Coupe" })
  );

  console.log("=== 10. Ordre de tri ===");
  await etapes.create(sqliteAdapter, { libelle: "TEST_Zeta", ordre: 500 });
  await etapes.create(postgresAdapter, { libelle: "TEST_Zeta", ordre: 500 });
  await etapes.create(sqliteAdapter, { libelle: "TEST_Alpha", ordre: 1 });
  await etapes.create(postgresAdapter, { libelle: "TEST_Alpha", ordre: 1 });
  const ordreS = (await etapes.list(sqliteAdapter, { includeInactive: true })).filter((e) => e.libelle.startsWith("TEST_")).map((e) => e.libelle);
  const ordreP = (await etapes.list(postgresAdapter, { includeInactive: true })).filter((e) => e.libelle.startsWith("TEST_")).map((e) => e.libelle);
  comparer("list() ordre par 'ordre' croissant", ordreS, ordreP);

  console.log("=== 11. Structure exacte de l'objet retourne ===");
  comparer("Cles de l'objet retourne par create()", Object.keys(c1s).sort(), Object.keys(c1p).sort());

  console.log("=== 12. Desactivation, PUIS tentative de recreation (doit ECHOUER -- pas de reactivation ici) ===");
  const dS = await etapes.update(sqliteAdapter, c1s.id, { actif: false });
  const dP = await etapes.update(postgresAdapter, c1p.id, { actif: false });
  comparer("update() actif=false", dS, dP, { ignorerChamps: ["id"] });

  await comparerErreurs(
    "create() meme libelle qu'une etape DESACTIVEE -> doit toujours echouer",
    () => etapes.create(sqliteAdapter, { libelle: "TEST_Coupe" }),
    () => etapes.create(postgresAdapter, { libelle: "TEST_Coupe" })
  );

  const reactivS = await etapes.update(sqliteAdapter, c1s.id, { actif: true });
  const reactivP = await etapes.update(postgresAdapter, c1p.id, { actif: true });
  comparer("update() actif=true (reactivation manuelle explicite)", reactivS, reactivP, { ignorerChamps: ["id"] });

  console.log("=== 13. Modification d'un id inexistant ===");
  await comparerErreurs(
    "update() id inexistant",
    () => etapes.update(sqliteAdapter, 999999, { libelle: "X" }),
    () => etapes.update(postgresAdapter, 999999, { libelle: "X" })
  );

  console.log("\n=== Nettoyage des donnees de test cote PostgreSQL ===");
  const suppr = await pool.query("DELETE FROM etapes WHERE libelle LIKE 'TEST\\_%' ESCAPE '\\'");
  console.log(`  ${suppr.rowCount} ligne(s) de test supprimee(s).`);

  rawDb.close();
  fs.unlinkSync(sqliteDbPath);
  await pool.end();

  console.log("\n=== RESULTAT FINAL ===");
  console.log(`  ${resultats.ok} test(s) identique(s), ${resultats.echec} divergence(s).`);
  if (resultats.echec > 0) {
    console.log("  shared/etapes.js n'est PAS encore validé.");
    process.exit(1);
  } else {
    console.log("  Comportement strictement identique confirmé sur les deux moteurs.");
  }
}

main().catch((err) => {
  console.error("Erreur inattendue :", err.message);
  process.exit(1);
});
