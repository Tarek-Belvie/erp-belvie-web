#!/usr/bin/env node
// ============================================================================
// MIGRATION SQLite (local Electron) -> PostgreSQL (Supabase)   [version 3]
//
// TROIS PHASES SEPAREES, jamais enchainees automatiquement :
//   --phase=precheck    lecture seule, produit un fichier de reference
//   --phase=migration   ECRIT dans PostgreSQL
//   --phase=postcheck   controles + recalage des sequences
//
// --db=<chemin> est OBLIGATOIRE pour LES TROIS phases. Aucune base n'est
// trouvee automatiquement.
//
// --reference=<chemin> est OBLIGATOIRE pour migration et postcheck. Aucune
// selection automatique du "dernier" fichier : la liaison est explicite.
//
// CHAINE DE CONFIANCE (v2) — migration et postcheck refusent de demarrer si :
//   1. --reference n'est pas fourni, ou le fichier est illisible ;
//   2. l'empreinte interne du fichier de reference ne correspond pas a son
//      contenu (fichier modifie a la main apres le precheck) ;
//   3. migration_autorisee !== true ;
//   4. SHA-256(base --db) !== SHA-256 enregistre par le precheck.
//
// AUCUNE CONVERSION SILENCIEUSE : convertir() ne repare rien. Toute valeur
// SQLite incompatible avec le type PostgreSQL est detectee au precheck, y
// rend la migration interdite, et leve si elle atteint malgre tout l'import.
//
// PERIMETRE : les 22 tables de server/db/schema.sql, et elles seules.
// public.profils et auth.users ne sont JAMAIS touchees.
// ============================================================================

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");

require("../lib/env").chargerEnv();

const Database = require("better-sqlite3");
const { Pool } = require("pg");

// 3 : agregats.max_id est desormais calcule AVEC les filtres d'exclusion, et
// la reference porte fichiers_auxiliaires (garde-fou WAL). Une reference
// produite par la v2 contient des max_id NON filtres : la comparaison du
// recalage transactionnel echouerait. Ce format est donc incompatible et le
// numero doit imposer un nouveau precheck.
const VERSION_REFERENCE = 3;

// ---------------------------------------------------------------------------
// PERIMETRE — l'ordre du tableau EST l'ordre d'insertion (audit section 2).
// ---------------------------------------------------------------------------
const PALIERS = [
  ["listes_valeurs", "entreprise", "parametres", "etapes", "compteurs", "compteurs_bc_pf", "grilles_tailles", "declinaison_types"],
  ["grilles_tailles_valeurs", "declinaison_valeurs", "articles"],
  ["article_photos", "article_declinaison_types", "article_declinaison_valeurs", "article_variantes", "planning_articles"],
  ["article_variante_valeurs"],
  ["commandes"],
  ["commande_lignes", "historique_transitions", "bc_pf"],
  ["bc_pf_lignes"],
];
const TABLES = PALIERS.flat();

const TABLES_SERIAL = [
  "listes_valeurs", "grilles_tailles", "grilles_tailles_valeurs", "declinaison_types",
  "declinaison_valeurs", "articles", "article_photos", "article_declinaison_types",
  "article_declinaison_valeurs", "article_variantes", "article_variante_valeurs",
  "planning_articles", "etapes", "commandes", "commande_lignes",
  "historique_transitions", "bc_pf", "bc_pf_lignes",
];

const ORDRE_INTERNE = { bc_pf: "ORDER BY id ASC" };

const DEMO_LISTES = {
  produit: ["T-shirt Essentiel", "Robe Aya", "Veste Denim", "Chemise Lin", "Pantalon Nara", "Blouse Soie"],
  couleur: ["Blanc", "Noir", "Ecru", "Terracotta", "Bleu indigo", "Kaki"],
  responsable: ["Sami", "Nour", "Amine", "Hela", "Youssef"],
  atelier: ["Atelier interne Belvie", "Atelier Mme Ibtissem", "Atelier externe X"],
  operateur: ["Amal", "Karim"],
};

const INTERDIT = ["profils", "users", "auth.users", "public.profils", "auth_users"];

// ---------------------------------------------------------------------------
// Journalisation
// ---------------------------------------------------------------------------
let fluxJournal = null;
function dossierJournaux() {
  const d = path.join(__dirname, "journaux");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function ouvrirJournal(phase) {
  const chemin = path.join(dossierJournaux(), `${phase}-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  fluxJournal = fs.createWriteStream(chemin, { flags: "a" });
  return chemin;
}
function log(...args) {
  const ligne = `[${new Date().toISOString()}] ${args.join(" ")}`;
  console.log(ligne);
  if (fluxJournal) fluxJournal.write(ligne + "\n");
}
function titre(t) {
  log("");
  log("=".repeat(74));
  log(t);
  log("=".repeat(74));
}

// ---------------------------------------------------------------------------
// Garde-fou de perimetre
// ---------------------------------------------------------------------------
function assertPerimetreSur() {
  const fautes = TABLES.filter((t) => INTERDIT.includes(t.toLowerCase()));
  if (fautes.length) throw new Error(`PERIMETRE VIOLE : ${fautes.join(", ")} ne doivent jamais etre touchees.`);
  if (TABLES.length !== 22) throw new Error(`PERIMETRE VIOLE : ${TABLES.length} tables au lieu de 22.`);
  const doublons = TABLES.filter((t, i) => TABLES.indexOf(t) !== i);
  if (doublons.length) throw new Error(`PERIMETRE VIOLE : table dupliquee (${doublons.join(", ")}).`);
  if (TABLES_SERIAL.length !== 18) throw new Error(`PERIMETRE VIOLE : ${TABLES_SERIAL.length} sequences au lieu de 18.`);
  const hors = TABLES_SERIAL.filter((t) => !TABLES.includes(t));
  if (hors.length) throw new Error(`PERIMETRE VIOLE : sequence hors perimetre (${hors.join(", ")}).`);
}

// ---------------------------------------------------------------------------
// Arguments / base source
// ---------------------------------------------------------------------------
function lireArgs() {
  const out = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z0-9-]+)(?:=(.*))?$/i);
    if (m) out[m[1]] = m[2] === undefined ? true : m[2];
  }
  return out;
}

function emplacementsCandidats() {
  const appdata = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return [
    path.join(appdata, "Belvie ERP", "belvie.db"),
    path.join(appdata, "belvie-erp", "belvie.db"),
    path.join(appdata, "Electron", "belvie.db"),
    path.join(os.homedir(), "Library", "Application Support", "Belvie ERP", "belvie.db"),
    path.join(os.homedir(), ".config", "Belvie ERP", "belvie.db"),
  ];
}

function exigerDb(args, phase) {
  if (!args.db || args.db === true) {
    console.log(`\n--db=<chemin> est OBLIGATOIRE (phase ${phase}). Aucune base n'est choisie automatiquement.\n`);
    console.log("electron/db/index.js::getDbPath() = path.join(app.getPath('userData'), 'belvie.db')");
    console.log("Emplacements possibles selon l'installation :\n");
    for (const c of emplacementsCandidats()) console.log(`  ${fs.existsSync(c) ? "[TROUVE]  " : "[absent]  "}${c}`);
    console.log("\nRelancez avec --db=\"<le bon chemin>\".\n");
    process.exit(2);
  }
  const chemin = path.resolve(String(args.db));
  if (!fs.existsSync(chemin)) throw new Error(`Base SQLite introuvable : ${chemin}`);
  return chemin;
}

function empreinteFichier(chemin) {
  const st = fs.statSync(chemin);
  const sha = crypto.createHash("sha256").update(fs.readFileSync(chemin)).digest("hex");
  return { chemin, sha, taille: st.size, mtime: st.mtime.toISOString() };
}

// ---------------------------------------------------------------------------
// GARDE-FOU WAL — le SHA ne porte que sur <db>. Si <db>-wal contient des pages
// non encore integrees, SQLite lit des donnees que ce SHA ne couvre PAS : la
// reference porterait alors sur un etat different de celui reellement lu.
// Aucun fichier de reference ne doit exister dans ce cas.
// ---------------------------------------------------------------------------
function etatFichiersSqlite(chemin) {
  const aux = {};
  for (const suf of ["-wal", "-shm", "-journal"]) {
    const f = chemin + suf;
    aux[suf] = fs.existsSync(f) ? fs.statSync(f).size : null;
  }
  // Etat SEMANTIQUE : seule compte la presence de donnees non integrees.
  // "-wal absent" et "-wal de 0 octet" sont deux representations du MEME etat
  // (rien en attente). Ouvrir la base en lecture seule suffit a faire passer
  // SQLite de l'un a l'autre : ce n'est pas une modification des donnees.
  // Un -wal de taille > 0 reste, lui, un etat radicalement different.
  aux.donnees_en_attente = (aux["-wal"] !== null && aux["-wal"] > 0)
                        || (aux["-journal"] !== null && aux["-journal"] > 0);
  return aux;
}

function exigerEtatFige(chemin) {
  const aux = etatFichiersSqlite(chemin);
  titre("0. ETAT SQLITE FIGE   [CRITIQUE]");
  for (const [suf, taille] of Object.entries(aux)) {
    log(`${path.basename(chemin)}${suf.padEnd(9)} ${taille === null ? "absent" : `${taille} octet(s)`}`);
  }

  const problemes = [];
  if (aux["-wal"] !== null && aux["-wal"] > 0)
    problemes.push(`${path.basename(chemin)}-wal contient ${aux["-wal"]} octets non integres au fichier principal`);
  if (aux["-journal"] !== null && aux["-journal"] > 0)
    problemes.push(`${path.basename(chemin)}-journal non vide : transaction en cours ou interrompue`);
  // -shm seul n'est PAS bloquant : il ne contient aucune donnee (tout reside
  // dans -wal). Il subsiste couramment apres une ouverture en lecture seule.
  if (aux["-shm"] !== null && aux["-wal"] === null)
    log(`NOTE    ${path.basename(chemin)}-shm present sans -wal : residu d'ouverture, sans donnee. Non bloquant.`);

  if (problemes.length) {
    log("");
    problemes.forEach((p) => log(`BLOQUE  ${p}`));
    log("");
    log("Le SHA-256 ne porte que sur le fichier principal. Tant qu'un WAL non vide");
    log("existe, SQLite lirait des donnees absentes de ce SHA : la reference ne");
    log("representerait pas l'etat reellement migre. Aucun fichier reference-*.json");
    log("n'est produit.");
    log("");
    log("Trois issues, par ordre de simplicite :");
    log("  1. Fermez completement l'application Electron. Une fermeture propre");
    log("     effectue un checkpoint et supprime -wal et -shm. Relancez ensuite.");
    log("  2. Checkpoint explicite, application fermee :");
    log("        sqlite3 \"<db>\" \"PRAGMA wal_checkpoint(TRUNCATE);\"");
    log("  3. Snapshot coherent incluant le WAL, puis precheck sur la copie :");
    log("        sqlite3 \"<db>\" \"VACUUM INTO 'C:\\\\travail\\\\belvie-snapshot.db';\"");
    log("     (--db pointera alors sur belvie-snapshot.db, qui n'a jamais de WAL)");
    throw new Error("Etat SQLite non fige (WAL/journal actif). Arret avant toute production de reference.");
  }
  log("");
  log("OK — aucun WAL ni journal actif. Le SHA-256 couvre bien l'integralite des donnees lisibles.");
  return aux;
}

function afficherSource(src) {
  titre("BASE SQLITE SOURCE");
  log(`Chemin   : ${src.chemin}`);
  log(`Taille   : ${(src.taille / 1048576).toFixed(2)} Mo (${src.taille} octets)`);
  log(`Modifiee : ${src.mtime}`);
  log(`SHA-256  : ${src.sha}`);
}

function poolPg() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL absente. Renseignez-la dans .env (jamais dans ce fichier).");
  return new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
}

function confirmer(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(question, (rep) => { rl.close(); r(rep.trim()); }));
}

// ---------------------------------------------------------------------------
// Fichier de reference — empreinte interne (tamper-evidence).
// Detecte une modification a la main du JSON apres le precheck. Ce n'est pas
// un dispositif de securite (la cle est publique et locale) : c'est un
// detecteur d'incoherence, exactement comme une somme de controle.
// ---------------------------------------------------------------------------
function calculerEmpreinteReference(ref) {
  const copie = { ...ref };
  delete copie.empreinte;
  return crypto.createHash("sha256").update(JSON.stringify(copie)).digest("hex");
}

function chargerReference(args, phase) {
  if (!args.reference || args.reference === true) {
    const d = dossierJournaux();
    const dispo = fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith("reference-")).sort() : [];
    console.log(`\n--reference=<chemin> est OBLIGATOIRE (phase ${phase}). Aucun fichier n'est choisi automatiquement.\n`);
    if (dispo.length) {
      console.log("Fichiers de reference presents :\n");
      for (const f of dispo) console.log(`  ${path.join(d, f)}`);
    } else {
      console.log("Aucun fichier reference-*.json. Executez d'abord --phase=precheck.");
    }
    console.log("");
    process.exit(2);
  }
  const chemin = path.resolve(String(args.reference));
  if (!fs.existsSync(chemin)) throw new Error(`Fichier de reference introuvable : ${chemin}`);

  let ref;
  try { ref = JSON.parse(fs.readFileSync(chemin, "utf8")); }
  catch (e) { throw new Error(`Fichier de reference illisible : ${e.message}`); }

  if (ref.version !== VERSION_REFERENCE)
    throw new Error(`Reference version ${ref.version}, attendu ${VERSION_REFERENCE}. Relancez le precheck.`);

  const attendue = calculerEmpreinteReference(ref);
  if (ref.empreinte !== attendue)
    throw new Error(
      `EMPREINTE DE REFERENCE INVALIDE.\n` +
      `  fichier   : ${chemin}\n` +
      `  attendue  : ${attendue}\n` +
      `  trouvee   : ${ref.empreinte}\n` +
      `Le fichier a ete modifie apres le precheck. Relancez --phase=precheck.`
    );

  return { ref, chemin };
}

// Verrou commun a migration et postcheck : reference + autorisation + SHA base.
function verifierChaineDeConfiance(args, phase) {
  const cheminDb = exigerDb(args, phase);
  const { ref, chemin: cheminRef } = chargerReference(args, phase);
  const src = empreinteFichier(cheminDb);
  afficherSource(src);
  exigerEtatFige(cheminDb);

  titre("CHAINE DE CONFIANCE");
  log(`Reference        : ${cheminRef}`);
  log(`Precheck du      : ${ref.date}`);
  log(`Base du precheck : ${ref.source.chemin}`);
  log(`SHA precheck     : ${ref.source.sha}`);
  log(`SHA base --db    : ${src.sha}`);

  if (src.sha !== ref.source.sha) {
    log("");
    log("La base passee en --db n'est PAS celle qui a ete controlee par ce precheck.");
    if (src.chemin !== ref.source.chemin) log(`Les chemins different aussi : ${src.chemin} vs ${ref.source.chemin}`);
    else log("Meme chemin, contenu different : la base a ete modifiee depuis le precheck.");
    throw new Error("SHA-256 divergent entre --db et le fichier de reference. Arret.");
  }
  log("SHA identique — OK.");

  if (ref.migration_autorisee !== true) {
    log("");
    log("migration_autorisee = false dans le fichier de reference.");
    log("Controles critiques en echec au precheck :");
    for (const c of ref.controles.filter((c) => c.critique && !c.ok)) log(`   - ${c.libelle} : ${c.detail}`);
    throw new Error("Le precheck n'autorise pas la migration. Corrigez puis relancez --phase=precheck.");
  }
  log("migration_autorisee = true — OK.");

  return { cheminDb, ref, src };
}

// ---------------------------------------------------------------------------
// Introspection colonnes SQLite <-> PostgreSQL
// ---------------------------------------------------------------------------
const TYPES_NUM = new Set(["integer", "bigint", "smallint", "real", "double precision", "numeric"]);

async function colonnesCommunes(sqlite, pool, table) {
  const colsSqlite = sqlite.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  const { rows } = await pool.query(
    `SELECT column_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1`, [table]);
  const typesPg = new Map(rows.map((r) => [r.column_name, r.data_type]));
  return {
    communes: colsSqlite.filter((c) => typesPg.has(c)),
    ignorees: colsSqlite.filter((c) => !typesPg.has(c)),
    manquantes: [...typesPg.keys()].filter((c) => !colsSqlite.includes(c)),
    typesPg,
  };
}

// AUCUNE REPARATION. Une valeur incompatible leve — elle aurait du etre
// detectee et corrigee au precheck (controle "typage").
function convertir(valeur, typePg, table, colonne) {
  if (valeur === null || valeur === undefined) return null;
  if (Buffer.isBuffer(valeur)) {
    if (TYPES_NUM.has(typePg)) throw new Error(`${table}.${colonne} : BLOB dans une colonne ${typePg}.`);
    return valeur.toString("utf8");
  }
  if (TYPES_NUM.has(typePg) && typeof valeur !== "number") {
    throw new Error(
      `${table}.${colonne} : valeur ${JSON.stringify(valeur)} (${typeof valeur}) dans une colonne ${typePg}. ` +
      `Aucune conversion automatique n'est appliquee — corrigez la donnee source puis relancez le precheck.`
    );
  }
  return valeur;
}

// ---------------------------------------------------------------------------
// Exclusions (arbitrage 1)
// ---------------------------------------------------------------------------
function construireFiltres(sqlite) {
  const ids = sqlite.prepare("SELECT id FROM commandes WHERE deleted_at IS NOT NULL").all().map((r) => r.id);
  const bcIds = ids.length
    ? sqlite.prepare(`SELECT id FROM bc_pf WHERE commande_id IN (${ids.join(",")})`).all().map((r) => r.id)
    : [];
  const lc = ids.join(","), lb = bcIds.join(",");
  return {
    commandesExclues: ids,
    bcPfExclus: bcIds,
    where: {
      commandes: "WHERE deleted_at IS NULL",
      commande_lignes: ids.length ? `WHERE commande_id NOT IN (${lc})` : "",
      historique_transitions: ids.length ? `WHERE commande_id NOT IN (${lc})` : "",
      bc_pf: ids.length ? `WHERE commande_id NOT IN (${lc})` : "",
      bc_pf_lignes: bcIds.length ? `WHERE bc_pf_id NOT IN (${lb})` : "",
    },
  };
}

// ===========================================================================
// PHASE 1 — PRECHECK
// ===========================================================================
async function precheck(args) {
  const journal = ouvrirJournal("precheck");
  assertPerimetreSur();
  const cheminDb = exigerDb(args, "precheck");
  const src = empreinteFichier(cheminDb);
  afficherSource(src);
  const auxAvant = exigerEtatFige(cheminDb);

  const sqlite = new Database(cheminDb, { readonly: true, fileMustExist: true });
  const pool = poolPg();

  const controles = [];
  const ajouter = (cle, libelle, critique, ok, detail) => {
    controles.push({ cle, libelle, critique, ok, detail });
    log(`${ok ? "OK    " : (critique ? "BLOQUE" : "AVERT ")}  ${libelle}${detail ? ` — ${detail}` : ""}`);
  };

  const ref = { version: VERSION_REFERENCE, phase: "precheck", date: new Date().toISOString(), source: src };

  titre("1. SAUVEGARDE");
  log("Cette phase n'ecrit rien et ouvre SQLite en lecture seule.");
  log("Copiez le fichier ci-dessus avant la phase migration.");
  log("Fermez l'application Electron : un journal WAL actif rendrait le SHA instable.");

  titre("2. PRAGMA foreign_key_check   [CRITIQUE]");
  const fk = sqlite.prepare("PRAGMA foreign_key_check").all();
  ajouter("foreign_key_check", "Integrite referentielle SQLite", true, fk.length === 0,
    fk.length ? `${fk.length} violation(s)` : "aucune violation");
  fk.slice(0, 20).forEach((v) => log(`      ${JSON.stringify(v)}`));

  titre("3. PRAGMA integrity_check   [CRITIQUE]");
  const ic = sqlite.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check).join("; ");
  ajouter("integrity_check", "Integrite physique SQLite", true, ic === "ok", ic);

  titre("4. COMPTAGES DES 22 TABLES");
  const filtres = construireFiltres(sqlite);
  ref.comptages = {}; ref.comptages_bruts = {};
  for (const t of TABLES) {
    const brut = sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    const w = filtres.where[t] || "";
    const retenu = w ? sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t} ${w}`).get().n : brut;
    ref.comptages_bruts[t] = brut; ref.comptages[t] = retenu;
    log(`${t.padEnd(30)} ${String(retenu).padStart(7)}${brut - retenu ? `   (${brut - retenu} exclue(s))` : ""}`);
  }
  log("");
  log(`Commandes exclues (deleted_at NOT NULL) : ${filtres.commandesExclues.length}`);
  log(`BC PF exclus (rattaches a ces commandes) : ${filtres.bcPfExclus.length}`);
  ref.exclusions = { commandes: filtres.commandesExclues, bc_pf: filtres.bcPfExclus };

  titre("5. AGREGATS TEMOINS");
  const w = filtres.where;
  ref.agregats = {
    somme_quantite_totale: sqlite.prepare(`SELECT COALESCE(SUM(quantite_totale),0) AS v FROM commandes ${w.commandes}`).get().v,
    somme_lignes_quantite: sqlite.prepare(`SELECT COALESCE(SUM(quantite),0) AS v FROM commande_lignes ${w.commande_lignes}`).get().v,
    commandes_par_statut: sqlite.prepare(`SELECT statut, COUNT(*) AS n FROM commandes ${w.commandes} GROUP BY statut ORDER BY statut`).all(),
    max_id: {},
  };
  // MAX(id) calcule sur EXACTEMENT le jeu de lignes reellement migre : sans le
  // filtre, une commande deleted_at portant le plus grand id fausserait la
  // comparaison du postcheck et produirait un faux echec.
  for (const t of TABLES_SERIAL) {
    const f = filtres.where[t] || "";
    ref.agregats.max_id[t] = sqlite.prepare(`SELECT COALESCE(MAX(id),0) AS v FROM ${t} ${f}`).get().v;
    if (f) {
      const brut = sqlite.prepare(`SELECT COALESCE(MAX(id),0) AS v FROM ${t}`).get().v;
      if (brut !== ref.agregats.max_id[t]) log(`   ${t} : MAX(id) migre ${ref.agregats.max_id[t]} (brut ${brut}, ecart du au filtre)`);
    }
  }
  log(`Somme commandes.quantite_totale  : ${ref.agregats.somme_quantite_totale}`);
  log(`Somme commande_lignes.quantite   : ${ref.agregats.somme_lignes_quantite}`);
  ref.agregats.commandes_par_statut.forEach((r) => log(`   statut ${String(r.statut).padEnd(20)} ${r.n}`));

  titre("6. TYPAGE SQLITE vs POSTGRESQL   [CRITIQUE]");
  log("SQLite est faiblement type : une colonne INTEGER peut contenir du texte.");
  log("Aucune conversion automatique n'est appliquee — toute anomalie est bloquante.");
  log("");
  const anomalies = [];
  ref.schema = {};
  for (const t of TABLES) {
    const { communes, ignorees, manquantes, typesPg } = await colonnesCommunes(sqlite, pool, t);
    ref.schema[t] = { communes, ignorees, manquantes };
    if (ignorees.length) log(`${t} : colonnes SQLite non migrees (absentes du schema web) -> ${ignorees.join(", ")}`);
    if (manquantes.length) log(`${t} : colonnes PostgreSQL sans equivalent SQLite -> ${manquantes.join(", ")}`);
    for (const c of communes) {
      if (!TYPES_NUM.has(typesPg.get(c))) continue;
      const mauvaises = sqlite.prepare(
        `SELECT rowid AS rid, ${c} AS v, typeof(${c}) AS t FROM ${t}
         WHERE ${c} IS NOT NULL AND typeof(${c}) NOT IN ('integer','real') LIMIT 10`).all();
      const n = sqlite.prepare(
        `SELECT COUNT(*) AS n FROM ${t}
         WHERE ${c} IS NOT NULL AND typeof(${c}) NOT IN ('integer','real')`).get().n;
      if (n > 0) {
        anomalies.push({ table: t, colonne: c, type_pg: typesPg.get(c), n, exemples: mauvaises });
        log(`   ${t}.${c} (${typesPg.get(c)}) : ${n} valeur(s) non numerique(s)`);
        mauvaises.forEach((m) => log(`      rowid=${m.rid} typeof=${m.t} valeur=${JSON.stringify(m.v)}`));
      }
    }
  }
  ref.typage = anomalies;
  ajouter("typage", "Aucune valeur incompatible avec le type PostgreSQL", true, anomalies.length === 0,
    anomalies.length ? `${anomalies.length} colonne(s) concernee(s)` : "aucune anomalie");

  titre("7. DONNEES DE DEMONSTRATION   [CRITIQUE]");
  const nArt = sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE est_demo = 1").get().n;
  const nCmd = sqlite.prepare("SELECT COUNT(*) AS n FROM commandes WHERE est_demo = 1").get().n;

  // Inventaire nominatif : ce script ne supprime RIEN. Il montre exactement ce
  // qui est identifie, pour que la decision de suppression reste manuelle.
  const artDemo = sqlite.prepare(
    `SELECT a.id, a.reference_principale, a.abreviation, a.annee_collection, lv.nom AS produit
     FROM articles a LEFT JOIN listes_valeurs lv ON lv.id = a.produit_id
     WHERE a.est_demo = 1 ORDER BY a.id`).all();
  const cmdDemo = sqlite.prepare(
    `SELECT c.id, c.numero, c.statut, c.quantite_totale, c.date_lancement,
            c.deleted_at, a.reference_principale
     FROM commandes c LEFT JOIN articles a ON a.id = c.article_id
     WHERE c.est_demo = 1 ORDER BY c.id`).all();

  if (artDemo.length) {
    log("");
    log(`ARTICLES est_demo = 1 (${artDemo.length}) :`);
    log(`   ${"id".padStart(5)}  ${"reference".padEnd(22)} ${"produit".padEnd(20)} annee`);
    artDemo.forEach((a) => log(
      `   ${String(a.id).padStart(5)}  ${String(a.reference_principale || "(aucune)").padEnd(22)} ` +
      `${String(a.produit || "-").padEnd(20)} ${a.annee_collection || "-"}`));
  }
  if (cmdDemo.length) {
    log("");
    log(`COMMANDES est_demo = 1 (${cmdDemo.length}) :`);
    log(`   ${"id".padStart(5)}  ${"numero".padEnd(16)} ${"statut".padEnd(18)} ${"qte".padStart(6)}  ${"lancement".padEnd(12)} article`);
    cmdDemo.forEach((c) => log(
      `   ${String(c.id).padStart(5)}  ${String(c.numero || "(brouillon)").padEnd(16)} ` +
      `${String(c.statut).padEnd(18)} ${String(c.quantite_totale).padStart(6)}  ` +
      `${String(c.date_lancement || "-").padEnd(12)} ${c.reference_principale || "-"}` +
      `${c.deleted_at ? "   [deja supprimee]" : ""}`));
    const parStatut = {};
    cmdDemo.forEach((c) => { parStatut[c.statut] = (parStatut[c.statut] || 0) + 1; });
    log(`   Repartition : ${Object.entries(parStatut).map(([k, v]) => `${k}=${v}`).join(", ")}`);
    log("");
    log("   Rappel : system.js supprime les commandes AVANT les articles, en cascade");
    log("   sur commande_lignes, historique_transitions et bc_pf. Verifiez qu'aucune");
    log("   de ces commandes ne porte de donnee que vous souhaitez conserver.");
  }
  ref.demo_detail = { articles: artDemo, commandes: cmdDemo };

  ajouter("demo_articles", "Aucun article de demonstration", true, nArt === 0, `${nArt} ligne(s) est_demo = 1`);
  ajouter("demo_commandes", "Aucune commande de demonstration", true, nCmd === 0, `${nCmd} ligne(s) est_demo = 1`);

  // Acquittement nominatif : --demo-listes-acquittees=12,34,56
  const acquittes = new Set(
    String(args["demo-listes-acquittees"] === true ? "" : (args["demo-listes-acquittees"] || ""))
      .split(",").map((s) => s.trim()).filter(Boolean).map(Number));
  const residus = [];
  for (const [type, noms] of Object.entries(DEMO_LISTES)) {
    for (const nom of noms) {
      const r = sqlite.prepare("SELECT id, nom, actif FROM listes_valeurs WHERE type = ? AND LOWER(nom) = LOWER(?)").get(type, nom);
      if (r && !acquittes.has(r.id)) residus.push({ type, ...r });
    }
  }
  ref.demo = { articles: nArt, commandes: nCmd, residus, acquittes: [...acquittes] };
  if (residus.length) {
    log("");
    log(`LISTES_VALEURS identifiees comme residus de demonstration (${residus.length}) :`);
    log(`   ${"id".padStart(5)}  ${"type".padEnd(14)} ${"nom".padEnd(26)} ${"actif".padStart(5)}  utilisee par`);
    for (const r of residus) {
      // Usage reel : une entree referencee par de VRAIES donnees n'est pas un residu.
      const usages = [];
      const c1 = sqlite.prepare("SELECT COUNT(*) AS n FROM articles WHERE produit_id = ? AND est_demo = 0").get(r.id).n;
      if (c1) usages.push(`${c1} article(s) reel(s)`);
      const c2 = sqlite.prepare("SELECT COUNT(*) AS n FROM commande_lignes WHERE couleur_id = ?").get(r.id).n;
      if (c2) usages.push(`${c2} ligne(s) de commande`);
      const c3 = sqlite.prepare("SELECT COUNT(*) AS n FROM historique_transitions WHERE operateur_id = ?").get(r.id).n;
      if (c3) usages.push(`${c3} transition(s)`);
      r.usages = usages;
      log(`   ${String(r.id).padStart(5)}  ${String(r.type).padEnd(14)} ${String(r.nom).padEnd(26)} ` +
          `${String(r.actif).padStart(5)}  ${usages.length ? usages.join(", ") : "aucun usage detecte"}`);
    }
    log("");
    log("   Une entree \"utilisee par\" des donnees REELLES n'est pas un residu de demo :");
    log("   c'est une vraie valeur de votre catalogue, a acquitter et non a supprimer.");
  }
  if (acquittes.size) log(`   Acquittes explicitement : ${[...acquittes].join(", ")}`);
  ajouter("demo_listes", "Aucun residu de liste de demonstration non acquitte", true, residus.length === 0,
    residus.length ? `${residus.length} entree(s) — voir note ci-dessous` : "aucun residu");
  if (residus.length) {
    log("");
    log("NOTE — ce controle est une HEURISTIQUE PAR NOM, pas une preuve.");
    log("demoData.js cree ces entrees sans marqueur est_demo, et system.js ne les");
    log("supprime pas. Mais certains noms (Blanc, Noir, Kaki) peuvent parfaitement");
    log("etre de vraies couleurs de votre catalogue. Deux issues, aucune automatique :");
    log("  - supprimez dans l'application les entrees reellement issues de la demo ;");
    log("  - pour celles qui sont de VRAIES donnees, relancez le precheck avec");
    log("    --demo-listes-acquittees=<id,id,...> en reprenant les id ci-dessus.");
    log("L'acquittement est nominatif et enregistre dans la reference : pas de --force global.");
  }

  titre("8. OPERATEUR ACTIF   [CRITIQUE]");
  const p = sqlite.prepare("SELECT valeur FROM parametres WHERE cle = 'operateur_actif_id'").get();
  let okOp = false, detailOp;
  if (!p || !p.valeur) { detailOp = "operateur_actif_id absent de parametres"; ref.operateur_actif = null; }
  else {
    const op = sqlite.prepare("SELECT id, nom, type, actif FROM listes_valeurs WHERE id = ?").get(Number(p.valeur));
    ref.operateur_actif = { id: Number(p.valeur), resolu: op || null };
    if (!op) detailOp = `id ${p.valeur} : aucune ligne listes_valeurs (reference morte)`;
    else if (op.type !== "operateur") detailOp = `id ${op.id} de type "${op.type}", attendu "operateur"`;
    else if (!op.actif) detailOp = `id ${op.id} nom "${op.nom}" est inactif`;
    else { okOp = true; detailOp = `id ${op.id} nom "${op.nom}"`; }
  }
  ajouter("operateur_actif", "Operateur actif valide", true, okOp, detailOp);
  if (!okOp) {
    log("");
    log("NOTE — la nature de ce blocage differe des precedents : il ne s'agit pas");
    log("d'une corruption de donnees mais d'une degradation fonctionnelle.");
    log("LancerProductionScreen.tsx calcule canLaunch = !!operateurActif : le lancement");
    log("de production serait bloque apres migration, sans cause visible pour l'utilisateur.");
    log("Corriger avant coute un clic dans Parametres ; corriger apres exige de");
    log("diagnostiquer un symptome opaque. Il est donc classe bloquant.");
    log("Cas frequent : le nettoyage des listes de demonstration supprime l'operateur");
    log("\"Amal\", qui etait l'operateur actif par defaut — pensez a en reassigner un.");
  }

  // -------------------------------------------------------------------------
  titre("SYNTHESE DES CONTROLES");
  const critiquesKO = controles.filter((c) => c.critique && !c.ok);
  ref.controles = controles;
  ref.migration_autorisee = critiquesKO.length === 0;
  for (const c of controles) log(`${(c.ok ? "OK" : c.critique ? "BLOQUE" : "AVERT").padEnd(7)} ${c.cle.padEnd(20)} ${c.libelle}`);
  log("");
  log(`migration_autorisee = ${ref.migration_autorisee}`);

  // Revérification : la base n'a pas bougé pendant la session de lecture.
  // Detecte une application Electron restee ouverte qui aurait ecrit entre-temps.
  titre("STABILITE DE LA SOURCE PENDANT LA LECTURE");
  const apres = empreinteFichier(cheminDb);
  const auxApres = etatFichiersSqlite(cheminDb);
  log(`SHA avant lecture : ${src.sha}`);
  log(`SHA apres lecture : ${apres.sha}`);
  if (apres.sha !== src.sha) {
    log("");
    log("La base a ete MODIFIEE pendant le precheck. L'application Electron est");
    log("probablement encore ouverte. Aucun fichier de reference n'est produit.");
    await pool.end(); sqlite.close();
    throw new Error("Base source modifiee pendant la lecture. Fermez l'application et relancez.");
  }
  const fmt = (v) => (v === null ? "absent" : `${v} o`);
  log(`WAL avant / apres : ${fmt(auxAvant["-wal"])} / ${fmt(auxApres["-wal"])}`);
  log(`SHM avant / apres : ${fmt(auxAvant["-shm"])} / ${fmt(auxApres["-shm"])}`);
  // Le passage "absent -> 0 octet" est provoque par NOTRE PROPRE ouverture en
  // lecture seule : SQLite materialise -wal et -shm des qu'il ouvre une base en
  // mode WAL, meme sans ecrire une seule page. Ce n'est pas une modification
  // des donnees, et le SHA-256 du fichier principal ci-dessus le confirme.
  // Seule l'apparition de DONNEES en attente est anormale.
  if (auxApres.donnees_en_attente && !auxAvant.donnees_en_attente) {
    log("");
    log("Des donnees non integrees sont apparues dans le WAL pendant la lecture :");
    log("un autre processus ecrit dans la base. Aucune reference n'est produite.");
    await pool.end(); sqlite.close();
    throw new Error("Ecriture concurrente detectee pendant la lecture. Fermez l'application et relancez.");
  }
  log("OK — SHA identique et aucune donnee en attente apparue. Source figee.");
  log("Rappel : le verrou reste entier pour un WAL contenant reellement des pages.");
  ref.fichiers_auxiliaires = auxApres;

  ref.empreinte = calculerEmpreinteReference(ref);
  const cheminRef = path.join(dossierJournaux(), `reference-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  // Ecrit UNIQUEMENT ici, apres tous les controles de stabilite ci-dessus.
  fs.writeFileSync(cheminRef, JSON.stringify(ref, null, 2));

  titre("PRECHECK TERMINE — AUCUNE ECRITURE");
  log(`Journal   : ${journal}`);
  log(`Reference : ${cheminRef}`);
  log("");
  if (ref.migration_autorisee) {
    log("Phase suivante :");
    log(`  node ${path.relative(process.cwd(), __filename)} --phase=migration \\`);
    log(`       --db="${src.chemin}" --reference="${cheminRef}" --i-have-a-backup`);
  } else {
    log(`${critiquesKO.length} controle(s) critique(s) en echec — la migration est INTERDITE :`);
    critiquesKO.forEach((c) => log(`   - ${c.libelle} : ${c.detail}`));
    log("");
    log("Corrigez, puis relancez le precheck. Ne modifiez jamais le fichier de");
    log("reference a la main : son empreinte interne rendrait la migration impossible.");
    process.exitCode = 1;
  }

  await pool.end(); sqlite.close();
}

// ===========================================================================
// PHASE 2 — MIGRATION
// ===========================================================================
async function migration(args) {
  const journal = ouvrirJournal("migration");
  assertPerimetreSur();

  const { cheminDb, ref } = verifierChaineDeConfiance(args, "migration");
  const sqlite = new Database(cheminDb, { readonly: true });
  const pool = poolPg();

  titre("CONFIRMATION — CETTE PHASE ECRIT REELLEMENT");
  log("Les 22 tables du perimetre metier seront VIDEES puis reimportees.");
  log("public.profils et auth.users ne figurent pas dans la liste et ne seront pas touchees.");
  log("");
  if (!args["i-have-a-backup"]) {
    log("ARRET : relancez avec --i-have-a-backup une fois la copie du .db effectuee.");
    await pool.end(); sqlite.close(); process.exit(3);
  }
  const rep = await confirmer("Tapez exactement MIGRER pour continuer : ");
  if (rep !== "MIGRER") {
    log("Annule par l'utilisateur. Aucune ecriture.");
    await pool.end(); sqlite.close(); process.exit(4);
  }

  const filtres = construireFiltres(sqlite);
  const client = await pool.connect();
  const totaux = {};

  try {
    await client.query("BEGIN");

    titre("REMISE A ZERO — 22 TABLES NOMMEES, SANS CASCADE");
    await client.query(`TRUNCATE ${TABLES.map((t) => `public.${t}`).join(", ")} RESTART IDENTITY`);
    log(`OK — ${TABLES.length} tables videes.`);

    titre("IMPORT PAR PALIERS DE DEPENDANCE");
    for (let i = 0; i < PALIERS.length; i++) {
      log(`--- Palier ${i} ---`);
      for (const t of PALIERS[i]) {
        const { communes, typesPg } = await colonnesCommunes(sqlite, pool, t);
        if (!communes.length) throw new Error(`${t} : aucune colonne commune.`);
        const lignes = sqlite.prepare(
          `SELECT ${communes.join(", ")} FROM ${t} ${filtres.where[t] || ""} ${ORDRE_INTERNE[t] || ""}`).all();

        let inseres = 0;
        const LOT = 400;
        for (let d = 0; d < lignes.length; d += LOT) {
          const lot = lignes.slice(d, d + LOT);
          const params = [];
          const valeurs = lot.map((ligne) => {
            const ph = communes.map((c) => {
              params.push(convertir(ligne[c], typesPg.get(c), t, c));
              return `$${params.length}`;
            });
            return `(${ph.join(", ")})`;
          });
          const r = await client.query(
            `INSERT INTO public.${t} (${communes.join(", ")}) VALUES ${valeurs.join(", ")}`, params);
          inseres += r.rowCount;
        }
        totaux[t] = inseres;
        log(`${t.padEnd(30)} ${String(inseres).padStart(7)} ligne(s)${filtres.where[t] ? "   [filtre applique]" : ""}`);
      }
    }

    // -----------------------------------------------------------------------
    // RECALAGE DES SEQUENCES — DANS la transaction, AVANT le COMMIT.
    //
    // ALTER SEQUENCE ... RESTART WITH, et non setval() : setval() n'est PAS
    // transactionnel (documentation PostgreSQL — ses effets survivent a un
    // ROLLBACK). Utiliser setval ici laisserait les sequences deplacees meme
    // apres annulation de l'import, exactement l'etat incoherent a eviter.
    // ALTER SEQUENCE, lui, est annule avec la transaction.
    // -----------------------------------------------------------------------
    titre("RECALAGE DES 18 SEQUENCES — AVANT COMMIT");
    for (const t of TABLES_SERIAL) {
      const { rows: rSeq } = await client.query(`SELECT pg_get_serial_sequence('public.${t}', 'id') AS seq`);
      const seq = rSeq[0].seq;
      if (!seq) throw new Error(`${t} : aucune sequence associee a la colonne id.`);
      const { rows: rMax } = await client.query(`SELECT COALESCE(MAX(id), 0)::bigint AS m FROM public.${t}`);
      const maxid = Number(rMax[0].m);
      const attendu = Number(ref.agregats.max_id[t]);
      if (maxid !== attendu) throw new Error(`${t} : MAX(id) ${maxid} != MAX(id) source ${attendu} — import incoherent.`);
      const prochain = maxid + 1;
      if (!Number.isSafeInteger(prochain) || prochain < 1) throw new Error(`${t} : prochain id invalide (${prochain}).`);
      await client.query(`ALTER SEQUENCE ${seq} RESTART WITH ${prochain}`);
      log(`${t.padEnd(30)} MAX(id)=${String(maxid).padStart(7)}   prochain=${prochain}`);
    }

    await client.query("COMMIT");
    titre("MIGRATION COMMITEE");
    log(`Total : ${Object.values(totaux).reduce((a, b) => a + b, 0)} lignes sur ${TABLES.length} tables.`);
    log("Les 18 sequences ont ete recalees dans la meme transaction.");
    log("");
    log("La base est immediatement exploitable : une creation depuis l'interface web");
    log("n'entrera pas en collision d'identifiant.");
    log("Lancez neanmoins la phase postcheck avec le MEME --db et le MEME --reference");
    log("pour verifier comptages, agregats, orphelins et unicite.");
    log(`Journal : ${journal}`);
  } catch (err) {
    await client.query("ROLLBACK");
    titre("ECHEC — TRANSACTION ANNULEE");
    log(`Erreur : ${err.message}`);
    if (err.code) log(`Code PostgreSQL : ${err.code}`);
    if (err.detail) log(`Detail : ${err.detail}`);
    log("");
    log("Aucune modification conservee. TRUNCATE, INSERT et ALTER SEQUENCE sont tous");
    log("transactionnels sous PostgreSQL : les 22 tables ont ete RESTAUREES dans");
    log("l'etat exact qui precedait cette tentative, sequences comprises.");
    log("Verifiez-le par un simple comptage avant de relancer.");
    process.exitCode = 1;
  } finally {
    client.release(); await pool.end(); sqlite.close();
  }
}

// ===========================================================================
// PHASE 3 — POSTCHECK
// ===========================================================================
async function postcheck(args) {
  const journal = ouvrirJournal("postcheck");
  assertPerimetreSur();

  const { ref } = verifierChaineDeConfiance(args, "postcheck");
  const pool = poolPg();
  let echecs = 0;
  const ko = (m) => { echecs++; log(`   ECHEC : ${m}`); };

  titre("1. COMPTAGES COMPARES");
  for (const t of TABLES) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.${t}`);
    const attendu = ref.comptages[t], obtenu = rows[0].n, ok = attendu === obtenu;
    log(`${t.padEnd(30)} attendu ${String(attendu).padStart(7)}   obtenu ${String(obtenu).padStart(7)}   ${ok ? "OK" : "ECART"}`);
    if (!ok) echecs++;
  }

  titre("2. AGREGATS COMPARES");
  const cmp = (nom, att, obt) => {
    const ok = Number(att) === Number(obt);
    if (!ok) echecs++;
    log(`${nom.padEnd(34)} attendu ${att}   obtenu ${obt}   ${ok ? "OK" : "ECART"}`);
  };
  const q1 = await pool.query("SELECT COALESCE(SUM(quantite_totale),0)::bigint AS v FROM commandes");
  const q2 = await pool.query("SELECT COALESCE(SUM(quantite),0)::bigint AS v FROM commande_lignes");
  cmp("somme commandes.quantite_totale", ref.agregats.somme_quantite_totale, q1.rows[0].v);
  cmp("somme commande_lignes.quantite", ref.agregats.somme_lignes_quantite, q2.rows[0].v);
  const st = await pool.query("SELECT statut, COUNT(*)::int AS n FROM commandes GROUP BY statut ORDER BY statut");
  const attStatut = new Map(ref.agregats.commandes_par_statut.map((r) => [r.statut, r.n]));
  for (const r of st.rows) cmp(`statut ${r.statut}`, attStatut.get(r.statut) ?? 0, r.n);
  for (const [s, n] of attStatut) if (!st.rows.find((r) => r.statut === s)) cmp(`statut ${s}`, n, 0);

  titre("3. ORPHELINS (toutes les FK du perimetre)");
  const fks = await pool.query(`
    SELECT c.conname, s.relname AS src, a.attname AS col, t.relname AS cible, b.attname AS colcible
    FROM pg_constraint c
    JOIN pg_class s ON s.oid = c.conrelid
    JOIN pg_class t ON t.oid = c.confrelid
    JOIN pg_attribute a ON a.attrelid = c.conrelid  AND a.attnum = c.conkey[1]
    JOIN pg_attribute b ON b.attrelid = c.confrelid AND b.attnum = c.confkey[1]
    WHERE c.contype = 'f' AND s.relname = ANY($1) AND array_length(c.conkey,1) = 1
    ORDER BY s.relname, c.conname`, [TABLES]);
  for (const f of fks.rows) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM public.${f.src} s
       LEFT JOIN public.${f.cible} t ON t.${f.colcible} = s.${f.col}
       WHERE s.${f.col} IS NOT NULL AND t.${f.colcible} IS NULL`);
    if (rows[0].n) ko(`${f.src}.${f.col} -> ${f.cible} : ${rows[0].n} orphelin(s)`);
  }
  log(`${fks.rows.length} contrainte(s) verifiee(s).`);

  titre("4. UNICITE");
  const uniques = [
    ["articles", "uuid"], ["articles", "reference_principale"], ["commandes", "uuid"],
    ["commandes", "numero"], ["bc_pf", "uuid"], ["bc_pf", "numero"], ["planning_articles", "uuid"],
    ["etapes", "cle"], ["declinaison_types", "code"], ["declinaison_types", "nom_normalise"],
  ];
  for (const [t, c] of uniques) {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS n FROM (SELECT ${c} FROM public.${t} WHERE ${c} IS NOT NULL GROUP BY ${c} HAVING COUNT(*) > 1) x`);
    if (rows[0].n) ko(`${t}.${c} : ${rows[0].n} doublon(s)`);
  }
  const lv = await pool.query(
    "SELECT COUNT(*)::int AS n FROM (SELECT type, nom_normalise FROM listes_valeurs GROUP BY 1,2 HAVING COUNT(*) > 1) x");
  if (lv.rows[0].n) ko(`listes_valeurs(type, nom_normalise) : ${lv.rows[0].n} doublon(s)`);
  log(`${uniques.length + 1} controle(s) d'unicite executes.`);

  titre("5. SEQUENCES SERIAL — VERIFICATION (lecture seule)");
  log("Le recalage a eu lieu dans la transaction de migration. Ce controle verifie,");
  log("il ne repare pas. nextval() n'est jamais appele ici : il consommerait une");
  log("valeur et creerait un trou dans la numerotation a chaque postcheck.");
  log("");
  const aReparer = [];
  for (const t of TABLES_SERIAL) {
    const { rows: rSeq } = await pool.query(`SELECT pg_get_serial_sequence('public.${t}', 'id') AS seq`);
    const seq = rSeq[0].seq;
    if (!seq) { ko(`${t} : aucune sequence associee.`); continue; }
    const { rows } = await pool.query(
      `SELECT (SELECT COALESCE(MAX(id), 0) FROM public.${t})::bigint AS maxid,
              s.last_value::bigint AS last_value, s.is_called
       FROM ${seq} s`);
    const maxid = Number(rows[0].maxid);
    const prochain = rows[0].is_called ? Number(rows[0].last_value) + 1 : Number(rows[0].last_value);
    const attenduMax = Number(ref.agregats.max_id[t]);
    let etat = "OK";
    if (maxid !== attenduMax) { ko(`${t} : MAX(id) ${maxid} != MAX(id) source ${attenduMax}`); etat = "ECART"; }
    if (prochain <= maxid) { ko(`${t} : prochain id ${prochain} <= MAX(id) ${maxid} — collision garantie`); aReparer.push({ t, prochain: maxid + 1 }); etat = "COLLISION"; }
    log(`${t.padEnd(30)} MAX(id)=${String(maxid).padStart(7)}   prochain=${String(prochain).padStart(7)}   ${etat}`);
  }

  titre("6. REPARATION DES SEQUENCES (optionnelle)");
  if (!aReparer.length) log("Rien a reparer — toutes les sequences sont au-dela de leur MAX(id).");
  else if (!args["reparer-sequences"]) {
    log(`${aReparer.length} sequence(s) en collision. Aucune reparation automatique.`);
    log("Relancez avec --reparer-sequences pour les corriger, apres avoir compris");
    log("pourquoi le recalage de la phase migration n'a pas tenu.");
  } else {
    for (const { t, prochain } of aReparer) {
      const { rows } = await pool.query(`SELECT pg_get_serial_sequence('public.${t}', 'id') AS seq`);
      await pool.query(`ALTER SEQUENCE ${rows[0].seq} RESTART WITH ${prochain}`);
      log(`${t.padEnd(30)} recalee a ${prochain}`);
    }
  }

  titre("7. COMPTEURS DE NUMEROTATION");
  for (const t of ["compteurs", "compteurs_bc_pf"]) {
    const { rows } = await pool.query(`SELECT annee, dernier_numero FROM public.${t} ORDER BY annee`);
    if (!rows.length) ko(`${t} : VIDE — la numerotation repartirait de zero.`);
    rows.forEach((r) => log(`${t} : annee ${r.annee} -> dernier numero ${r.dernier_numero}`));
  }
  const coll = await pool.query(`
    SELECT c.annee, c.dernier_numero, COUNT(cm.id)::int AS numerotees
    FROM compteurs c LEFT JOIN commandes cm ON cm.numero LIKE '%' || c.annee::text || '%'
    GROUP BY c.annee, c.dernier_numero ORDER BY c.annee`);
  coll.rows.forEach((r) => {
    if (r.numerotees > r.dernier_numero)
      ko(`compteurs ${r.annee} : ${r.numerotees} commandes numerotees > dernier_numero ${r.dernier_numero}`);
  });

  titre("8. OPERATEUR ACTIF (cible PostgreSQL)");
  const op = await pool.query(`
    SELECT p.valeur, lv.id, lv.nom, lv.type, lv.actif
    FROM parametres p
    LEFT JOIN listes_valeurs lv ON lv.id = NULLIF(p.valeur, '')::integer
    WHERE p.cle = 'operateur_actif_id'`);
  if (!op.rows.length) ko("operateur_actif_id absent — lancement de production bloque.");
  else {
    const r = op.rows[0];
    if (!r.id) ko(`operateur_actif_id = ${r.valeur} : aucune ligne listes_valeurs.`);
    else if (r.type !== "operateur") ko(`id=${r.id} type=${r.type}, attendu 'operateur'.`);
    else if (!r.actif) ko(`id=${r.id} nom="${r.nom}" est inactif.`);
    else log(`OK — id=${r.id} nom="${r.nom}"`);
  }

  titre("9. PERIMETRE PRESERVE");
  for (const t of ["profils"]) {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM public.${t}`);
    log(`public.${t} : ${rows[0].n} ligne(s) — table hors perimetre, jamais touchee par ce script.`);
    if (rows[0].n === 0) ko(`public.${t} est vide : verifiez immediatement votre acces administrateur.`);
  }

  titre(echecs === 0 ? "POSTCHECK : TOUS LES CONTROLES PASSES" : `POSTCHECK : ${echecs} ECHEC(S)`);
  log(`Journal : ${journal}`);
  if (echecs) log("Ne creez rien depuis l'interface web tant que ces points ne sont pas resolus.");
  process.exitCode = echecs ? 1 : 0;
  await pool.end();
}

// ===========================================================================
async function main() {
  const args = lireArgs();
  const phases = { precheck, migration, postcheck };
  if (!args.phase || !phases[args.phase]) {
    console.log("\nUsage : --phase=precheck|migration|postcheck --db=<chemin> [--reference=<chemin>]\n");
    console.log("  precheck   --db obligatoire. Lecture seule. Produit reference-*.json.");
    console.log("             option --demo-listes-acquittees=<id,id,...>");
    console.log("  migration  --db + --reference + --i-have-a-backup obligatoires, puis saisie de MIGRER.");
    console.log("  postcheck  --db + --reference obligatoires. Verifie les 18 sequences.");
    console.log("             option --reparer-sequences (ne repare que si collision detectee)\n");
    process.exit(2);
  }
  await phases[args.phase](args);
}

main().catch((err) => {
  log(`ERREUR FATALE : ${err.message}`);
  process.exit(1);
});
