#!/usr/bin/env node
// ================================================================================================
// DÉMARRAGE EN LOCAL (Windows, macOS, Linux) — tout-en-un, pour essayer l'application sur son PC.
//
//   Windows : double-clic sur demarrer-en-local.bat     Autres : node tools/local/demarrer.js
//
// Ce que fait ce script, dans l'ordre :
//   1. installe les dépendances si besoin (npm install) ;
//   2. démarre une base PostgreSQL LOCALE, embarquée dans le dossier .local/ (rien à installer,
//      aucune base distante touchée — Neon et la production ne sont jamais utilisées ici) ;
//   3. applique les migrations ;
//   4. au premier lancement, recopie les VRAIES données de Belvie ERP (Electron) depuis
//      %APPDATA%\belvie-erp : la base est COPIÉE puis lue en lecture seule, les images sont copiées.
//      L'application Electron n'est jamais modifiée ;
//   5. crée un compte administrateur local (affiché à l'écran) ;
//   6. lance l'API (port 3001) et l'interface (port 5173), puis ouvre le navigateur.
//
// Tout ce qui est créé reste dans .local/ (ignoré par Git). Pour repartir de zéro : supprimer .local/.
// ================================================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn, spawnSync } = require("child_process");

const RACINE = path.resolve(__dirname, "../..");
const LOCAL = path.join(RACINE, ".local");
const PORT_PG = 54329;
const URL_PG = `postgres://belvie:belvie@localhost:${PORT_PG}/belvie`;
const COMPTE = { email: "admin@belvie.local", motDePasse: "belvie-local-2026", nom: "Administrateur local" };
const windows = process.platform === "win32";
const enfants = [];
let postgres = null;

const etape = (t) => console.log(`\n▶ ${t}`);
const info = (t) => console.log(`  ${t}`);

function executer(commande, args, options = {}) {
  const r = spawnSync(commande, args, { cwd: RACINE, stdio: "inherit", shell: windows, ...options });
  if (r.status !== 0) throw new Error(`Échec : ${commande} ${args.join(" ")}`);
}

function attendreUrl(url, delaiMs = 90000) {
  const debut = Date.now();
  return new Promise((ok, ko) => {
    const essayer = () => {
      http.get(url, (res) => { res.resume(); ok(); }).on("error", () => {
        if (Date.now() - debut > delaiMs) ko(new Error(`${url} ne répond pas.`)); else setTimeout(essayer, 1000);
      });
    };
    essayer();
  });
}

async function principal() {
  console.log("Belvie ERP — démarrage en local");
  const majeure = Number(process.versions.node.split(".")[0]);
  if (majeure < 20) throw new Error(`Node.js ${process.versions.node} est trop ancien : installer Node.js 22 (https://nodejs.org).`);
  fs.mkdirSync(LOCAL, { recursive: true });

  // 1. Dépendances
  if (!fs.existsSync(path.join(RACINE, "node_modules", "express"))) {
    etape("Installation des dépendances (première fois, quelques minutes)…");
    executer("npm", ["install", "--no-audit", "--no-fund"]);
  }
  if (!fs.existsSync(path.join(LOCAL, "node_modules", "embedded-postgres"))) {
    etape("Installation de la base PostgreSQL locale (première fois)…");
    fs.writeFileSync(path.join(LOCAL, "package.json"), JSON.stringify({ name: "belvie-local", private: true }));
    executer("npm", ["install", "--prefix", LOCAL, "embedded-postgres@17.10.0-beta.17", "--no-audit", "--no-fund"]);
  }

  // 2. Base locale
  etape("Démarrage de la base PostgreSQL locale…");
  const EmbeddedPostgres = require(require.resolve("embedded-postgres", { paths: [LOCAL] })).default;
  // UTF-8 imposé : sous Windows, initdb choisirait sinon l'encodage du système (WIN1252), qui ne
  // sait pas représenter tous les caractères des données (accents, symboles, « »…).
  const dossierPg = path.join(LOCAL, "postgres-utf8");
  const premiereFois = !fs.existsSync(path.join(dossierPg, "PG_VERSION"));
  postgres = new EmbeddedPostgres({
    databaseDir: dossierPg, user: "belvie", password: "belvie", port: PORT_PG, persistent: true,
    initdbFlags: ["--encoding=UTF8", "--locale=C"], onLog: () => {}, onError: () => {},
  });
  if (premiereFois) await postgres.initialise();
  await postgres.start();
  if (premiereFois) await postgres.createDatabase("belvie");
  info(`Base prête (${URL_PG}).`);

  const env = {
    ...process.env,
    DATABASE_URL: URL_PG,
    DOSSIER_DONNEES: path.join(LOCAL, "donnees"),
    DOSSIER_SAUVEGARDES: path.join(LOCAL, "sauvegardes"),
    PORT: "3001",
    NODE_ENV: "development",
  };
  const chrome = windows
    ? ["C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe", "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"].find((p) => fs.existsSync(p))
    : null;
  if (chrome && !env.CHROMIUM_PATH) env.CHROMIUM_PATH = chrome; // génération des PDF
  Object.assign(process.env, env);

  // 3. Migrations
  etape("Mise à jour du schéma…");
  const { migrer } = require(path.join(RACINE, "apps/api/src/db/migrer"));
  await migrer({ connectionString: URL_PG, journal: info });

  // 4. Reprise des données réelles (une seule fois)
  const pg = require(path.join(RACINE, "node_modules", "pg"));
  const client = new pg.Client({ connectionString: URL_PG });
  await client.connect();
  const nbArticles = Number((await client.query("SELECT count(*) n FROM articles")).rows[0].n);
  const nbComptes = Number((await client.query("SELECT count(*) n FROM utilisateurs")).rows[0].n);
  await client.end();

  const dossierElectron = windows ? path.join(process.env.APPDATA || "", "belvie-erp") : path.join(os.homedir(), ".config", "belvie-erp");
  const baseElectron = path.join(dossierElectron, "belvie.db");
  if (nbArticles === 0 && fs.existsSync(baseElectron)) {
    etape("Copie de vos données Belvie ERP (Electron) dans la base locale…");
    const copie = path.join(LOCAL, "reprise");
    fs.mkdirSync(copie, { recursive: true });
    for (const suffixe of ["", "-wal", "-shm"]) {
      const src = baseElectron + suffixe;
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(copie, "belvie.db" + suffixe));
    }
    try {
      executer(process.execPath, [
        path.join(RACINE, "tools/reprise-donnees/reprise.js"),
        "--sqlite", path.join(copie, "belvie.db"), "--pg", URL_PG,
        "--ignorer-table", "ft_tailles_new", "--archive", path.join(copie, "archives"), "--executer",
      ], { shell: false });
      const images = path.join(dossierElectron, "images");
      if (fs.existsSync(images)) {
        fs.cpSync(images, path.join(env.DOSSIER_DONNEES, "images"), { recursive: true });
        info("Images copiées.");
      }
    } catch (err) {
      info(`⚠ Reprise impossible (${err.message}) : l'application démarre avec une base vide.`);
    }
  } else if (nbArticles === 0) {
    info("Aucune base Belvie ERP trouvée sur ce PC : l'application démarre avec une base vide.");
  }

  // 5. Compte administrateur local
  if (nbComptes === 0) {
    const { creerBase } = require(path.join(RACINE, "apps/api/src/db"));
    const { creerUtilisateur } = require(path.join(RACINE, "apps/api/src/auth"));
    const db = creerBase({ connectionString: URL_PG });
    await db.initialiser();
    await creerUtilisateur(db, { email: COMPTE.email, nom: COMPTE.nom, motDePasse: COMPTE.motDePasse, role: "admin" });
    await db.fermer();
  }

  // 6. API + interface
  etape("Démarrage de l'API et de l'interface…");
  const api = spawn(process.execPath, [path.join(RACINE, "apps/api/src/server.js")], { cwd: path.join(RACINE, "apps/api"), env, stdio: "inherit" });
  enfants.push(api);
  await attendreUrl("http://localhost:3001/api/sante");
  const vite = spawn(windows ? "npx.cmd" : "npx", ["vite", "--port", "5173", "--strictPort"], { cwd: path.join(RACINE, "apps/web"), env, stdio: "inherit", shell: windows });
  enfants.push(vite);
  await attendreUrl("http://localhost:5173/");

  console.log("\n================================================================");
  console.log("  Belvie ERP tourne en local : http://localhost:5173");
  console.log(`  Compte : ${COMPTE.email}   Mot de passe : ${COMPTE.motDePasse}`);
  console.log("  (compte de test LOCAL uniquement — jamais utilisé en production)");
  console.log("  Pour arrêter : fermer cette fenêtre ou Ctrl+C.");
  console.log("================================================================\n");
  if (windows) spawn("cmd", ["/c", "start", "", "http://localhost:5173"], { detached: true, stdio: "ignore" });
  else if (process.platform === "darwin") spawn("open", ["http://localhost:5173"], { detached: true, stdio: "ignore" });
}

async function arreter(code = 0) {
  for (const e of enfants) { try { e.kill(); } catch (_) { /* déjà arrêté */ } }
  if (postgres) { try { await postgres.stop(); } catch (_) { /* déjà arrêtée */ } }
  process.exit(code);
}
process.on("SIGINT", () => arreter(0));
process.on("SIGTERM", () => arreter(0));

principal().catch(async (err) => {
  console.error(`\n✖ ${err.message}`);
  await arreter(1);
});
