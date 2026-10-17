// ============================================================================
// TEST COMPARATIF SQLite / PostgreSQL — shared/listes.js (Phase 1).
//
// À EXÉCUTER SUR VOTRE MACHINE, jamais transmis ni exécuté par Claude.
// Lit DATABASE_URL depuis votre fichier .env local — sa valeur n'est jamais
// affichée, jamais journalisée, jamais envoyée nulle part.
//
// Préparation avant exécution (une seule fois) :
//   npm install pg --save-dev
//
// Exécution :
//   node server/test-listes-comparaison.js
//
// Ce script :
//   1. Vérifie d'abord que la structure de listes_valeurs est identique
//      entre SQLite et PostgreSQL (colonnes, avant tout test fonctionnel).
//   2. Crée une table listes_valeurs TEMPORAIRE et ISOLÉE en SQLite
//      (fichier séparé, jamais votre vraie base belvie.db).
//   3. Exécute la même suite de scénarios contre les deux bases via
//      shared/listes.js, et compare les résultats champ par champ.
//   4. Nettoie ensuite toutes les données de test qu'il a créées côté
//      PostgreSQL (jamais de résidu laissé dans votre base Supabase).
// ============================================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Pool } = require("pg"); // npm install pg --save-dev, une seule fois
const { creerAdaptateurSqlite, creerAdaptateurPostgres } = require("../shared/db-adapter");
const listes = require("../shared/listes");

// --- Lecture minimale de .env, sans dépendance supplémentaire ---
function chargerEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) {
    throw new Error(".env introuvable à la racine du projet. Créez-le avant d'exécuter ce script.");
  }
  const lignes = fs.readFileSync(envPath, "utf-8").split(/\r?\n/); // \r?\n : compatible fichiers
  // .env créés/édités sous Windows (fins de ligne \r\n) comme sous Unix (\n seul)
  for (const ligne of lignes) {
    const m = ligne.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2].trim();
  }
}
chargerEnvLocal();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL absente de .env — voir shared/parametres-bridge.js et la Phase 0 pour son renseignement. Arrêt.");
  process.exit(1);
}

let resultats = { ok: 0, echec: 0, details: [] };

// L'ordre des colonnes SQL (et donc l'ordre des cles JS) differe entre SQLite et PostgreSQL
// des qu'une colonne a ete ajoutee via ALTER TABLE apres coup (ex: fournisseur_id, ajoutee en fin
// de table cote PostgreSQL, au milieu cote SQLite). Cet ordre n'a jamais ete un contrat metier —
// on trie les cles avant de comparer, pour ne comparer QUE les valeurs reelles.
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
    // created_at differe forcement en format exact (NOW() Postgres vs datetime SQLite) —
    // on ignore sa valeur precise, on verifie seulement sa presence.
    if ("created_at" in copie) copie.created_at = copie.created_at != null ? "(present)" : null;
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
  resultats.details.push({ nomTest, identique });
}

async function comparerErreurs(nomTest, fnSqlite, fnPostgres) {
  let msgSqlite = null, msgPostgres = null;
  try { await fnSqlite(); } catch (e) { msgSqlite = e.message; }
  try { await fnPostgres(); } catch (e) { msgPostgres = e.message; }
  comparer(nomTest, msgSqlite, msgPostgres);
}

async function main() {
  console.log("=== 1. Verification structurelle prealable (listes_valeurs) ===");

  const sqliteDbPath = path.join(__dirname, "test-listes-comparaison.sqlite");
  if (fs.existsSync(sqliteDbPath)) fs.unlinkSync(sqliteDbPath);
  const rawDb = new Database(sqliteDbPath);
  rawDb.exec(`
    CREATE TABLE listes_valeurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      nom TEXT NOT NULL,
      nom_normalise TEXT NOT NULL,
      code TEXT,
      ordre INTEGER,
      responsable_nom TEXT,
      fournisseur_id INTEGER,
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, nom_normalise)
    );
  `);
  const sqliteAdapter = creerAdaptateurSqlite(rawDb);

  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const postgresAdapter = creerAdaptateurPostgres(pool, require("pg"));

  const colsSqlite = rawDb.prepare("PRAGMA table_info(listes_valeurs)").all().map((c) => c.name).sort();
  const colsPgRes = await pool.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name = 'listes_valeurs' ORDER BY column_name"
  );
  const colsPostgres = colsPgRes.rows.map((r) => r.column_name).sort();

  const colsIdentiques = JSON.stringify(colsSqlite) === JSON.stringify(colsPostgres);
  console.log(`  Colonnes SQLite   : ${colsSqlite.join(", ")}`);
  console.log(`  Colonnes Postgres : ${colsPostgres.join(", ")}`);
  console.log(colsIdentiques ? "  OK : structures identiques.\n" : "  ECHEC : structures DIFFERENTES — arrêt avant les tests fonctionnels.\n");
  if (!colsIdentiques) {
    rawDb.close();
    await pool.end();
    process.exit(1);
  }

  // Nettoyage prealable cote Postgres : ne pas melanger avec d'anciens essais.
  await pool.query("DELETE FROM listes_valeurs WHERE nom LIKE 'TEST\\_%' ESCAPE '\\'");

  console.log("=== 2. Creation ===");
  const c1s = await listes.create(sqliteAdapter, "produit", "TEST_Teddy");
  const c1p = await listes.create(postgresAdapter, "produit", "TEST_Teddy");
  comparer("create() type=produit", c1s, c1p, { ignorerChamps: ["id"] });

  console.log("=== 3. Doublons ===");
  await comparerErreurs(
    "create() doublon (meme nom, meme type)",
    () => listes.create(sqliteAdapter, "produit", "TEST_Teddy"),
    () => listes.create(postgresAdapter, "produit", "TEST_Teddy")
  );

  console.log("=== 4. Valeurs nulles / champs vides ===");
  await comparerErreurs(
    "create() nom vide",
    () => listes.create(sqliteAdapter, "produit", "   "),
    () => listes.create(postgresAdapter, "produit", "   ")
  );
  await comparerErreurs(
    "create() type invalide",
    () => listes.create(sqliteAdapter, "type_invalide", "TEST_X"),
    () => listes.create(postgresAdapter, "type_invalide", "TEST_X")
  );

  console.log("=== 5. Types de listes utilises par Fabrication (atelier + responsable_nom) ===");
  const at1s = await listes.create(sqliteAdapter, "atelier", "TEST_Atelier Nord");
  const at1p = await listes.create(postgresAdapter, "atelier", "TEST_Atelier Nord");
  comparer("create() type=atelier", at1s, at1p, { ignorerChamps: ["id"] });

  const at2s = await listes.update(sqliteAdapter, at1s.id, { responsable_nom: "TEST_Ali Ben Salah" });
  const at2p = await listes.update(postgresAdapter, at1p.id, { responsable_nom: "TEST_Ali Ben Salah" });
  comparer("update() responsable_nom", at2s, at2p, { ignorerChamps: ["id"] });

  console.log("=== 6. Codes (saison/rayon) et doublons de code ===");
  const s1s = await listes.create(sqliteAdapter, "saison", "TEST_Ete 2027", { code: "SS27" });
  const s1p = await listes.create(postgresAdapter, "saison", "TEST_Ete 2027", { code: "SS27" });
  comparer("create() type=saison avec code", s1s, s1p, { ignorerChamps: ["id"] });

  await comparerErreurs(
    "create() code deja utilise",
    () => listes.create(sqliteAdapter, "saison", "TEST_Autre Saison", { code: "SS27" }),
    () => listes.create(postgresAdapter, "saison", "TEST_Autre Saison", { code: "SS27" })
  );

  console.log("=== 7. Ordre de tri (types ordonnes) ===");
  await listes.create(sqliteAdapter, "rayon", "TEST_Rayon B", { code: "RB" });
  await listes.create(postgresAdapter, "rayon", "TEST_Rayon B", { code: "RB" });
  await listes.create(sqliteAdapter, "rayon", "TEST_Rayon A", { code: "RA" });
  await listes.create(postgresAdapter, "rayon", "TEST_Rayon A", { code: "RA" });
  const rS = (await listes.list(sqliteAdapter, "rayon")).filter((r) => r.nom.startsWith("TEST_")).map((r) => r.nom);
  const rP = (await listes.list(postgresAdapter, "rayon")).filter((r) => r.nom.startsWith("TEST_")).map((r) => r.nom);
  comparer("list() ordre par 'ordre' croissant", rS, rP);

  console.log("=== 8. Ordre de tri avec noms accentes (point de vigilance identifie) ===");
  await listes.create(sqliteAdapter, "produit", "TEST_Écharpe");
  await listes.create(postgresAdapter, "produit", "TEST_Écharpe");
  await listes.create(sqliteAdapter, "produit", "TEST_Élastique");
  await listes.create(postgresAdapter, "produit", "TEST_Élastique");
  await listes.create(sqliteAdapter, "produit", "TEST_Étole");
  await listes.create(postgresAdapter, "produit", "TEST_Étole");
  const accS = (await listes.list(sqliteAdapter, "produit")).filter((r) => r.nom.startsWith("TEST_")).map((r) => r.nom);
  const accP = (await listes.list(postgresAdapter, "produit")).filter((r) => r.nom.startsWith("TEST_")).map((r) => r.nom);
  comparer("list() tri alphabetique avec accents", accS, accP);

  console.log("=== 9. Desactivation puis reactivation ===");
  const d1s = await listes.update(sqliteAdapter, c1s.id, { actif: false });
  const d1p = await listes.update(postgresAdapter, c1p.id, { actif: false });
  comparer("update() actif=false", d1s, d1p, { ignorerChamps: ["id"] });

  const listeApresDesactivS = (await listes.list(sqliteAdapter, "produit")).some((r) => r.id === c1s.id);
  const listeApresDesactivP = (await listes.list(postgresAdapter, "produit")).some((r) => r.id === c1p.id);
  comparer("list() sans includeInactive n'affiche plus l'element desactive", listeApresDesactivS, listeApresDesactivP);

  const r1s = await listes.create(sqliteAdapter, "produit", "TEST_Teddy"); // reactive au lieu de dupliquer
  const r1p = await listes.create(postgresAdapter, "produit", "TEST_Teddy");
  comparer("create() sur nom desactive => reactivation (pas de doublon)", r1s, r1p, { ignorerChamps: ["id"] });

  console.log("=== 10. Structure exacte de l'objet retourne (toutes cles presentes) ===");
  const clesS = Object.keys(c1s).sort();
  const clesP = Object.keys(c1p).sort();
  comparer("Cles de l'objet retourne par create()", clesS, clesP);

  console.log("=== 11. Modification introuvable ===");
  await comparerErreurs(
    "update() id inexistant",
    () => listes.update(sqliteAdapter, 999999, { nom: "X" }),
    () => listes.update(postgresAdapter, 999999, { nom: "X" })
  );

  console.log("\n=== Nettoyage des donnees de test cote PostgreSQL ===");
  const suppr = await pool.query("DELETE FROM listes_valeurs WHERE nom LIKE 'TEST\\_%' ESCAPE '\\'");
  console.log(`  ${suppr.rowCount} ligne(s) de test supprimee(s) de Supabase.`);

  rawDb.close();
  fs.unlinkSync(sqliteDbPath);
  await pool.end();

  console.log("\n=== RESULTAT FINAL ===");
  console.log(`  ${resultats.ok} test(s) identique(s), ${resultats.echec} divergence(s).`);
  if (resultats.echec > 0) {
    console.log("  shared/listes.js n'est PAS encore validé — corriger les divergences avant de continuer.");
    process.exit(1);
  } else {
    console.log("  Comportement strictement identique confirmé sur les deux moteurs.");
  }
}

main().catch((err) => {
  console.error("Erreur inattendue pendant le test :", err.message);
  process.exit(1);
});
