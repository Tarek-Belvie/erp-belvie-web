// ================================================================================================
// HARNAIS DE NON-RÉGRESSION « ANCIEN / NOUVEAU ».
//
// Chaque appel est exécuté deux fois, avec les mêmes arguments :
//   * ANCIEN  : le code Electron 1.0.1 d'origine (tag git electron-1.0.1), sur SQLite ;
//   * NOUVEAU : le code de apps/api, sur PostgreSQL, via le registre des routes.
// Les deux bases partent du même état (installation neuve). Les résultats (ou les messages
// d'erreur) doivent être identiques, aux horodatages près.
//
// Ce harnais est la preuve que la migration n'a rien changé au comportement métier. Il sera
// retiré quand la version Electron ne servira plus de référence.
// ================================================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const { execSync } = require("child_process");
const pg = require("pg");
const { creerBase } = require("../../src/db");
const { migrer } = require("../../src/db/migrer");
const registre = require("../../src/routes/registre");

const RACINE = path.resolve(__dirname, "../../../..");
const URL_ADMIN = process.env.DATABASE_URL_TEST_ADMIN || process.env.DATABASE_URL;

// ---------------------------------------------------------------- Code d'origine
function extraireAncienCode() {
  const dossier = path.join(os.tmpdir(), "belvie-electron-1.0.1");
  if (!fs.existsSync(path.join(dossier, "electron/main.js"))) {
    fs.mkdirSync(dossier, { recursive: true });
    execSync(`git -C "${RACINE}" archive electron-1.0.1 electron package.json | tar -x -C "${dossier}"`);
  }
  return dossier;
}

let faussesDonnees = null;
function installerFauxElectron(dossierDonnees) {
  faussesDonnees = dossierDonnees;
  const faux = {
    app: { getPath: () => faussesDonnees, getVersion: () => "1.0.1", isPackaged: false, setPath() {}, on() {}, quit() {} },
    dialog: { showErrorBox() {}, showMessageBoxSync() { return 0; }, showOpenDialog: async () => ({ canceled: true }), showSaveDialog: async () => ({ canceled: true }) },
    BrowserWindow: class {}, ipcMain: { handle() {} }, protocol: {}, net: {}, shell: {},
  };
  const resoudre = Module._resolveFilename;
  const cheminFaux = path.join(os.tmpdir(), "belvie-faux-electron.js");
  fs.writeFileSync(cheminFaux, "module.exports = global.__fauxElectron;");
  global.__fauxElectron = faux;
  const nmApi = path.join(RACINE, "node_modules");
  Module._resolveFilename = function (req, parent, ...reste) {
    if (req === "electron") return cheminFaux;
    try { return resoudre.call(this, req, parent, ...reste); }
    catch (err) {
      // Le code d'origine est extrait hors du dépôt : ses dépendances viennent de node_modules.
      if (!req.startsWith(".") && !path.isAbsolute(req)) return resoudre.call(this, req, { ...parent, paths: [nmApi] }, ...reste);
      throw err;
    }
  };
}

// ---------------------------------------------------------------- Inventaire des canaux d'origine
function canauxOrigine(dossier) {
  const main = fs.readFileSync(path.join(dossier, "electron/main.js"), "utf8");
  const vars = {};
  for (const m of main.matchAll(/const (\w+) = require\("\.\/ipc\/(\w+)"\);/g)) vars[m[1]] = m[2];
  const canaux = {};
  const re = /ipcMain\.handle\("([\w:]+)",\s*\(([^)]*)\)\s*=>\s*\n?\s*(\w+)\.(\w+)\(([^;]*?)\)\s*\)?;/g;
  for (const m of main.matchAll(re)) {
    const params = m[2].split(",").map((s) => s.trim()).filter(Boolean).slice(1);
    const args = m[5].split(",").map((s) => s.trim()).filter(Boolean);
    if (!vars[m[3]]) continue;
    canaux[m[1]] = { module: vars[m[3]], fonction: m[4], avecDb: args[0] === "getDb()", params };
  }
  return canaux;
}

// ---------------------------------------------------------------- Normalisation pour comparaison
const RE_HORODATAGE = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/;
const RE_JOUR = /^\d{4}-\d{2}-\d{2}$/;
const CHAMPS_VOLATILS = new Set(["created_at", "updated_at", "validated_at", "envoye_at", "figee_le", "remplacee_le", "archived_at", "commande_synced_at", "uuid", "derniere_connexion", "deleted_at"]);
// Colonnes présentes dans d'anciennes bases SQLite mais retirées du schéma (toujours vides) :
// elles apparaissent côté ancien code et pas côté nouveau, sans que ce soit un écart.
const COLONNES_OBSOLETES = new Set(["reference_libre"]);
function normaliser(v, cle) {
  if (v === undefined) return "__undefined__";
  if (v === null) return null;
  if (typeof v === "bigint") return Number(v);
  if (typeof v === "string") {
    if (cle && CHAMPS_VOLATILS.has(cle) && v) return "__horodatage__";
    if (RE_HORODATAGE.test(v)) return "__horodatage__";
    return v;
  }
  if (typeof v === "number") return Number.isInteger(v) ? v : Number(v.toPrecision(12));
  if (Buffer.isBuffer(v)) return "__binaire__" + v.length;
  if (Array.isArray(v)) return v.map((x) => normaliser(x));
  if (typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) { if (COLONNES_OBSOLETES.has(k) && v[k] === null) continue; o[k] = normaliser(v[k], k); }
    return o;
  }
  return v;
}
function differences(a, b, chemin = "", out = []) {
  if (out.length > 20) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === "object" && typeof b === "object" && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) out.push(`${chemin || "racine"} : longueur ${a.length} ≠ ${b.length}`);
    const cles = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of cles) differences(a[k], b[k], chemin ? `${chemin}.${k}` : k, out);
    return out;
  }
  out.push(`${chemin || "racine"} : ancien=${JSON.stringify(a)?.slice(0, 200)} nouveau=${JSON.stringify(b)?.slice(0, 200)}`);
  return out;
}

// ---------------------------------------------------------------- Création des deux mondes
async function creerMondes({ nom = "diff", sqliteSource = null, ignorerTables = [] } = {}) {
  const dossier = extraireAncienCode();
  const travail = fs.mkdtempSync(path.join(os.tmpdir(), "belvie-diff-"));
  const donneesAncien = path.join(travail, "ancien");
  const donneesNouveau = path.join(travail, "nouveau");
  fs.mkdirSync(donneesAncien); fs.mkdirSync(donneesNouveau);
  process.env.DOSSIER_DONNEES = donneesNouveau;
  installerFauxElectron(donneesAncien);
  // Partir d'une base existante (ex. copie de la base réelle) : l'ancien code l'ouvre telle
  // quelle, et la nouvelle base reçoit la même chose par l'outil de reprise.
  if (sqliteSource) fs.copyFileSync(sqliteSource, path.join(donneesAncien, "belvie.db"));

  const journalOrigine = console.log; console.log = () => {};
  let ancienDbModule;
  try {
    ancienDbModule = require(path.join(dossier, "electron/db"));
    ancienDbModule.openDatabase();
  } finally { console.log = journalOrigine; }
  const ancienDb = ancienDbModule.getDb();

  const nomBase = `belvie_test_${nom}_${process.pid}_${Date.now()}`.toLowerCase();
  const admin = new pg.Client({ connectionString: URL_ADMIN });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${nomBase}`);
  await admin.end();
  const url = new URL(URL_ADMIN); url.pathname = "/" + nomBase;
  const urlTest = url.toString();
  await migrer({ connectionString: urlTest, journal: () => {} });
  if (sqliteSource) {
    const outil = path.join(RACINE, "tools/reprise-donnees/reprise.js");
    const ign = ignorerTables.map((t) => `--ignorer-table ${t}`).join(" ");
    execSync(`node "${outil}" --sqlite "${sqliteSource}" --pg "${urlTest}" ${ign} --archive "${path.join(travail, "archives")}" --executer`, { stdio: "pipe" });
  }
  const nouveauDb = creerBase({ connectionString: urlTest });
  await nouveauDb.initialiser();

  const canaux = canauxOrigine(dossier);
  const ancienModules = {};
  const chargerAncien = (m) => (ancienModules[m] = ancienModules[m] || require(path.join(dossier, "electron/ipc", m)));
  const parCanal = new Map(registre.map((r) => [`${r.espace}:${r.methode}`, r]));

  const journal = [];
  // Exécute le canal sur les deux mondes et note tout écart dans le journal.
  // Renvoie le résultat du NOUVEAU code (ou lève l'erreur, si les deux ont échoué pareil).
  async function appeler(canal, ...args) {
    const r = parCanal.get(canal);
    const c = canaux[canal];
    if (!r || !c) throw new Error(`Canal inconnu du harnais : ${canal}`);
    let ancien, nouveau, errA = null, errN = null;
    try {
      const m = chargerAncien(c.module);
      const a = structuredClone(args);
      ancien = await (c.avecDb ? m[c.fonction](ancienDb, ...a) : m[c.fonction](...a));
    } catch (e) { errA = e; }
    try { nouveau = await r.appel(nouveauDb, ...structuredClone(args)); } catch (e) { errN = e; }
    const entree = { canal, args };
    journal.push(entree);
    if (errA || errN) {
      const ma = errA ? errA.message : null;
      const mn = errN ? errN.message.split("\n")[0] : null;
      if (ma !== mn) {
        entree.ecart = [`erreur : ancien=${JSON.stringify(ma)} nouveau=${JSON.stringify(mn)}`];
        if (errN) entree.pile = errN.stack;
      }
      if (errA && errN) { const e = new Error(ma); e.attendue = true; throw e; }
      if (errN) throw errN;
      const e = new Error(`[écart] l'ancien code échoue (${ma}), le nouveau non`); e.ecart = true; throw e;
    }
    const d = differences(normaliser(ancien), normaliser(nouveau));
    if (d.length) entree.ecart = d;
    return nouveau;
  }

  // Appel qui DOIT échouer pareil des deux côtés (règle métier qui refuse).
  async function refuse(canal, ...args) {
    try { await appeler(canal, ...args); } catch (e) { if (e.attendue) return e.message; throw e; }
    const e = new Error(`${canal} devait être refusé`); throw e;
  }

  async function fermer() {
    try { ancienDbModule.closeDatabase(); } catch (_) { /* déjà fermée */ }
    await nouveauDb.fermer();
    if (!process.env.GARDER_BASE_TEST) {
      const a = new pg.Client({ connectionString: URL_ADMIN });
      await a.connect(); await a.query(`DROP DATABASE IF EXISTS ${nomBase}`); await a.end();
      fs.rmSync(travail, { recursive: true, force: true });
    }
  }
  return { appeler, refuse, journal, ancienDb, nouveauDb, fermer, nomBase, urlTest, donneesAncien, donneesNouveau };
}

module.exports = { creerMondes, normaliser, differences };
