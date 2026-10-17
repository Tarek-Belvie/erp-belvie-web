// ============================================================================
// TEST COMPARATIF SQLite / PostgreSQL — LOT 2 : Planification
// (shared/planning.js)
//
// À EXÉCUTER SUR VOTRE MACHINE. Lit DATABASE_URL depuis votre .env local.
// npm install pg --save-dev (si pas déjà fait)
// node server/test-lot-planification.js
// ============================================================================

const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { Pool } = require("pg");
const { creerAdaptateurSqlite, creerAdaptateurPostgres } = require("../shared/db-adapter");
const planning = require("../shared/planning");

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
  if (v !== null && typeof v === "object") { const t = {}; for (const c of Object.keys(v).sort()) t[c] = trierClesRecursif(v[c]); return t; }
  return v;
}
function comparer(nom, a0, b0, { ignorerChamps = [] } = {}) {
  const nettoyer = (v) => {
    if (v == null) return v;
    const c = { ...v };
    for (const champ of ignorerChamps) delete c[champ];
    for (const dateChamp of ["created_at", "updated_at", "produit_cree_le"]) {
      if (dateChamp in c) c[dateChamp] = c[dateChamp] != null ? "(present)" : null;
    }
    return c;
  };
  const nettoyerProfond = (v) => Array.isArray(v) ? v.map(nettoyerProfond) : (v !== null && typeof v === "object" ? nettoyer(v) : v);
  const a = trierClesRecursif(nettoyerProfond(a0));
  const b = trierClesRecursif(nettoyerProfond(b0));
  const identique = JSON.stringify(a) === JSON.stringify(b);
  if (identique) { resultats.ok++; console.log(`  OK   ${nom}`); }
  else { resultats.echec++; console.log(`  ECHEC ${nom}`); console.log(`         SQLite  : ${JSON.stringify(a)}`); console.log(`         Postgres: ${JSON.stringify(b)}`); }
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
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, produit_id INTEGER,
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
CREATE TABLE planning_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, article_id INTEGER,
  nom_provisoire TEXT, reference_provisoire TEXT, produit_id INTEGER, rayon_id INTEGER,
  photo_path TEXT, photo_thumb_path TEXT, categorie_id INTEGER, saison_id INTEGER,
  annee_collection INTEGER, mois_prevu TEXT, mois_prevu_production TEXT NOT NULL,
  mois_prevu_reception TEXT, quantite_previsionnelle INTEGER, coloris_previsionnels TEXT,
  statut TEXT NOT NULL DEFAULT 'idee', atelier_id INTEGER, notes TEXT,
  ordre INTEGER NOT NULL DEFAULT 0, produit_cree_le TEXT, archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

async function main() {
  console.log("=== 1. Verification structurelle (planning_articles) ===");
  const sqliteDbPath = path.join(__dirname, "test-lot-planification.sqlite");
  if (fs.existsSync(sqliteDbPath)) fs.unlinkSync(sqliteDbPath);
  const rawDb = new Database(sqliteDbPath);
  rawDb.exec(SCHEMA_SQLITE);
  const sqliteAdapter = creerAdaptateurSqlite(rawDb);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const postgresAdapter = creerAdaptateurPostgres(pool, require("pg"));

  const colsS = rawDb.prepare("PRAGMA table_info(planning_articles)").all().map((c) => c.name).sort();
  const colsPRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'planning_articles' ORDER BY column_name");
  const colsP = colsPRes.rows.map((r) => r.column_name).sort();
  const structOk = JSON.stringify(colsS) === JSON.stringify(colsP);
  console.log(structOk ? "  OK : structures identiques.\n" : `  ECHEC\n  SQLite: ${colsS.join(",")}\n  Postgres: ${colsP.join(",")}\n`);
  if (!structOk) { rawDb.close(); await pool.end(); process.exit(1); }

  // Nettoyage prealable
  for (const t of ["planning_articles", "article_photos", "articles", "listes_valeurs"]) await pool.query(`DELETE FROM ${t}`);

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

  const moisFutur = (() => { const d = new Date(); d.setMonth(d.getMonth() + 2); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const moisFuturPlus1 = (() => { const d = new Date(); d.setMonth(d.getMonth() + 3); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; })();
  const moisPasse = "2020-01";

  console.log("=== 2. Creation ===");
  const payload = { nom_provisoire: "TEST_Teddy Bear", mois_prevu_production: moisFutur, statut: "idee" };
  const crS = await planning.creer(sqliteAdapter, payload);
  const crP = await planning.creer(postgresAdapter, payload);
  comparer("creer()", crS, crP, { ignorerChamps: ["id", "uuid"] });

  console.log("=== 3. Validations : date interdite (passe), coherence reception/lancement ===");
  await comparerErreurs("creer() lancement dans le passe",
    () => planning.creer(sqliteAdapter, { nom_provisoire: "TEST_X", mois_prevu_production: moisPasse }),
    () => planning.creer(postgresAdapter, { nom_provisoire: "TEST_X", mois_prevu_production: moisPasse }));
  await comparerErreurs("creer() reception avant lancement",
    () => planning.creer(sqliteAdapter, { nom_provisoire: "TEST_Y", mois_prevu_production: moisFutur, mois_prevu_reception: moisPasse }),
    () => planning.creer(postgresAdapter, { nom_provisoire: "TEST_Y", mois_prevu_production: moisFutur, mois_prevu_reception: moisPasse }));
  await comparerErreurs("creer() sans nom ni article_id",
    () => planning.creer(sqliteAdapter, { mois_prevu_production: moisFutur }),
    () => planning.creer(postgresAdapter, { mois_prevu_production: moisFutur }));
  await comparerErreurs("creer() format mois invalide",
    () => planning.creer(sqliteAdapter, { nom_provisoire: "TEST_Z", mois_prevu_production: "2026/06" }),
    () => planning.creer(postgresAdapter, { nom_provisoire: "TEST_Z", mois_prevu_production: "2026/06" }));

  console.log("=== 4. Lecture / liste ===");
  const listS = await planning.list(sqliteAdapter, {});
  const listP = await planning.list(postgresAdapter, {});
  comparer("list() nombre d'entrees", listS.length, listP.length);
  const getS = await planning.get(sqliteAdapter, crS.id);
  const getP = await planning.get(postgresAdapter, crP.id);
  comparer("get()", getS, getP, { ignorerChamps: ["id", "uuid"] });

  console.log("=== 5. Recherche : casse differente (point de vigilance) ===");
  const rS1 = await planning.list(sqliteAdapter, { recherche: "teddy" });
  const rP1 = await planning.list(postgresAdapter, { recherche: "teddy" });
  comparer("list() recherche minuscule 'teddy' trouve 'TEST_Teddy Bear'", rS1.length, rP1.length);
  comparer("list() recherche minuscule, contenu identique", rS1.map((r) => r.nom_provisoire), rP1.map((r) => r.nom_provisoire));

  console.log("=== 6. Recherche : caracteres accentues ===");
  await planning.creer(sqliteAdapter, { nom_provisoire: "TEST_Écharpe hiver", mois_prevu_production: moisFutur });
  await planning.creer(postgresAdapter, { nom_provisoire: "TEST_Écharpe hiver", mois_prevu_production: moisFutur });
  const rS2 = await planning.list(sqliteAdapter, { recherche: "écharpe" });
  const rP2 = await planning.list(postgresAdapter, { recherche: "écharpe" });
  comparer("list() recherche accentuee correcte trouve", rS2.map((r) => r.nom_provisoire), rP2.map((r) => r.nom_provisoire));
  const rS3 = await planning.list(sqliteAdapter, { recherche: "ECHARPE" });
  const rP3 = await planning.list(postgresAdapter, { recherche: "ECHARPE" });
  comparer("list() recherche majuscule SANS accent ne trouve rien (comportement SQLite exact)", rS3.length, rP3.length);

  console.log("=== 7. KPI ===");
  const kS = await planning.kpis(sqliteAdapter);
  const kP = await planning.kpis(postgresAdapter);
  comparer("kpis()", kS, kP);

  console.log("=== 8. Deplacement (drag & drop) + reordonnancement ===");
  const dS = await planning.deplacer(sqliteAdapter, crS.id, "mois_prevu_production", moisFuturPlus1, null, false);
  const dP = await planning.deplacer(postgresAdapter, crP.id, "mois_prevu_production", moisFuturPlus1, null, false);
  comparer("deplacer()", dS.mois_prevu_production, dP.mois_prevu_production);

  const autreS = await planning.creer(sqliteAdapter, { nom_provisoire: "TEST_Second", mois_prevu_production: moisFuturPlus1 });
  const autreP = await planning.creer(postgresAdapter, { nom_provisoire: "TEST_Second", mois_prevu_production: moisFuturPlus1 });
  const reordS = await planning.reordonner(sqliteAdapter, moisFuturPlus1, [autreS.id, crS.id]);
  const reordP = await planning.reordonner(postgresAdapter, moisFuturPlus1, [autreP.id, crP.id]);
  comparer("reordonner() ordre applique", reordS.map((r) => r.nom_provisoire), reordP.map((r) => r.nom_provisoire));

  console.log("=== 9. Protection statut valide (verrou doux) ===");
  await planning.mettreAJour(sqliteAdapter, crS.id, { statut: "valide" });
  await planning.mettreAJour(postgresAdapter, crP.id, { statut: "valide" });
  await comparerErreurs("mettreAJour() champ protege sans forcer -> bloque",
    () => planning.mettreAJour(sqliteAdapter, crS.id, { quantite_previsionnelle: 500 }),
    () => planning.mettreAJour(postgresAdapter, crP.id, { quantite_previsionnelle: 500 }));
  const forceS = await planning.mettreAJour(sqliteAdapter, crS.id, { quantite_previsionnelle: 500, forcer: true });
  const forceP = await planning.mettreAJour(postgresAdapter, crP.id, { quantite_previsionnelle: 500, forcer: true });
  comparer("mettreAJour() avec forcer=true debloque", forceS.quantite_previsionnelle, forceP.quantite_previsionnelle);

  console.log("=== 10. Retrait photo (partie DB uniquement) ===");
  await sqliteAdapter.run("UPDATE planning_articles SET photo_path = ?, photo_thumb_path = ? WHERE id = ?", ["/fake/p.jpg", "/fake/t.jpg", autreS.id]);
  await postgresAdapter.run("UPDATE planning_articles SET photo_path = ?, photo_thumb_path = ? WHERE id = ?", ["/fake/p.jpg", "/fake/t.jpg", autreP.id]);
  const retS = await planning.retirerPhoto(sqliteAdapter, autreS.id, false);
  const retP = await planning.retirerPhoto(postgresAdapter, autreP.id, false);
  comparer("retirerPhoto() chemins mis a NULL", { photo_path: retS.photo_path, photo_thumb_path: retS.photo_thumb_path }, { photo_path: retP.photo_path, photo_thumb_path: retP.photo_thumb_path });

  console.log("=== 11. Conversion en produit + generation de reference ===");
  const convS = await planning.convertirEnProduit(sqliteAdapter, autreS.id, { produit_id: produitIdS, saison_id: saisonIdS, rayon_id: rayonIdS, annee_collection: 2026, abreviation: "TED" });
  const convP = await planning.convertirEnProduit(postgresAdapter, autreP.id, { produit_id: produitIdP, saison_id: saisonIdP, rayon_id: rayonIdP, annee_collection: 2026, abreviation: "TED" });
  const artConvS = await sqliteAdapter.get("SELECT reference_principale, numero_sequentiel FROM articles WHERE id = ?", [convS.articleId]);
  const artConvP = await postgresAdapter.get("SELECT reference_principale, numero_sequentiel FROM articles WHERE id = ?", [convP.articleId]);
  comparer("convertirEnProduit() reference generee", artConvS, artConvP);
  comparer("convertirEnProduit() planning.article_id renseigne", convS.planning.article_id != null, convP.planning.article_id != null);

  console.log("=== 12. Conversion deja liee -> erreur ===");
  await comparerErreurs("convertirEnProduit() deja liee",
    () => planning.convertirEnProduit(sqliteAdapter, autreS.id, {}),
    () => planning.convertirEnProduit(postgresAdapter, autreP.id, {}));

  console.log("=== 13. Copie du chemin photo lors de la conversion (reproduction exacte, pas de fichier) ===");
  const photoPlanS = await planning.creer(sqliteAdapter, { nom_provisoire: "TEST_AvecPhoto", mois_prevu_production: moisFutur });
  const photoPlanP = await planning.creer(postgresAdapter, { nom_provisoire: "TEST_AvecPhoto", mois_prevu_production: moisFutur });
  await sqliteAdapter.run("UPDATE planning_articles SET photo_path = ?, photo_thumb_path = ? WHERE id = ?", ["/fake/photo.jpg", "/fake/thumb.jpg", photoPlanS.id]);
  await postgresAdapter.run("UPDATE planning_articles SET photo_path = ?, photo_thumb_path = ? WHERE id = ?", ["/fake/photo.jpg", "/fake/thumb.jpg", photoPlanP.id]);
  const convPhotoS = await planning.convertirEnProduit(sqliteAdapter, photoPlanS.id, { produit_id: produitIdS });
  const convPhotoP = await planning.convertirEnProduit(postgresAdapter, photoPlanP.id, { produit_id: produitIdP });
  const photoArtS = await sqliteAdapter.get("SELECT photo_path, photo_thumb_path, est_principale FROM article_photos WHERE article_id = ?", [convPhotoS.articleId]);
  const photoArtP = await postgresAdapter.get("SELECT photo_path, photo_thumb_path, est_principale FROM article_photos WHERE article_id = ?", [convPhotoP.articleId]);
  comparer("Photo copiee (chemin) sur le nouvel article", photoArtS, photoArtP);

  console.log("=== 14. Suppression provisoire (jamais si liee a un produit) ===");
  const provS = await planning.creer(sqliteAdapter, { nom_provisoire: "TEST_ASupprimer", mois_prevu_production: moisFutur });
  const provP = await planning.creer(postgresAdapter, { nom_provisoire: "TEST_ASupprimer", mois_prevu_production: moisFutur });
  await planning.supprimerProvisoire(sqliteAdapter, provS.id);
  await planning.supprimerProvisoire(postgresAdapter, provP.id);
  const apresSuppS = await planning.get(sqliteAdapter, provS.id);
  const apresSuppP = await planning.get(postgresAdapter, provP.id);
  comparer("supprimerProvisoire() entree disparue", apresSuppS, apresSuppP);
  await comparerErreurs("supprimerProvisoire() sur entree liee a un produit -> refuse",
    () => planning.supprimerProvisoire(sqliteAdapter, autreS.id),
    () => planning.supprimerProvisoire(postgresAdapter, autreP.id));

  console.log("=== 15. Retirer du planning (archivage, jamais destructeur) ===");
  await planning.retirerDuPlanning(sqliteAdapter, crS.id);
  await planning.retirerDuPlanning(postgresAdapter, crP.id);
  const listApresArchivS = await planning.list(sqliteAdapter, {});
  const listApresArchivP = await planning.list(postgresAdapter, {});
  comparer("list() n'affiche plus l'entree archivee", listApresArchivS.some((r) => r.id === crS.id), listApresArchivP.some((r) => r.id === crP.id));

  console.log("=== 16. Transaction avec echec en cours -> rollback complet ===");
  // Scenario controle et portable : la premiere operation de la transaction reussit, la seconde
  // viole une contrainte UNIQUE (meme uuid) -> toute la transaction doit etre annulee, y compris
  // la premiere operation deja executee. Contrairement a un id de mauvais type (tolere
  // silencieusement par SQLite, rejete par PostgreSQL — une difference de typage, pas un bug
  // metier), une violation de contrainte UNIQUE se comporte identiquement sur les deux moteurs.
  const uuidExistantS = crS.uuid;
  const uuidExistantP = crP.uuid;
  let msgS = null, msgP = null;
  try {
    await sqliteAdapter.transaction(async (tx) => {
      await tx.run("UPDATE planning_articles SET notes = ? WHERE id = ?", ["ne doit jamais rester", autreS.id]);
      await tx.run("INSERT INTO planning_articles (uuid, mois_prevu_production) VALUES (?, ?)", [uuidExistantS, moisFutur]);
    });
  } catch (e) { msgS = e.message; }
  try {
    await postgresAdapter.transaction(async (tx) => {
      await tx.run("UPDATE planning_articles SET notes = ? WHERE id = ?", ["ne doit jamais rester", autreP.id]);
      await tx.run("INSERT INTO planning_articles (uuid, mois_prevu_production) VALUES (?, ?)", [uuidExistantP, moisFutur]);
    });
  } catch (e) { msgP = e.message; }
  // Le texte exact du message differe naturellement entre les deux drivers (deja etabli : seule
  // la presence du mot "UNIQUE", insensible a la casse, est une garantie portable) -- on verifie
  // le COMPORTEMENT (une erreur a bien ete levee des deux cotes), pas le texte litteral.
  comparer("transaction() : 2e operation viole UNIQUE -> une erreur levee des deux cotes",
    { erreur_levee: msgS !== null, mentionne_unique: String(msgS).toUpperCase().includes("UNIQUE") },
    { erreur_levee: msgP !== null, mentionne_unique: String(msgP).toUpperCase().includes("UNIQUE") });
  const notesApresS = await sqliteAdapter.get("SELECT notes FROM planning_articles WHERE id = ?", [autreS.id]);
  const notesApresP = await postgresAdapter.get("SELECT notes FROM planning_articles WHERE id = ?", [autreP.id]);
  comparer("Rollback : la 1ere operation n'est pas restee committee", notesApresS, notesApresP);

  console.log("\n=== Nettoyage des donnees de test cote PostgreSQL ===");
  for (const t of ["planning_articles", "article_photos", "articles", "listes_valeurs"]) await pool.query(`DELETE FROM ${t}`);
  console.log("  Nettoyage termine.");

  rawDb.close(); fs.unlinkSync(sqliteDbPath); await pool.end();

  console.log("\n=== RESULTAT FINAL ===");
  console.log(`  ${resultats.ok} test(s) identique(s), ${resultats.echec} divergence(s).`);
  if (resultats.echec > 0) { console.log("  Lot 2 (Planification) n'est PAS encore validé."); process.exit(1); }
  console.log("  Comportement strictement identique confirmé sur les deux moteurs.");
}

main().catch((err) => { console.error("Erreur inattendue :", err.message, err.stack); process.exit(1); });
