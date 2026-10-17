// ============================================================================
// TEST COMPARATIF SQLite / PostgreSQL — LOT 1 : Articles
// (shared/articles.js + shared/declinaisons.js + shared/references.js)
//
// À EXÉCUTER SUR VOTRE MACHINE. Lit DATABASE_URL depuis votre .env local.
// npm install pg --save-dev (si pas déjà fait)
// node server/test-lot-articles.js
// ============================================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const { creerAdaptateurSqlite, creerAdaptateurPostgres } = require("../shared/db-adapter");
const articles = require("../shared/articles");
const declinaisons = require("../shared/declinaisons");

function chargerEnvLocal() {
  const envPath = path.join(__dirname, "..", ".env");
  if (!fs.existsSync(envPath)) throw new Error(".env introuvable à la racine du projet.");
  const lignes = fs.readFileSync(envPath, "utf-8").split(/\r?\n/);
  for (const ligne of lignes) {
    const m = ligne.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2].trim();
  }
}
chargerEnvLocal();
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL absente de .env."); process.exit(1); }

let resultats = { ok: 0, echec: 0 };

function trierClesRecursif(v) {
  if (Array.isArray(v)) return v.map(trierClesRecursif);
  if (v !== null && typeof v === "object") {
    const t = {};
    for (const c of Object.keys(v).sort()) t[c] = trierClesRecursif(v[c]);
    return t;
  }
  return v;
}
function comparer(nom, a0, b0, { ignorerChamps = [] } = {}) {
  const nettoyer = (v) => {
    if (v == null) return v;
    const c = { ...v };
    for (const champ of ignorerChamps) delete c[champ];
    if ("created_at" in c) c.created_at = c.created_at != null ? "(present)" : null;
    if ("updated_at" in c) c.updated_at = c.updated_at != null ? "(present)" : null;
    return c;
  };
  const nettoyerProfond = (v) => {
    if (Array.isArray(v)) return v.map(nettoyerProfond);
    if (v !== null && typeof v === "object") return nettoyer(v);
    return v;
  };
  const a = trierClesRecursif(nettoyerProfond(a0));
  const b = trierClesRecursif(nettoyerProfond(b0));
  const identique = JSON.stringify(a) === JSON.stringify(b);
  if (identique) { resultats.ok++; console.log(`  OK   ${nom}`); }
  else {
    resultats.echec++;
    console.log(`  ECHEC ${nom}`);
    console.log(`         SQLite  : ${JSON.stringify(a)}`);
    console.log(`         Postgres: ${JSON.stringify(b)}`);
  }
}
async function comparerErreurs(nom, fnS, fnP) {
  let mS = null, mP = null;
  try { await fnS(); } catch (e) { mS = e.message; }
  try { await fnP(); } catch (e) { mP = e.message; }
  comparer(nom, mS, mP);
}

const SCHEMA_SQLITE = `
CREATE TABLE listes_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL, code TEXT, ordre INTEGER, responsable_nom TEXT,
  fournisseur_id INTEGER, actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(type, nom_normalise)
);
CREATE TABLE articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, produit_id INTEGER NOT NULL,
  saison_id INTEGER, annee_collection INTEGER, rayon_id INTEGER, categorie_id INTEGER,
  abreviation TEXT, numero_sequentiel INTEGER, reference_principale TEXT UNIQUE,
  prix_vente_envisage REAL, est_demo INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE article_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL, photo_path TEXT, photo_thumb_path TEXT,
  est_principale INTEGER NOT NULL DEFAULT 0, ordre INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE commandes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER, type_production TEXT,
  reference_production TEXT, numero_reassort INTEGER, deleted_at TEXT
);
CREATE TABLE declinaison_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT NOT NULL UNIQUE, nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE, affichage_couleur INTEGER NOT NULL DEFAULT 0,
  ordre INTEGER DEFAULT 0, actif INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE declinaison_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, declinaison_type_id INTEGER NOT NULL, valeur TEXT NOT NULL,
  valeur_normalisee TEXT NOT NULL, couleur_hex TEXT, ordre INTEGER DEFAULT 0, actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), UNIQUE(declinaison_type_id, valeur_normalisee)
);
CREATE TABLE article_declinaison_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL, declinaison_type_id INTEGER NOT NULL, ordre INTEGER
);
CREATE TABLE article_declinaison_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL, declinaison_type_id INTEGER NOT NULL, declinaison_valeur_id INTEGER NOT NULL
);
CREATE TABLE article_variantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_id INTEGER NOT NULL, sku TEXT, code_barres TEXT,
  reference_interne TEXT, actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
);
CREATE TABLE article_variante_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT, article_variante_id INTEGER NOT NULL, declinaison_type_id INTEGER NOT NULL, declinaison_valeur_id INTEGER NOT NULL
);
`;

async function main() {
  console.log("=== 1. Verification structurelle (8 tables du Lot 1) ===");
  const sqliteDbPath = path.join(__dirname, "test-lot-articles.sqlite");
  if (fs.existsSync(sqliteDbPath)) fs.unlinkSync(sqliteDbPath);
  const rawDb = new Database(sqliteDbPath);
  rawDb.exec(SCHEMA_SQLITE);
  const sqliteAdapter = creerAdaptateurSqlite(rawDb);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const postgresAdapter = creerAdaptateurPostgres(pool, require("pg"));

  const tables = ["articles", "article_photos", "declinaison_types", "declinaison_valeurs", "article_declinaison_types", "article_declinaison_valeurs", "article_variantes", "article_variante_valeurs"];
  let structOk = true;
  for (const t of tables) {
    const colsS = rawDb.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name).sort();
    const colsPRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name", [t]);
    const colsP = colsPRes.rows.map((r) => r.column_name).sort();
    const ok = JSON.stringify(colsS) === JSON.stringify(colsP);
    console.log(`  ${ok ? "OK" : "ECHEC"} ${t}`);
    if (!ok) { structOk = false; console.log(`         SQLite: ${colsS.join(",")}\n         Postgres: ${colsP.join(",")}`); }
  }
  if (!structOk) { rawDb.close(); await pool.end(); process.exit(1); }
  console.log("");

  // Nettoyage prealable cote Postgres (ordre des dependances respecte)
  await pool.query("DELETE FROM article_variante_valeurs"); await pool.query("DELETE FROM article_variantes");
  await pool.query("DELETE FROM article_declinaison_valeurs"); await pool.query("DELETE FROM article_declinaison_types");
  await pool.query("DELETE FROM article_photos"); await pool.query("DELETE FROM articles");
  await pool.query("DELETE FROM declinaison_valeurs"); await pool.query("DELETE FROM declinaison_types");
  await pool.query("DELETE FROM listes_valeurs");

  // --- Referentiel commun (produit/saison/rayon) ---
  async function seedListe(adapter, type, nom, code) {
    const info = await adapter.run("INSERT INTO listes_valeurs (type, nom, nom_normalise, code) VALUES (?, ?, ?, ?) RETURNING id", [type, nom, nom.toLowerCase(), code || null]);
    return info.lastInsertRowid;
  }
  const produitIdS = await seedListe(sqliteAdapter, "produit", "TEST_Teddy", null);
  const produitIdP = await seedListe(postgresAdapter, "produit", "TEST_Teddy", null);
  const saisonIdS = await seedListe(sqliteAdapter, "saison", "TEST_FW26", "FW26");
  const saisonIdP = await seedListe(postgresAdapter, "saison", "TEST_FW26", "FW26");
  const rayonIdS = await seedListe(sqliteAdapter, "rayon", "TEST_Femme", "F");
  const rayonIdP = await seedListe(postgresAdapter, "rayon", "TEST_Femme", "F");

  console.log("=== 2. Creation article + generation de reference ===");
  const payload = { produit_id: produitIdS, saison_id: saisonIdS, rayon_id: rayonIdS, annee_collection: 2026, abreviation: "TED" };
  const payloadP = { produit_id: produitIdP, saison_id: saisonIdP, rayon_id: rayonIdP, annee_collection: 2026, abreviation: "TED" };
  const artS = await articles.create(sqliteAdapter, payload);
  const artP = await articles.create(postgresAdapter, payloadP);
  comparer("create() reference generee", { reference: artS.reference_principale, numero_sequentiel: artS.numero_sequentiel, photos: artS.photos },
    { reference: artP.reference_principale, numero_sequentiel: artP.numero_sequentiel, photos: artP.photos });

  console.log("=== 3. Deuxieme article meme combinaison -> sequentiel incremente ===");
  const art2S = await articles.create(sqliteAdapter, payload);
  const art2P = await articles.create(postgresAdapter, payloadP);
  comparer("create() 2e article, sequentiel suivant", art2S.numero_sequentiel, art2P.numero_sequentiel);
  comparer("create() 2e article, reference", art2S.reference_principale, art2P.reference_principale);

  console.log("=== 4. Validation (annee invalide, abreviation invalide) ===");
  await comparerErreurs("create() annee invalide",
    () => articles.create(sqliteAdapter, { ...payload, annee_collection: 26 }),
    () => articles.create(postgresAdapter, { ...payloadP, annee_collection: 26 }));
  await comparerErreurs("create() abreviation invalide (minuscules)",
    () => articles.create(sqliteAdapter, { ...payload, abreviation: "ted" }),
    () => articles.create(postgresAdapter, { ...payloadP, abreviation: "ted" }));

  console.log("=== 5. list() et get() ===");
  const listS = await articles.list(sqliteAdapter, { includeIncomplete: true });
  const listP = await articles.list(postgresAdapter, { includeIncomplete: true });
  comparer("list() nombre d'articles", listS.length, listP.length);
  const getS = await articles.get(sqliteAdapter, artS.id);
  const getP = await articles.get(postgresAdapter, artP.id);
  comparer("get() structure complete", { ...getS, id: undefined, uuid: undefined, produit_id: undefined, saison_id: undefined, rayon_id: undefined }, { ...getP, id: undefined, uuid: undefined, produit_id: undefined, saison_id: undefined, rayon_id: undefined });

  console.log("=== 6. Types de declinaison : creation, doublons, tri casse mixte ===");
  const tCouleurS = await declinaisons.createType(sqliteAdapter, "TEST_Couleur");
  const tCouleurP = await declinaisons.createType(postgresAdapter, "TEST_Couleur");
  comparer("createType()", tCouleurS, tCouleurP, { ignorerChamps: ["id"] });
  await comparerErreurs("createType() doublon",
    () => declinaisons.createType(sqliteAdapter, "TEST_Couleur"),
    () => declinaisons.createType(postgresAdapter, "TEST_Couleur"));

  await declinaisons.createType(sqliteAdapter, "TEST_zebre");
  await declinaisons.createType(postgresAdapter, "TEST_zebre");
  await declinaisons.createType(sqliteAdapter, "TEST_Alpha");
  await declinaisons.createType(postgresAdapter, "TEST_Alpha");
  const typesS = (await declinaisons.listTypes(sqliteAdapter)).filter((t) => t.nom.startsWith("TEST_")).map((t) => t.nom);
  const typesP = (await declinaisons.listTypes(postgresAdapter)).filter((t) => t.nom.startsWith("TEST_")).map((t) => t.nom);
  comparer("listTypes() tri avec casse mixte", typesS, typesP);

  const tTailleS = await declinaisons.createType(sqliteAdapter, "TEST_Taille");
  const tTailleP = await declinaisons.createType(postgresAdapter, "TEST_Taille");

  console.log("=== 7. Valeurs : creation, doublons, tri casse mixte, couleur hex ===");
  const vRougeS = await declinaisons.createValeur(sqliteAdapter, tCouleurS.id, "TEST_Rouge", { couleur_hex: "#FF0000" });
  const vRougeP = await declinaisons.createValeur(postgresAdapter, tCouleurP.id, "TEST_Rouge", { couleur_hex: "#FF0000" });
  comparer("createValeur() avec couleur_hex", vRougeS, vRougeP, { ignorerChamps: ["id", "declinaison_type_id"] });
  await comparerErreurs("createValeur() couleur_hex invalide",
    () => declinaisons.createValeur(sqliteAdapter, tCouleurS.id, "TEST_Verte", { couleur_hex: "pasunhex" }),
    () => declinaisons.createValeur(postgresAdapter, tCouleurP.id, "TEST_Verte", { couleur_hex: "pasunhex" }));

  const vSS = await declinaisons.createValeur(sqliteAdapter, tTailleS.id, "TEST_S");
  const vSP = await declinaisons.createValeur(postgresAdapter, tTailleP.id, "TEST_S");
  const vMS = await declinaisons.createValeur(sqliteAdapter, tTailleS.id, "TEST_M");
  const vMP = await declinaisons.createValeur(postgresAdapter, tTailleP.id, "TEST_M");
  const vLS = await declinaisons.createValeur(sqliteAdapter, tTailleS.id, "TEST_l");  // minuscule expres
  const vLP = await declinaisons.createValeur(postgresAdapter, tTailleP.id, "TEST_l");
  const valsS = (await declinaisons.listValeurs(sqliteAdapter, tTailleS.id)).map((v) => v.valeur);
  const valsP = (await declinaisons.listValeurs(postgresAdapter, tTailleP.id)).map((v) => v.valeur);
  comparer("listValeurs() tri avec casse mixte", valsS, valsP);

  console.log("=== 8. Generation de variantes (produit cartesien couleur x taille) ===");
  const selections = { [tCouleurS.id]: [vRougeS.id], [tTailleS.id]: [vSS.id, vMS.id, vLS.id] };
  const selectionsP = { [tCouleurP.id]: [vRougeP.id], [tTailleP.id]: [vSP.id, vMP.id, vLP.id] };
  const genS = await declinaisons.genererVariantes(sqliteAdapter, artS.id, selections);
  const genP = await declinaisons.genererVariantes(postgresAdapter, artP.id, selectionsP);
  comparer("genererVariantes() total/creees/deja_existantes", { total: genS.total, creees: genS.creees, deja_existantes: genS.deja_existantes },
    { total: genP.total, creees: genP.creees, deja_existantes: genP.deja_existantes });
  comparer("genererVariantes() nb variantes retournees", genS.variantes.length, genP.variantes.length);

  console.log("=== 9. Regenerer les memes variantes -> 0 nouvelle creation ===");
  const gen2S = await declinaisons.genererVariantes(sqliteAdapter, artS.id, selections);
  const gen2P = await declinaisons.genererVariantes(postgresAdapter, artP.id, selectionsP);
  comparer("genererVariantes() 2e appel, aucune nouvelle creation", { creees: gen2S.creees, deja_existantes: gen2S.deja_existantes }, { creees: gen2P.creees, deja_existantes: gen2P.deja_existantes });

  console.log("=== 10. Previsualisation d'impact (retrait d'une valeur -> obsolete) ===");
  const selectionsReduites = { [tCouleurS.id]: [vRougeS.id], [tTailleS.id]: [vSS.id, vMS.id] }; // retire L
  const selectionsReduitesP = { [tCouleurP.id]: [vRougeP.id], [tTailleP.id]: [vSP.id, vMP.id] };
  const impactS = await declinaisons.previsualiserImpact(sqliteAdapter, artS.id, selectionsReduites);
  const impactP = await declinaisons.previsualiserImpact(postgresAdapter, artP.id, selectionsReduitesP);
  comparer("previsualiserImpact() conservees/obsoletes/nouvelles", { conservees: impactS.conservees, obsoletes: impactS.obsoletes, nouvelles: impactS.nouvelles, total_attendu: impactS.total_attendu },
    { conservees: impactP.conservees, obsoletes: impactP.obsoletes, nouvelles: impactP.nouvelles, total_attendu: impactP.total_attendu });

  console.log("=== 11. Application de la configuration reduite ===");
  const appliS = await declinaisons.appliquerConfiguration(sqliteAdapter, artS.id, [tCouleurS.id, tTailleS.id], selectionsReduites);
  const appliP = await declinaisons.appliquerConfiguration(postgresAdapter, artP.id, [tCouleurP.id, tTailleP.id], selectionsReduitesP);
  comparer("appliquerConfiguration() impact applique", { obsoletes: appliS.impact.obsoletes, conservees: appliS.impact.conservees }, { obsoletes: appliP.impact.obsoletes, conservees: appliP.impact.conservees });

  const variantesApresS = await declinaisons.listVariantes(sqliteAdapter, artS.id, { includeInactive: true });
  const variantesApresP = await declinaisons.listVariantes(postgresAdapter, artP.id, { includeInactive: true });
  const actifsS = variantesApresS.map((v) => v.actif).sort();
  const actifsP = variantesApresP.map((v) => v.actif).sort();
  comparer("Etat actif/inactif des variantes apres application", actifsS, actifsP);

  console.log("=== 12. Reactivation via appliquerConfiguration (remettre L) ===");
  const appliRetourS = await declinaisons.appliquerConfiguration(sqliteAdapter, artS.id, [tCouleurS.id, tTailleS.id], selections);
  const appliRetourP = await declinaisons.appliquerConfiguration(postgresAdapter, artP.id, [tCouleurP.id, tTailleP.id], selectionsP);
  comparer("appliquerConfiguration() reactivation", appliRetourS.impact.a_reactiver, appliRetourP.impact.a_reactiver);

  console.log("=== 13. Photo principale (partie DB uniquement, sans upload physique) ===");
  const photoInsS = await sqliteAdapter.run("INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, 1, 1) RETURNING id", [artS.id, "/fake/path.jpg", "/fake/thumb.jpg"]);
  const photoInsP = await postgresAdapter.run("INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, 1, 1) RETURNING id", [artP.id, "/fake/path.jpg", "/fake/thumb.jpg"]);
  const photo2InsS = await sqliteAdapter.run("INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, 0, 2) RETURNING id", [artS.id, "/fake/path2.jpg", "/fake/thumb2.jpg"]);
  const photo2InsP = await postgresAdapter.run("INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, 0, 2) RETURNING id", [artP.id, "/fake/path2.jpg", "/fake/thumb2.jpg"]);
  const defS = await articles.definirPhotoPrincipale(sqliteAdapter, photo2InsS.lastInsertRowid);
  const defP = await articles.definirPhotoPrincipale(postgresAdapter, photo2InsP.lastInsertRowid);
  comparer("definirPhotoPrincipale()", defS.map((p) => p.est_principale).sort(), defP.map((p) => p.est_principale).sort());

  const retS = await articles.retirerPhoto(sqliteAdapter, photoInsS.lastInsertRowid);
  const retP = await articles.retirerPhoto(postgresAdapter, photoInsP.lastInsertRowid);
  comparer("retirerPhoto() reassigne la principale restante", retS.length, retP.length);

  console.log("\n=== Nettoyage des donnees de test cote PostgreSQL ===");
  await pool.query("DELETE FROM article_variante_valeurs"); await pool.query("DELETE FROM article_variantes");
  await pool.query("DELETE FROM article_declinaison_valeurs"); await pool.query("DELETE FROM article_declinaison_types");
  await pool.query("DELETE FROM article_photos"); await pool.query("DELETE FROM articles WHERE abreviation = 'TED'");
  await pool.query("DELETE FROM declinaison_valeurs WHERE valeur LIKE 'TEST%'"); await pool.query("DELETE FROM declinaison_types WHERE nom LIKE 'TEST%'");
  await pool.query("DELETE FROM listes_valeurs WHERE nom LIKE 'TEST%'");
  console.log("  Nettoyage termine.");

  rawDb.close(); fs.unlinkSync(sqliteDbPath); await pool.end();

  console.log("\n=== RESULTAT FINAL ===");
  console.log(`  ${resultats.ok} test(s) identique(s), ${resultats.echec} divergence(s).`);
  if (resultats.echec > 0) { console.log("  Lot 1 (Articles) n'est PAS encore validé."); process.exit(1); }
  console.log("  Comportement strictement identique confirmé sur les deux moteurs.");
}

main().catch((err) => { console.error("Erreur inattendue :", err.message, err.stack); process.exit(1); });
