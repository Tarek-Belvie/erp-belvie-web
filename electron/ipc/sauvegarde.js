// ================================================================================================
// SAUVEGARDE ET RESTAURATION — lot 2
// ================================================================================================
//
// Ce module remplace la sauvegarde précédente, qui ne copiait qu'un seul dossier d'images sur
// cinq (electron/ipc/system.js, copyImagesDirIfPresent). Sur les données réelles mesurées au
// lot 0, cela représentait 93 images — croquis techniques et logo compris — qu'une restauration
// n'aurait pas rendues.
//
// TROIS PRINCIPES, dont tout le reste découle :
//
//   1. On sauvegarde TOUT le dossier de données, sauf `backups`. Énumérer les sous-dossiers
//      connus était précisément le défaut à corriger : il suffisait qu'un sixième apparaisse pour
//      que l'oubli recommence. Ici, un dossier ajouté demain est couvert sans rien changer.
//
//   2. Toute sauvegarde porte un MANIFESTE : ce qu'elle contient, combien, et l'empreinte de
//      chaque fichier. Une sauvegarde sans manifeste ne peut pas être vérifiée, donc on ne sait
//      pas si elle est exploitable — et on ne le découvre que le jour où l'on en a besoin.
//
//   3. RIEN N'EST JAMAIS SUPPRIMÉ. La restauration DÉPLACE les données actuelles dans un dossier
//      horodaté au lieu de les écraser ; les sauvegardes complètes ne sont jamais purgées.
//
// Ce module ne dépend PAS d'Electron : il reçoit les chemins en argument. C'est ce qui permet de
// l'éprouver en entier, hors application, sur de vraies arborescences.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FORMAT_MANIFESTE = 1;
const NOM_MANIFESTE = "manifeste.json";
const NOM_BASE = "belvie.db";

/**
 * Ce qui n'est jamais copié dans une sauvegarde — au premier niveau du dossier de données, et
 * toujours comparé en minuscules.
 *
 * `backups` d'abord : sans cette exclusion, chaque sauvegarde contiendrait les précédentes et la
 * taille doublerait à chaque fois.
 *
 * Puis les dossiers de travail de Chromium. Ils sont entièrement REGÉNÉRÉS au démarrage, ils
 * pèsent des dizaines de méga-octets, et surtout : Windows en garde certains VERROUILLÉS tant que
 * l'application tourne. Les copier faisait courir un risque réel — une sauvegarde qui échoue
 * parce qu'un fichier de cache est verrouillé — et depuis le lot 2 ce risque remonte plus haut
 * encore, puisqu'une sauvegarde d'avant-migration qui échoue empêche le démarrage.
 * L'interface n'utilise ni localStorage ni IndexedDB : rien de ce qui vous appartient ne vit là.
 *
 * Enfin la marque d'instance du lot 1 : la copier reviendrait à planter dans une sauvegarde le
 * numéro de processus d'un ordinateur, qui n'aurait aucun sens une fois restauré ailleurs.
 */
const EXCLUS = [
  "backups",
  // Chromium — regénérés à chaque démarrage, parfois verrouillés par Windows
  "cache", "code cache", "gpucache", "dawncache", "dawngraphitecache", "dawnwebgpucache",
  "grshadercache", "shadercache", "blob_storage", "crashpad", "logs", "component_crx_cache",
  "network", "service worker", "shared dictionary", "partitions",
  "singletonlock", "singletoncookie", "singletonsocket",
  // Lot 1 — propre à l'ordinateur et à l'instant, jamais à sauvegarder
  "instance-ouverte.json",
];

/** Les fichiers annexes du journal SQLite. Ils ne sont jamais copiés : le checkpoint les a
 *  rapatriés dans le fichier principal avant la copie, et les emporter ferait croire à une
 *  transaction en cours au moment de la restauration. */
const ANNEXES_SQLITE = ["-wal", "-shm", "-journal"];

// ------------------------------------------------------------------------------------------------
// Les colonnes de la base qui citent un fichier
// ------------------------------------------------------------------------------------------------
// La même liste que le diagnostic du lot 0, et pour la même raison : c'est elle qui permet de
// répondre à « chaque image citée par la base est-elle bien là ? ». Un fichier présent sur le
// disque mais cité par personne est sans gravité ; l'inverse casse une fiche technique.
const COLONNES_IMAGES = [
  { table: "article_photos", colonne: "photo_path" },
  { table: "article_photos", colonne: "photo_thumb_path" },
  { table: "planning_articles", colonne: "photo_path" },
  { table: "planning_articles", colonne: "photo_thumb_path" },
  { table: "ft_croquis", colonne: "image_path" },
  { table: "ft_accessoires", colonne: "photo_path" },
  { table: "entreprise", colonne: "logo_path" },
  { table: "bc_pf", colonne: "photo_snapshot_path" },
  { table: "bc_pf", colonne: "entreprise_logo_snapshot_path" },
];

const TABLES_COMPTEES = [
  "commandes", "commande_lignes", "articles", "article_photos", "planning_articles",
  "fiches_techniques", "ft_matieres", "ft_accessoires", "ft_croquis",
  "ft_matiere_couleurs", "ft_fourniture_couleurs", "ft_mesures_valeurs",
  "matieres_catalogue", "accessoires_catalogue", "matiere_couleurs",
  "fournisseurs", "achats", "achats_affectations", "achats_factures", "achats_receptions",
  "paiements", "prix_fournisseurs", "estimations",
  "bc_pf", "bc_mp", "bc_mp_lignes", "bc_mp_ligne_productions",
  "listes_valeurs", "parametres", "entreprise",
];

// ------------------------------------------------------------------------------------------------
// Utilitaires
// ------------------------------------------------------------------------------------------------
function horodatage(date) {
  return (date || new Date()).toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

function sha256(fichier) {
  const h = crypto.createHash("sha256");
  h.update(fs.readFileSync(fichier));
  return h.digest("hex");
}

function versPosix(p) {
  return String(p).split(path.sep).join("/");
}

/** Liste récursive des fichiers d'un dossier, en chemins RELATIFS et séparateurs « / ».
 *  Les chemins relatifs sont indispensables : un manifeste contenant des chemins absolus ne
 *  vaudrait plus rien dès que la sauvegarde change de machine ou de lettre de lecteur. */
function listerFichiers(racine, exclus) {
  const resultat = [];
  const aExclure = new Set((exclus || []).map((e) => e.toLowerCase()));
  if (!fs.existsSync(racine)) return resultat;

  function parcourir(dossier, prefixe) {
    let entrees;
    try { entrees = fs.readdirSync(dossier, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entrees) {
      const relatif = prefixe ? prefixe + "/" + e.name : e.name;
      if (!prefixe && aExclure.has(e.name.toLowerCase())) continue;
      const complet = path.join(dossier, e.name);
      if (e.isDirectory()) { parcourir(complet, relatif); continue; }
      if (e.isSymbolicLink()) continue;
      let st;
      try { st = fs.statSync(complet); } catch (_) { continue; }
      resultat.push({ chemin: relatif, octets: st.size, modifie: st.mtime.toISOString() });
    }
  }
  parcourir(racine, "");
  resultat.sort((a, b) => a.chemin.localeCompare(b.chemin));
  return resultat;
}

function copierArbre(source, destination, exclus) {
  const fichiers = listerFichiers(source, exclus);
  fichiers.forEach((f) => {
    const src = path.join(source, f.chemin.split("/").join(path.sep));
    const dst = path.join(destination, f.chemin.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  });
  return fichiers;
}

// ------------------------------------------------------------------------------------------------
// Lecture de la base
// ------------------------------------------------------------------------------------------------
function tableExiste(db, table) {
  try { return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table); }
  catch (_) { return false; }
}

function colonneExiste(db, table, colonne) {
  try { return db.prepare("PRAGMA table_info(" + table + ")").all().some((c) => c.name === colonne); }
  catch (_) { return false; }
}

function comptages(db) {
  const r = {};
  TABLES_COMPTEES.forEach((t) => {
    if (!tableExiste(db, t)) return;
    try { r[t] = db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n; } catch (_) { /* ignorée */ }
  });
  return r;
}

/** Tous les chemins d'images cités par la base, dédoublonnés. */
function imagesCitees(db) {
  const vus = new Set();
  COLONNES_IMAGES.forEach((c) => {
    if (!tableExiste(db, c.table) || !colonneExiste(db, c.table, c.colonne)) return;
    let rows = [];
    try {
      rows = db.prepare(
        "SELECT " + c.colonne + " AS v FROM " + c.table +
        " WHERE " + c.colonne + " IS NOT NULL AND " + c.colonne + " <> ''"
      ).all();
    } catch (_) { rows = []; }
    rows.forEach((r) => { if (r.v) vus.add(versPosix(r.v)); });
  });
  return Array.from(vus).sort();
}

/**
 * Rapatrie le journal d'écriture DANS le fichier principal, puis copie.
 *
 * Sans le checkpoint, la copie du fichier .db peut être incomplète : les dernières écritures
 * vivent encore dans le fichier -wal, qui n'est pas copié. C'est la même précaution que prend
 * déjà migrationSafety.js avant une migration lourde.
 *
 * `db.backup()` (better-sqlite3) est préféré quand il existe : c'est l'API de sauvegarde à chaud
 * de SQLite, sûre même si une écriture se produit pendant la copie.
 */
async function copierBase(db, cheminBase, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  if (db && typeof db.backup === "function") {
    await db.backup(destination);
    return "api-sqlite";
  }
  if (db && typeof db.exec === "function") {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (_) { /* base en lecture seule */ }
  }
  fs.copyFileSync(cheminBase, destination);
  return "copie-fichier";
}

// ------------------------------------------------------------------------------------------------
// L'inventaire et le manifeste
// ------------------------------------------------------------------------------------------------
/**
 * L'inventaire des images du dossier de données : ce qu'il y a, et ce que la base attend.
 *
 * `empreintes` à faux (le cas de la sauvegarde automatique) : taille et date seulement, donc
 * instantané. À vrai (sauvegarde complète) : une empreinte SHA-256 par fichier, qui permettra
 * plus tard de prouver qu'aucun octet n'a bougé.
 */
function inventorier(db, dossierDonnees, options) {
  const opts = options || {};
  const fichiers = listerFichiers(path.join(dossierDonnees, "images"), []);
  const parDossier = {};
  let octets = 0;

  fichiers.forEach((f) => {
    octets += f.octets;
    // Le groupe est le sous-dossier de premier niveau : images/commandes, images/fiches-techniques…
    const groupe = "images/" + f.chemin.split("/")[0];
    if (!parDossier[groupe]) parDossier[groupe] = { fichiers: 0, octets: 0 };
    parDossier[groupe].fichiers += 1;
    parDossier[groupe].octets += f.octets;
    f.chemin = "images/" + f.chemin;
    if (opts.empreintes) {
      try { f.sha256 = sha256(path.join(dossierDonnees, f.chemin.split("/").join(path.sep))); }
      catch (_) { f.sha256 = null; }
    }
  });

  const citees = db ? imagesCitees(db) : [];
  const presentes = new Set(fichiers.map((f) => f.chemin));
  const manquantes = citees.filter((c) => !presentes.has(c));

  return {
    fichiers,
    par_dossier: parDossier,
    totaux: { fichiers: fichiers.length, octets },
    references: {
      citees: citees.length,
      presentes: citees.length - manquantes.length,
      // Les manquantes sont NOMMÉES, pas seulement comptées : un nombre ne se corrige pas.
      manquantes,
    },
  };
}

function construireManifeste(db, dossierDonnees, options) {
  const opts = options || {};
  const base = path.join(dossierDonnees, NOM_BASE);
  const inv = inventorier(db, dossierDonnees, { empreintes: !!opts.empreintes });

  return {
    format_version: FORMAT_MANIFESTE,
    type: opts.type || "complete",
    motif: opts.motif || null,
    cree_le: new Date().toISOString(),
    application: { nom: "belvie-erp", version: opts.version || null },
    source: { dossier_donnees: dossierDonnees },
    base: {
      fichier: NOM_BASE,
      octets: fs.existsSync(base) ? fs.statSync(base).size : null,
      sha256: null,              // renseigné après la copie, sur le fichier copié
      comptages: db ? comptages(db) : {},
    },
    images: {
      par_dossier: inv.par_dossier,
      totaux: inv.totaux,
      // `fichiers` décrit ce que la sauvegarde CONTIENT : la vérification cherche chacun de ces
      // fichiers DANS le dossier de sauvegarde. Une sauvegarde automatique ne contenant aucune
      // image, cette clé y vaut null — sans quoi la vérification chercherait des fichiers que la
      // sauvegarde n'a jamais promis d'avoir, et la déclarerait défectueuse à tort.
      fichiers: opts.contientImages === false ? null : inv.fichiers,
      // `inventaire_source` décrit ce qui était dans le dossier de DONNÉES à cet instant. C'est
      // ce qui donne sa valeur à la sauvegarde automatique : comparer deux inventaires dit si une
      // image a disparu, sans avoir copié un seul octet.
      inventaire_source: inv.fichiers,
    },
    references_base: inv.references,
    contenu: opts.contenu || "base+images",
  };
}

function ecrireManifeste(dossierSauvegarde, manifeste) {
  fs.mkdirSync(dossierSauvegarde, { recursive: true });
  fs.writeFileSync(path.join(dossierSauvegarde, NOM_MANIFESTE),
    JSON.stringify(manifeste, null, 2), "utf-8");
}

function lireManifeste(dossierSauvegarde) {
  const p = path.join(dossierSauvegarde, NOM_MANIFESTE);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf-8")); } catch (_) { return null; }
}

// ------------------------------------------------------------------------------------------------
// Les sauvegardes
// ------------------------------------------------------------------------------------------------
/**
 * Sauvegarde COMPLÈTE : la base, toutes les images, tout ce que contient le dossier de données
 * sauf `backups`, et le manifeste. C'est celle qu'on emporte sur une clé USB, et celle qu'on fait
 * avant une installation.
 *
 * Elle est VÉRIFIÉE juste après avoir été écrite, et le rapport de vérification part avec elle.
 * Une sauvegarde dont on découvre le défaut au moment de s'en servir n'a servi à rien.
 */
function preparerDestination(dossierDonnees, dossierParent, prefixe) {
  if (!dossierDonnees || !fs.existsSync(dossierDonnees)) {
    throw new Error("Le dossier de données est introuvable : " + dossierDonnees);
  }
  if (!dossierParent) throw new Error("Aucune destination choisie pour la sauvegarde.");
  const destination = path.join(dossierParent, (prefixe || "belvie-sauvegarde") + "-" + horodatage());
  if (fs.existsSync(destination)) throw new Error("Un dossier porte déjà ce nom : " + destination);
  fs.mkdirSync(destination, { recursive: true });
  return destination;
}

/**
 * Tout ce qui suit la copie de la base : les images, les documents, le manifeste, la vérification.
 * Extrait ici pour que la version asynchrone (l'interface) et la version synchrone (le démarrage,
 * avant une migration) partagent EXACTEMENT le même code. Deux copies de cette logique
 * finiraient par ne plus produire les mêmes sauvegardes.
 */
function terminerSauvegarde(db, dossierDonnees, destination, methode, opts) {
  // 2. Tout le reste, sauf `backups` et les annexes du journal SQLite.
  const aExclure = EXCLUS.slice();
  const copies = copierArbre(dossierDonnees, destination, aExclure)
    .filter((f) => f.chemin !== NOM_BASE && !ANNEXES_SQLITE.some((e) => f.chemin.endsWith(e)));

  ANNEXES_SQLITE.forEach((e) => {
    const p = path.join(destination, NOM_BASE + e);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  // 3. Le manifeste, avec l'empreinte de la base RÉELLEMENT copiée.
  const manifeste = construireManifeste(db, dossierDonnees, {
    type: "complete", motif: opts.motif || null, version: opts.version,
    empreintes: true, contenu: "base+images+documents",
  });
  manifeste.base.sha256 = sha256(path.join(destination, NOM_BASE));
  manifeste.base.octets_copies = fs.statSync(path.join(destination, NOM_BASE)).size;
  manifeste.base.methode_copie = methode;
  manifeste.fichiers_copies = copies.length + 1;
  ecrireManifeste(destination, manifeste);

  // 4. Et on la vérifie immédiatement.
  const verification = verifierSauvegarde(destination, { ouvrirBase: opts.ouvrirBase });
  fs.writeFileSync(path.join(destination, "verification.json"),
    JSON.stringify(verification, null, 2), "utf-8");

  return { dossier: destination, manifeste, verification };
}

/** La sauvegarde complète, depuis l'interface : la base est copiée par l'API de sauvegarde à
 *  chaud de SQLite quand elle existe, donc sans gêner une écriture en cours. */
async function sauvegardeComplete(db, dossierDonnees, dossierParent, options) {
  const opts = options || {};
  const destination = preparerDestination(dossierDonnees, dossierParent, opts.prefixe);
  const methode = await copierBase(db, path.join(dossierDonnees, NOM_BASE), path.join(destination, NOM_BASE));
  return terminerSauvegarde(db, dossierDonnees, destination, methode, opts);
}

/**
 * La même sauvegarde, SYNCHRONE : c'est celle du démarrage, avant une migration.
 *
 * Le démarrage de l'application ne peut pas attendre une promesse — la base doit être prête quand
 * openDatabase() rend la main. On se passe donc de l'API asynchrone et on fait ce que fait déjà
 * migrationSafety.js : rapatrier le journal dans le fichier principal, puis copier. À ce moment
 * du démarrage, personne d'autre n'écrit dans la base.
 */
function sauvegardeCompleteSync(db, dossierDonnees, dossierParent, options) {
  const opts = options || {};
  const destination = preparerDestination(dossierDonnees, dossierParent, opts.prefixe);
  if (db && typeof db.exec === "function") {
    try { db.exec("PRAGMA wal_checkpoint(TRUNCATE)"); } catch (_) { /* base en lecture seule */ }
  }
  fs.mkdirSync(path.dirname(path.join(destination, NOM_BASE)), { recursive: true });
  fs.copyFileSync(path.join(dossierDonnees, NOM_BASE), path.join(destination, NOM_BASE));
  return terminerSauvegarde(db, dossierDonnees, destination, "copie-fichier", opts);
}

/**
 * Sauvegarde AUTOMATIQUE, à la fermeture : la base et un INVENTAIRE des images, pas les images.
 *
 * Votre décision n° 1, et le lot 0 en donne la raison chiffrée : copier les 81 Mo d'images à
 * chaque fermeture, en gardant plusieurs copies, occuperait des centaines de méga-octets et
 * ralentirait chaque fermeture. L'inventaire, lui, pèse quelques kilo-octets et répond à la seule
 * question qui se pose au quotidien : est-ce qu'une image a disparu ?
 *
 * Elle ne remplace donc PAS la sauvegarde complète, et le manifeste le dit noir sur blanc.
 */
async function sauvegardeAutomatique(db, dossierDonnees, options) {
  const opts = options || {};
  const garder = opts.garder === undefined ? 10 : opts.garder;
  const racine = path.join(dossierDonnees, "backups", "auto");
  fs.mkdirSync(racine, { recursive: true });

  const destination = path.join(racine, "auto-" + horodatage());
  fs.mkdirSync(destination, { recursive: true });

  const methode = await copierBase(db, path.join(dossierDonnees, NOM_BASE), path.join(destination, NOM_BASE));

  const manifeste = construireManifeste(db, dossierDonnees, {
    type: "automatique", version: opts.version,
    empreintes: false, contientImages: false, contenu: "base+inventaire-images",
  });
  manifeste.base.sha256 = sha256(path.join(destination, NOM_BASE));
  manifeste.base.methode_copie = methode;
  manifeste.avertissement =
    "Cette sauvegarde ne contient PAS les images. Elle sert à retrouver la base ; "
    + "pour une restauration complète, utilisez une sauvegarde complète.";
  ecrireManifeste(destination, manifeste);

  // Rotation — et uniquement sur les sauvegardes AUTOMATIQUES. Les sauvegardes complètes ne sont
  // jamais purgées : c'est votre exigence n° 7, et elle est tenue par le fait que ce code ne
  // regarde que `backups/auto`.
  const supprimees = [];
  if (garder > 0) {
    const entrees = fs.readdirSync(racine, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.indexOf("auto-") === 0)
      .map((e) => e.name).sort();
    const exces = entrees.length - garder;
    for (let i = 0; i < exces; i += 1) {
      fs.rmSync(path.join(racine, entrees[i]), { recursive: true, force: true });
      supprimees.push(entrees[i]);
    }
  }

  return { dossier: destination, manifeste, rotation_supprimees: supprimees };
}

/**
 * La sauvegarde complète OBLIGATOIRE avant une installation ou une migration (exigence n° 3).
 *
 * Elle va dans le dossier externe que vous avez choisi s'il en existe un et qu'il est joignable,
 * sinon dans `backups/avant-<motif>` du dossier de données — avec, dans ce cas, un avertissement
 * explicite : une sauvegarde posée sur le même disque que l'original protège d'une migration
 * ratée, pas d'une panne de disque.
 */
/** Où doit aller la sauvegarde d'avant-opération : l'emplacement externe choisi s'il est
 *  joignable, sinon le dossier de données — et dans ce cas on le dit. */
function resoudreParent(dossierDonnees, motif, externe) {
  if (externe) {
    try {
      fs.mkdirSync(externe, { recursive: true });
      fs.accessSync(externe, fs.constants.W_OK);
      return { parent: externe, surDisqueExterne: true };
    } catch (_) { /* injoignable : on se rabat, sans échouer */ }
  }
  const parent = path.join(dossierDonnees, "backups", "avant-" + (motif || "operation"));
  fs.mkdirSync(parent, { recursive: true });
  return { parent, surDisqueExterne: false };
}

function completerAvantOperation(r, surDisqueExterne) {
  return Object.assign(r, {
    sur_disque_externe: surDisqueExterne,
    avertissement: surDisqueExterne ? null
      : "Cette sauvegarde est sur le même disque que vos données. Elle protège d'une migration "
      + "ratée, pas d'une panne de disque. Copiez-la sur une clé USB ou un disque externe.",
  });
}

/**
 * La sauvegarde complète OBLIGATOIRE avant une installation ou une migration (exigence n° 3).
 *
 * Elle va dans le dossier externe choisi s'il est joignable, sinon dans
 * `backups/avant-<motif>` du dossier de données — avec, dans ce cas, un avertissement explicite :
 * une sauvegarde posée sur le même disque que l'original protège d'une migration ratée, pas d'une
 * panne de disque.
 */
async function sauvegardeAvantOperation(db, dossierDonnees, motif, options) {
  const opts = options || {};
  const { parent, surDisqueExterne } = resoudreParent(dossierDonnees, motif, opts.dossierExterne);
  const reglages = {
    prefixe: "avant-" + (motif || "operation"), motif: motif || "operation",
    version: opts.version, ouvrirBase: opts.ouvrirBase,
  };
  return completerAvantOperation(await sauvegardeComplete(db, dossierDonnees, parent, reglages),
    surDisqueExterne);
}

/** La même, synchrone : c'est celle qu'appelle le démarrage avant d'exécuter une migration. */
function sauvegardeAvantOperationSync(db, dossierDonnees, motif, options) {
  const opts = options || {};
  const { parent, surDisqueExterne } = resoudreParent(dossierDonnees, motif, opts.dossierExterne);
  const reglages = {
    prefixe: "avant-" + (motif || "operation"), motif: motif || "operation",
    version: opts.version, ouvrirBase: opts.ouvrirBase,
  };
  return completerAvantOperation(sauvegardeCompleteSync(db, dossierDonnees, parent, reglages),
    surDisqueExterne);
}

// ------------------------------------------------------------------------------------------------
// La vérification
// ------------------------------------------------------------------------------------------------
/**
 * Une sauvegarde est-elle exploitable ? Sept contrôles, du moins cher au plus parlant.
 *
 * `options.ouvrirBase` est une fonction (chemin) -> base en LECTURE SEULE. Elle est injectée
 * plutôt qu'importée : le module ne doit dépendre ni de better-sqlite3 ni d'Electron, pour rester
 * éprouvable hors application. Sans elle, les trois contrôles qui demandent d'ouvrir la base sont
 * déclarés « non effectués » — jamais « réussis ».
 */
function verifierSauvegarde(dossierSauvegarde, options) {
  const opts = options || {};
  const controles = [];
  const ajouter = (nom, etat, detail) => controles.push({ nom, etat, detail: detail || null });

  if (!fs.existsSync(dossierSauvegarde)) {
    return { ok: false, dossier: dossierSauvegarde, controles: [
      { nom: "Le dossier de sauvegarde existe", etat: "echec", detail: dossierSauvegarde },
    ] };
  }

  // 1. Le manifeste
  const manifeste = lireManifeste(dossierSauvegarde);
  if (!manifeste) {
    ajouter("Le manifeste est présent et lisible", "echec",
      "Sans manifeste, cette sauvegarde ne peut pas être vérifiée. Elle a peut-être été faite par "
      + "une version antérieure de l'application : elle est alors probablement incomplète.");
    return { ok: false, dossier: dossierSauvegarde, manifeste: null, controles };
  }
  ajouter("Le manifeste est présent et lisible", "ok",
    "type « " + manifeste.type + " », créé le " + manifeste.cree_le);

  if (manifeste.format_version > FORMAT_MANIFESTE) {
    ajouter("Le format du manifeste est connu", "echec",
      "Cette sauvegarde vient d'une version plus récente de l'application (format "
      + manifeste.format_version + ", cette version lit jusqu'au " + FORMAT_MANIFESTE + ").");
  } else {
    ajouter("Le format du manifeste est connu", "ok", "format " + manifeste.format_version);
  }

  // 2. La base
  const base = path.join(dossierSauvegarde, NOM_BASE);
  if (!fs.existsSync(base)) {
    ajouter("Le fichier de base est présent", "echec", NOM_BASE + " est absent.");
  } else {
    const octets = fs.statSync(base).size;
    const attendus = manifeste.base && manifeste.base.octets_copies;
    if (attendus != null && attendus !== octets) {
      ajouter("La taille de la base correspond au manifeste", "echec",
        "attendu " + attendus + " octets, trouvé " + octets);
    } else {
      ajouter("La taille de la base correspond au manifeste", "ok", octets + " octets");
    }
    const empreinte = manifeste.base && manifeste.base.sha256;
    if (empreinte) {
      const reelle = sha256(base);
      ajouter("L'empreinte de la base est intacte", reelle === empreinte ? "ok" : "echec",
        reelle === empreinte ? "SHA-256 identique"
          : "le fichier a changé depuis la sauvegarde (attendu " + empreinte.slice(0, 16)
            + "…, trouvé " + reelle.slice(0, 16) + "…)");
    } else {
      ajouter("L'empreinte de la base est intacte", "non-effectue", "aucune empreinte au manifeste");
    }
  }

  // 3. Les contrôles internes de SQLite, et les comptages — seulement si l'on sait ouvrir la base
  if (typeof opts.ouvrirBase !== "function") {
    ajouter("La base s'ouvre et passe PRAGMA integrity_check", "non-effectue",
      "aucun moteur SQLite fourni à la vérification");
    ajouter("Aucun lien cassé (PRAGMA foreign_key_check)", "non-effectue", "");
    ajouter("Les comptages correspondent au manifeste", "non-effectue", "");
  } else if (fs.existsSync(base)) {
    let db = null;
    try {
      db = opts.ouvrirBase(base);
      let integrite = null;
      try {
        const r = db.prepare("PRAGMA integrity_check").all();
        integrite = r.map((x) => x.integrity_check || Object.values(x)[0]).join(", ");
      } catch (e) { integrite = "erreur : " + e.message; }
      ajouter("La base s'ouvre et passe PRAGMA integrity_check",
        integrite === "ok" ? "ok" : "echec", integrite);

      let liens = [];
      try { liens = db.prepare("PRAGMA foreign_key_check").all(); } catch (_) { liens = []; }
      ajouter("Aucun lien cassé (PRAGMA foreign_key_check)",
        liens.length === 0 ? "ok" : "echec",
        liens.length === 0 ? "" : liens.length + " lien(s) cassé(s)");

      const attendus = (manifeste.base && manifeste.base.comptages) || {};
      const ecarts = [];
      Object.keys(attendus).forEach((t) => {
        if (!tableExiste(db, t)) { ecarts.push(t + " : table absente"); return; }
        let n = null;
        try { n = db.prepare("SELECT COUNT(*) AS n FROM " + t).get().n; } catch (_) {}
        if (n !== attendus[t]) ecarts.push(t + " : attendu " + attendus[t] + ", trouvé " + n);
      });
      ajouter("Les comptages correspondent au manifeste",
        ecarts.length === 0 ? "ok" : "echec",
        ecarts.length === 0 ? Object.keys(attendus).length + " tables vérifiées" : ecarts.join(" | "));
    } catch (e) {
      ajouter("La base s'ouvre et passe PRAGMA integrity_check", "echec", e.message);
    } finally {
      if (db && typeof db.close === "function") { try { db.close(); } catch (_) {} }
    }
  }

  // 4. Les images : présence et empreinte, fichier par fichier
  const listees = (manifeste.images && manifeste.images.fichiers) || null;
  if (listees === null) {
    ajouter("Chaque image du manifeste est présente et intacte", "sans-objet",
      "sauvegarde automatique : elle ne contient pas les images, par conception");
  } else {
    const absentes = [];
    const alterees = [];
    listees.forEach((f) => {
      const p = path.join(dossierSauvegarde, f.chemin.split("/").join(path.sep));
      if (!fs.existsSync(p)) { absentes.push(f.chemin); return; }
      if (fs.statSync(p).size !== f.octets) { alterees.push(f.chemin + " (taille)"); return; }
      if (f.sha256) {
        if (sha256(p) !== f.sha256) alterees.push(f.chemin + " (empreinte)");
      }
    });
    const total = listees.length;
    if (absentes.length === 0 && alterees.length === 0) {
      ajouter("Chaque image du manifeste est présente et intacte", "ok", total + " fichier(s) vérifié(s)");
    } else {
      ajouter("Chaque image du manifeste est présente et intacte", "echec",
        absentes.length + " absente(s), " + alterees.length + " altérée(s) sur " + total
        + (absentes.length ? " — ex. " + absentes.slice(0, 3).join(", ") : "")
        + (alterees.length ? " — ex. " + alterees.slice(0, 3).join(", ") : ""));
    }
  }

  // 5. LE contrôle qui compte : chaque image citée par la base est-elle dans la sauvegarde ?
  const refs = manifeste.references_base || {};
  if (manifeste.type === "automatique") {
    ajouter("Chaque image citée par la base est dans la sauvegarde", "sans-objet",
      "sauvegarde automatique : les images restent dans le dossier de données");
    if ((refs.manquantes || []).length > 0) {
      ajouter("Les images citées existent dans le dossier de données", "echec",
        refs.manquantes.length + " image(s) citée(s) par la base sont absentes du disque : "
        + refs.manquantes.slice(0, 5).join(", "));
    } else {
      ajouter("Les images citées existent dans le dossier de données", "ok",
        (refs.citees || 0) + " référence(s) vérifiée(s) au moment de la sauvegarde");
    }
  } else if (typeof opts.ouvrirBase === "function" && fs.existsSync(base)) {
    // Le contrôle le plus fort : on relit les références DANS LA BASE DE LA SAUVEGARDE, et on
    // cherche chaque fichier DANS LA SAUVEGARDE. Ni l'un ni l'autre ne vient du manifeste, donc
    // un manifeste faux ou périmé ne peut pas faire passer ce contrôle.
    let db = null;
    try {
      db = opts.ouvrirBase(base);
      const citees = imagesCitees(db);
      const absentes = citees.filter(
        (c) => !fs.existsSync(path.join(dossierSauvegarde, c.split("/").join(path.sep)))
      );
      if (absentes.length === 0) {
        ajouter("Chaque image citée par la base est dans la sauvegarde", "ok",
          citees.length + " référence(s) relue(s) dans la base sauvegardée, toutes présentes");
      } else {
        ajouter("Chaque image citée par la base est dans la sauvegarde", "echec",
          absentes.length + " sur " + citees.length + " absente(s) : " + absentes.slice(0, 5).join(", ")
          + (absentes.length > 5 ? " …" : ""));
      }
    } catch (e) {
      ajouter("Chaque image citée par la base est dans la sauvegarde", "echec", e.message);
    } finally {
      if (db && typeof db.close === "function") { try { db.close(); } catch (_) {} }
    }
  } else {
    // Sans moteur SQLite, on se rabat sur ce que le manifeste a noté au moment de la copie.
    const absentes = (refs.manquantes || []);
    ajouter("Chaque image citée par la base est dans la sauvegarde",
      absentes.length === 0 ? "ok" : "echec",
      (absentes.length === 0
        ? (refs.citees || 0) + " référence(s) selon le manifeste"
        : absentes.length + " absente(s) : " + absentes.slice(0, 5).join(", "))
      + " — d'après le manifeste, la base n'ayant pas pu être relue");
  }

  const echecs = controles.filter((c) => c.etat === "echec");
  return {
    ok: echecs.length === 0,
    dossier: dossierSauvegarde,
    type: manifeste.type,
    cree_le: manifeste.cree_le,
    manifeste,
    controles,
    echecs: echecs.length,
  };
}

/** Les sauvegardes présentes sous un dossier, avec leur manifeste — sans rien vérifier. */
function listerSauvegardes(dossierParent) {
  if (!fs.existsSync(dossierParent)) return [];
  return fs.readdirSync(dossierParent, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => {
      const d = path.join(dossierParent, e.name);
      const m = lireManifeste(d);
      let octets = 0;
      listerFichiers(d, []).forEach((f) => { octets += f.octets; });
      return {
        nom: e.name, dossier: d, octets,
        type: m ? m.type : null,
        cree_le: m ? m.cree_le : null,
        motif: m ? m.motif : null,
        avec_manifeste: !!m,
        nb_images: m && m.images && m.images.totaux ? m.images.totaux.fichiers : null,
      };
    })
    .sort((a, b) => String(b.nom).localeCompare(String(a.nom)));
}

// ------------------------------------------------------------------------------------------------
// La restauration
// ------------------------------------------------------------------------------------------------
/**
 * RESTAURATION D'ESSAI, dans un dossier isolé (exigence n° 6).
 *
 * C'est la seule façon de répondre à « ma sauvegarde est-elle exploitable ? » sans prendre le
 * moindre risque : on restaure ailleurs, on vérifie le résultat, et on ne touche pas une seule
 * fois au dossier de données réel. La fonction REFUSE d'écrire dans un dossier non vide, et
 * refuse catégoriquement le dossier de données lui-même.
 */
function restaurerVersDossierIsole(dossierSauvegarde, dossierCible, options) {
  const opts = options || {};
  if (!fs.existsSync(dossierSauvegarde)) {
    throw new Error("Dossier de sauvegarde introuvable : " + dossierSauvegarde);
  }
  if (!dossierCible) throw new Error("Aucun dossier d'essai indiqué.");

  const cibleNorm = path.resolve(dossierCible);
  if (opts.dossierDonnees && path.resolve(opts.dossierDonnees) === cibleNorm) {
    throw new Error(
      "L'essai de restauration refuse d'écrire dans le dossier de données réel. "
      + "Choisissez un dossier vide, ailleurs."
    );
  }
  if (fs.existsSync(cibleNorm) && fs.readdirSync(cibleNorm).length > 0) {
    throw new Error("Le dossier d'essai n'est pas vide : " + cibleNorm);
  }

  const verificationSource = verifierSauvegarde(dossierSauvegarde, { ouvrirBase: opts.ouvrirBase });
  fs.mkdirSync(cibleNorm, { recursive: true });
  const copies = copierArbre(dossierSauvegarde, cibleNorm, []);

  // Le résultat de l'essai est vérifié à son tour, sur le dossier restauré — pas sur la source.
  const verificationCible = verifierSauvegarde(cibleNorm, { ouvrirBase: opts.ouvrirBase });

  return {
    dossier_essai: cibleNorm,
    fichiers_restaures: copies.length,
    verification_source: verificationSource,
    verification_essai: verificationCible,
    ok: verificationSource.ok && verificationCible.ok,
  };
}

/**
 * RESTAURATION RÉELLE, sur le dossier de données.
 *
 * Trois garde-fous, dans cet ordre :
 *   1. la sauvegarde est VÉRIFIÉE d'abord ; si elle échoue, rien ne se passe ;
 *   2. les données actuelles sont DÉPLACÉES dans `backups/avant-restauration-<date>` — déplacées,
 *      pas supprimées. Si la restauration déçoit, tout est encore là ;
 *   3. le dossier `backups` n'est jamais touché : les sauvegardes existantes survivent à la
 *      restauration, ce qui est votre exigence n° 7.
 *
 * `fermerBase` et `ouvrirBaseApres` sont fournis par l'appelant : sous Windows, le fichier reste
 * verrouillé tant qu'une connexion SQLite est ouverte.
 */
function restaurerSurPlace(dossierSauvegarde, dossierDonnees, options) {
  const opts = options || {};
  const verification = verifierSauvegarde(dossierSauvegarde, { ouvrirBase: opts.ouvrirBase });
  // Ce refus-ci passe en premier : c'est le plus utile des deux. Si la sauvegarde est automatique
  // ET défectueuse, dire « elle n'a pas les images » aide davantage que « elle est défectueuse ».
  if (verification.type === "automatique" && !opts.forcer) {
    const e = new Error(
      "Cette sauvegarde est automatique : elle contient la base mais PAS les images. "
      + "La restaurer rendrait des fiches techniques sans croquis. Choisissez une sauvegarde "
      + "complète, ou confirmez explicitement."
    );
    e.verification = verification;
    throw e;
  }
  if (!verification.ok && !opts.forcer) {
    const e = new Error(
      "La sauvegarde n'a pas passé la vérification : "
      + verification.controles.filter((c) => c.etat === "echec").map((c) => c.nom).join(" ; ")
      + ". Rien n'a été modifié."
    );
    e.verification = verification;
    throw e;
  }

  const stamp = horodatage();
  const refuge = path.join(dossierDonnees, "backups", "avant-restauration-" + stamp);
  fs.mkdirSync(refuge, { recursive: true });

  if (typeof opts.fermerBase === "function") opts.fermerBase();

  // Déplacement — pas suppression. Le dossier `backups` reste en place.
  const deplaces = [];
  fs.readdirSync(dossierDonnees, { withFileTypes: true }).forEach((e) => {
    if (EXCLUS.indexOf(e.name.toLowerCase()) !== -1) return;
    const src = path.join(dossierDonnees, e.name);
    const dst = path.join(refuge, e.name);
    try {
      fs.renameSync(src, dst);
    } catch (_) {
      // Rename impossible (volume différent, fichier verrouillé) : on copie puis on supprime.
      if (fs.statSync(src).isDirectory()) fs.cpSync(src, dst, { recursive: true });
      else fs.copyFileSync(src, dst);
      fs.rmSync(src, { recursive: true, force: true });
    }
    deplaces.push(e.name);
  });

  const copies = copierArbre(dossierSauvegarde, dossierDonnees, [NOM_MANIFESTE, "verification.json"]);

  if (typeof opts.ouvrirBaseApres === "function") opts.ouvrirBaseApres();

  return {
    restaure_depuis: dossierSauvegarde,
    donnees_precedentes: refuge,
    elements_deplaces: deplaces,
    fichiers_restaures: copies.length,
    verification,
  };
}

// ------------------------------------------------------------------------------------------------
// Migrations en attente — sert à déclencher la sauvegarde complète AVANT, et seulement si besoin
// ------------------------------------------------------------------------------------------------
/**
 * Y a-t-il une migration à exécuter ? La question se pose AVANT de migrer, pour n'imposer la
 * sauvegarde complète (et ses 81 Mo de copie) que le jour où elle sert vraiment.
 *
 * Les gardes sont celles des modules de migration eux-mêmes — `needsXxx` — et non une
 * réimplémentation : deux définitions de « faut-il migrer ? » finiraient par diverger, et la
 * sauvegarde se déclencherait au mauvais moment, ou pas du tout.
 */
function migrationsEnAttente(db, modules) {
  const liste = [];
  (modules || []).forEach((m) => {
    Object.keys(m.module || {}).forEach((cle) => {
      if (cle.indexOf("needs") !== 0) return;
      let besoin = false;
      try { besoin = !!m.module[cle](db); } catch (_) { besoin = false; }
      if (besoin) liste.push({ module: m.nom, controle: cle });
    });
  });
  return liste;
}

module.exports = {
  FORMAT_MANIFESTE, NOM_MANIFESTE, NOM_BASE, EXCLUS, COLONNES_IMAGES,
  listerFichiers, copierArbre, sha256,
  inventorier, construireManifeste, lireManifeste, ecrireManifeste,
  sauvegardeComplete, sauvegardeCompleteSync, sauvegardeAutomatique, sauvegardeAvantOperation, sauvegardeAvantOperationSync,
  verifierSauvegarde, listerSauvegardes,
  restaurerVersDossierIsole, restaurerSurPlace,
  migrationsEnAttente, imagesCitees, comptages,
};
