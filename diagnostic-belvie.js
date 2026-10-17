// ================================================================================================
// DIAGNOSTIC BELVIE ERP — lot 0
// ================================================================================================
//
// CE SCRIPT NE MODIFIE RIEN. Il ne touche pas à votre application, pas à votre base, pas à vos
// images. La base est ouverte en LECTURE SEULE, aucune migration n'est déclenchée, et le seul
// fichier écrit est le rapport que vous demandez.
//
// Il répond à quatre questions, et c'est tout :
//
//   1. Combien de dossiers de données existent sur cette machine, et lequel contient vos données ?
//   2. Toutes les images citées par la base sont-elles bien présentes sur le disque ?
//   3. Que contiendrait une sauvegarde faite AUJOURD'HUI, et surtout : que lui manquerait-il ?
//   4. Le projet est-il prêt pour fabriquer un installateur Windows ?
//
// Lancement, depuis le dossier du projet :  npm run diagnostic
// En invite de commandes, depuis le dossier du projet :
//
//     set ELECTRON_RUN_AS_NODE=1
//     npx electron diagnostic-belvie.js diagnostic-belvie.txt
//
// Pourquoi `npx electron` et non `node` : better-sqlite3 est compilé pour Electron. Lancé avec le
// `node` du système, il refuserait de se charger. Le script sait toutefois se replier sur le
// module sqlite intégré à Node si besoin.

const fs = require("fs");
const path = require("path");

const lignes = [];
function L(texte) { lignes.push(texte === undefined ? "" : String(texte)); }
function titre(t) { L(""); L("=".repeat(96)); L("  " + t); L("=".repeat(96)); L(""); }
function sousTitre(t) { L(""); L("--- " + t + " " + "-".repeat(Math.max(0, 90 - t.length))); L(""); }

const problemes = [];
function probleme(gravite, texte, detail) {
  problemes.push({ gravite, texte, detail: detail || null });
}

// ------------------------------------------------------------------------------------------------
// Petits utilitaires
// ------------------------------------------------------------------------------------------------
function octets(n) {
  if (n == null) return "-";
  const u = ["o", "Ko", "Mo", "Go", "To"];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)) + " " + u[i];
}

function dateFr(d) {
  if (!d) return "-";
  const x = new Date(d);
  if (isNaN(x.getTime())) return "-";
  const p = (n) => String(n).padStart(2, "0");
  return p(x.getDate()) + "/" + p(x.getMonth() + 1) + "/" + x.getFullYear()
    + " " + p(x.getHours()) + ":" + p(x.getMinutes());
}

/** Parcourt un dossier récursivement. Rend { fichiers, octets } — sans jamais rien écrire. */
function mesurerDossier(dir) {
  const resultat = { fichiers: 0, octets: 0, existe: false };
  if (!dir || !fs.existsSync(dir)) return resultat;
  resultat.existe = true;
  const pile = [dir];
  while (pile.length) {
    const courant = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(courant, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entrees) {
      const complet = path.join(courant, e.name);
      if (e.isDirectory()) { pile.push(complet); continue; }
      try {
        const st = fs.statSync(complet);
        resultat.fichiers += 1;
        resultat.octets += st.size;
      } catch (_) { /* fichier disparu en cours de route : ignoré */ }
    }
  }
  return resultat;
}

/** Dimensions d'une image, lues dans l'en-tête du fichier. Aucune bibliothèque, aucune
 *  décompression : on lit les premiers octets, c'est tout. */
function dimensionsImage(fichier) {
  let fd;
  try {
    fd = fs.openSync(fichier, "r");
    const buf = Buffer.alloc(64);
    const lus = fs.readSync(fd, buf, 0, 64, 0);
    if (lus < 24) return null;

    // PNG : signature 8 octets, puis IHDR avec largeur et hauteur en 32 bits
    if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return { format: "PNG", largeur: buf.readUInt32BE(16), hauteur: buf.readUInt32BE(20) };
    }
    // WEBP : "RIFF" .... "WEBPVP8 "
    if (buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
      return { format: "WEBP", largeur: null, hauteur: null };
    }
    // JPEG : on parcourt les marqueurs jusqu'au SOF
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      const taille = fs.statSync(fichier).size;
      const tout = Buffer.alloc(Math.min(taille, 512 * 1024));
      fs.readSync(fd, tout, 0, tout.length, 0);
      let i = 2;
      while (i < tout.length - 9) {
        if (tout[i] !== 0xff) { i += 1; continue; }
        const marqueur = tout[i + 1];
        const longueur = tout.readUInt16BE(i + 2);
        const estSOF = (marqueur >= 0xc0 && marqueur <= 0xcf)
          && marqueur !== 0xc4 && marqueur !== 0xc8 && marqueur !== 0xcc;
        if (estSOF) {
          return { format: "JPEG", hauteur: tout.readUInt16BE(i + 5), largeur: tout.readUInt16BE(i + 7) };
        }
        i += 2 + longueur;
      }
      return { format: "JPEG", largeur: null, hauteur: null };
    }
    return null;
  } catch (_) {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) {} }
  }
}

/** Ouvre une base en LECTURE SEULE. better-sqlite3 d'abord, le module intégré à Node en secours. */
function ouvrirEnLecture(chemin) {
  try {
    const Database = require("better-sqlite3");
    return { db: new Database(chemin, { readonly: true, fileMustExist: true }), moteur: "better-sqlite3" };
  } catch (err) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      return { db: new DatabaseSync(chemin, { readOnly: true }), moteur: "node:sqlite" };
    } catch (err2) {
      return { erreur: "better-sqlite3 : " + (err && err.message) + " | node:sqlite : " + (err2 && err2.message) };
    }
  }
}

function compter(db, table) {
  try { return db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n; }
  catch (_) { return null; }
}

function tableExiste(db, table) {
  try {
    return !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(table);
  } catch (_) { return false; }
}

function colonneExiste(db, table, colonne) {
  try { return db.prepare("PRAGMA table_info(" + table + ")").all().some((c) => c.name === colonne); }
  catch (_) { return false; }
}

// ------------------------------------------------------------------------------------------------
// Les neuf colonnes de la base qui citent un fichier image, et le dossier attendu de chacune
// ------------------------------------------------------------------------------------------------
const SOURCES_IMAGES = [
  { table: "article_photos", colonne: "photo_path", libelle: "Photos d'articles", dossier: "images/commandes" },
  { table: "article_photos", colonne: "photo_thumb_path", libelle: "Vignettes d'articles", dossier: "images/commandes/thumbs" },
  { table: "planning_articles", colonne: "photo_path", libelle: "Photos du planning", dossier: "images/commandes" },
  { table: "planning_articles", colonne: "photo_thumb_path", libelle: "Vignettes du planning", dossier: "images/commandes/thumbs" },
  { table: "ft_croquis", colonne: "image_path", libelle: "CROQUIS TECHNIQUES", dossier: "images/fiches-techniques" },
  { table: "ft_accessoires", colonne: "photo_path", libelle: "Photos de fournitures", dossier: "images/fiches-techniques-accessoires" },
  { table: "entreprise", colonne: "logo_path", libelle: "LOGO DE L'ENTREPRISE", dossier: "images/entreprise" },
  { table: "bc_pf", colonne: "photo_snapshot_path", libelle: "Photos figées des BC PF", dossier: "images/bc_pf" },
  { table: "bc_pf", colonne: "entreprise_logo_snapshot_path", libelle: "Logos figés des BC PF", dossier: "images/bc_pf" },
];

const SOUS_DOSSIERS_IMAGES = [
  "images/commandes",
  "images/fiches-techniques",
  "images/fiches-techniques-accessoires",
  "images/entreprise",
  "images/bc_pf",
];

/** Ce que la sauvegarde ACTUELLE copie — et elle ne copie que cela.
 *  Voir electron/ipc/system.js, fonction copyImagesDirIfPresent. */
const COUVERT_PAR_LA_SAUVEGARDE_ACTUELLE = "images/commandes";

const TABLES_CLES = [
  "commandes", "commande_lignes", "articles", "article_photos", "planning_articles",
  "fiches_techniques", "ft_matieres", "ft_accessoires", "ft_croquis",
  "ft_matiere_couleurs", "ft_fourniture_couleurs",
  "matieres_catalogue", "accessoires_catalogue", "matiere_couleurs",
  "fournisseurs", "achats", "achats_affectations", "achats_factures", "achats_receptions",
  "paiements", "prix_fournisseurs", "estimations",
  "bc_pf", "bc_mp", "bc_mp_lignes", "bc_mp_ligne_productions",
  "listes_valeurs", "parametres", "entreprise",
];

// ------------------------------------------------------------------------------------------------
// 1. Trouver TOUS les dossiers de données possibles
// ------------------------------------------------------------------------------------------------
function racineDonnees() {
  if (process.platform === "win32" && process.env.APPDATA) return process.env.APPDATA;
  if (process.platform === "darwin") return path.join(process.env.HOME || "", "Library", "Application Support");
  return path.join(process.env.HOME || "", ".config");
}

/**
 * Cherche tout dossier contenant un fichier `belvie.db`. On ne se contente pas des deux noms
 * attendus : si un troisième dossier existe pour une raison quelconque, il faut le voir.
 */
let dossierImpose = null;

function trouverDossiersDonnees() {
  if (dossierImpose) {
    const base = path.join(dossierImpose, "belvie.db");
    if (fs.existsSync(base)) {
      return [{ dossier: dossierImpose, base, raison: "dossier indiqué en argument" }];
    }
  }
  const racine = racineDonnees();
  const trouves = [];
  const vus = new Set();

  function examiner(dossier, raison) {
    if (!dossier || vus.has(dossier.toLowerCase())) return;
    vus.add(dossier.toLowerCase());
    const base = path.join(dossier, "belvie.db");
    if (fs.existsSync(base)) trouves.push({ dossier, base, raison });
  }

  // Les deux noms attendus, même si le balayage échoue.
  examiner(path.join(racine, "belvie-erp"), "nom utilisé en développement (package.json \"name\")");
  examiner(path.join(racine, "Belvie ERP"), "nom utilisé par l'installateur (build.productName)");

  try {
    for (const e of fs.readdirSync(racine, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const normalise = e.name.toLowerCase().replace(/[\s_-]/g, "");
      if (normalise.indexOf("belvie") !== -1) examiner(path.join(racine, e.name), "trouvé par balayage");
    }
  } catch (_) { /* dossier illisible : les deux noms attendus suffisent */ }

  return trouves;
}

// ------------------------------------------------------------------------------------------------
// 2. Analyse d'un dossier de données
// ------------------------------------------------------------------------------------------------
function analyser(entree, complet) {
  const { dossier, base } = entree;
  const resultat = { dossier, base, comptages: {}, images: {}, references: [], moteur: null, erreur: null };

  const st = fs.statSync(base);
  resultat.taille = st.size;
  resultat.modifie = st.mtime;

  // Les fichiers annexes du journal d'écriture : s'ils sont volumineux, l'application tourne
  // encore ou s'est mal fermée.
  resultat.wal = fs.existsSync(base + "-wal") ? fs.statSync(base + "-wal").size : null;

  const ouverture = ouvrirEnLecture(base);
  if (ouverture.erreur) { resultat.erreur = ouverture.erreur; return resultat; }
  const db = ouverture.db;
  resultat.moteur = ouverture.moteur;

  try {
    TABLES_CLES.forEach((t) => { resultat.comptages[t] = compter(db, t); });

    // Inventaire du disque, sous-dossier par sous-dossier.
    SOUS_DOSSIERS_IMAGES.forEach((rel) => {
      resultat.images[rel] = mesurerDossier(path.join(dossier, rel.split("/").join(path.sep)));
    });
    resultat.backupsAuto = mesurerDossier(path.join(dossier, "backups", "auto"));
    resultat.backupsPreMigration = mesurerDossier(path.join(dossier, "backups", "pre-migration"));
    resultat.totalDossier = mesurerDossier(dossier);

    if (!complet) return resultat;

    // --- Le contrôle qui compte : chaque image citée existe-t-elle ? ---------------------------
    SOURCES_IMAGES.forEach((src) => {
      const bloc = {
        libelle: src.libelle, table: src.table, colonne: src.colonne, dossier: src.dossier,
        citees: 0, presentes: 0, manquantes: [], horsDossierAttendu: [], absolues: [], octets: 0,
      };
      if (!tableExiste(db, src.table) || !colonneExiste(db, src.table, src.colonne)) {
        bloc.absente = true;
        resultat.references.push(bloc);
        return;
      }
      let rows = [];
      try {
        rows = db.prepare(
          "SELECT " + src.colonne + " AS c FROM " + src.table + " WHERE " + src.colonne + " IS NOT NULL AND " + src.colonne + " <> ''"
        ).all();
      } catch (_) { rows = []; }

      rows.forEach((r) => {
        const rel = String(r.c);
        bloc.citees += 1;
        // Un chemin absolu stocké en base serait un problème grave : il casserait au moindre
        // déplacement du dossier. On vérifie, plutôt que de le supposer.
        if (path.isAbsolute(rel) || /^[A-Za-z]:[\\/]/.test(rel)) {
          bloc.absolues.push(rel);
          return;
        }
        if (rel.replace(/\\/g, "/").indexOf(src.dossier) !== 0) bloc.horsDossierAttendu.push(rel);
        const abs = path.join(dossier, rel.split("/").join(path.sep));
        if (fs.existsSync(abs)) {
          bloc.presentes += 1;
          try { bloc.octets += fs.statSync(abs).size; } catch (_) {}
        } else {
          bloc.manquantes.push(rel);
        }
      });
      resultat.references.push(bloc);
    });
  } finally {
    try { db.close(); } catch (_) {}
  }
  return resultat;
}

// ------------------------------------------------------------------------------------------------
// 3. Le rapport
// ------------------------------------------------------------------------------------------------
function main() {
  const sortie = process.argv[2] || "diagnostic-belvie.txt";

  L("DIAGNOSTIC BELVIE ERP — lot 0");
  L("Établi le " + dateFr(new Date()));
  L("");
  L("Ce diagnostic n'a RIEN modifié : la base a été ouverte en lecture seule, aucune migration");
  L("n'a été déclenchée, et le seul fichier écrit est ce rapport.");

  // ---------------------------------------------------------------------------- A. Environnement
  titre("A. L'environnement");
  L("  Système                : " + process.platform + " " + process.arch);
  L("  Version de Node        : " + process.versions.node);
  L("  Version d'Electron     : " + (process.versions.electron || "— (lancé avec node, pas avec electron)"));
  L("  Dossier des données    : " + racineDonnees());
  L("  Dossier du projet      : " + process.cwd());
  L("  NODE_ENV               : " + (process.env.NODE_ENV || "(non défini)"));

  if (!process.versions.electron) {
    probleme("info",
      "Le diagnostic a été lancé avec « node » et non avec Electron.",
      "Les comptages restent exacts, mais la version d'Electron n'a pas pu être relevée. Pour l'obtenir, "
      + "relancez par : npm run diagnostic");
  }
  if (process.env.NODE_ENV === "development") {
    probleme("moyen",
      "La variable NODE_ENV vaut « development » dans cette session.",
      "Si elle est définie de façon permanente dans Windows, l'application INSTALLÉE tenterait de se "
      + "connecter au serveur de développement et afficherait une fenêtre blanche. C'est exactement le "
      + "point 3 du § 4 du plan, et la correction prévue au lot 1 (app.isPackaged) le rend sans effet.");
  }

  try {
    if (typeof fs.statfsSync === "function") {
      const s = fs.statfsSync(racineDonnees());
      const libre = s.bavail * s.bsize;
      L("  Espace disque libre    : " + octets(libre));
      if (libre < 5 * 1024 * 1024 * 1024) {
        probleme("moyen", "Moins de 5 Go libres sur le disque des données (" + octets(libre) + ").",
          "Une sauvegarde complète puis une installation demandent de la place. À surveiller avant le lot 3.");
      }
    }
  } catch (_) { /* information de confort */ }

  // ----------------------------------------------------------------- B. Les dossiers de données
  titre("B. Les dossiers de données trouvés sur cette machine");

  const dossiers = trouverDossiersDonnees();
  if (dossiers.length === 0) {
    L("  AUCUN dossier contenant « belvie.db » n'a été trouvé sous " + racineDonnees());
    L("");
    L("  Si votre base est ailleurs, indiquez son dossier en second argument :");
    L('      npx electron diagnostic-belvie.js rapport.txt "D:\\chemin\\du\\dossier"');
    probleme("bloquant", "Aucune base de données trouvée.",
      "Le diagnostic n'a rien pu analyser. Vérifiez l'emplacement de belvie.db.");
    fs.writeFileSync(sortie, lignes.join("\r\n"), "utf-8");
    console.log("Rapport écrit dans " + path.resolve(sortie));
    return;
  }

  L("  " + dossiers.length + " dossier(s) de données trouvé(s).");
  L("");

  // Le dossier « en service » est celui que l'application utilise aujourd'hui en développement —
  // sauf si un dossier a été imposé en argument, auquel cas c'est celui-là.
  // Tous sont d'abord inventoriés rapidement ; SEUL le principal sera analysé en profondeur,
  // pour ne pas parcourir deux fois des milliers d'images.
  const analyses = dossiers.map((d) => Object.assign(analyser(d, false), {
    enService: dossierImpose ? d.dossier === dossierImpose : path.basename(d.dossier) === "belvie-erp",
    raison: d.raison,
  }));

  analyses.forEach((a) => {
    L("  " + (a.enService ? "► " : "  ") + a.dossier);
    L("      " + a.raison + (a.enService ? "   ← C'EST CELUI QUE VOTRE APPLICATION UTILISE" : ""));
    L("      belvie.db        : " + octets(a.taille) + ", modifié le " + dateFr(a.modifie));
    if (a.wal != null && a.wal > 0) {
      L("      journal (-wal)   : " + octets(a.wal) + "  → l'application est peut-être ouverte en ce moment");
    }
    if (a.erreur) {
      L("      LECTURE IMPOSSIBLE : " + a.erreur);
      probleme("bloquant", "La base de « " + a.dossier + " » n'a pas pu être ouverte.", a.erreur);
      L("");
      return;
    }
    const c = a.comptages;
    L("      contenu          : " + (c.commandes != null ? c.commandes : "?") + " commandes, "
      + (c.articles != null ? c.articles : "?") + " articles, "
      + (c.fiches_techniques != null ? c.fiches_techniques : "?") + " fiches techniques, "
      + (c.achats != null ? c.achats : "?") + " achats, "
      + (c.bc_mp != null ? c.bc_mp : "?") + " bons MP");
    const totalImages = SOUS_DOSSIERS_IMAGES.reduce((s, r) => s + (a.images[r] ? a.images[r].fichiers : 0), 0);
    L("      images sur disque: " + totalImages + " fichier(s)");
    L("      dossier entier   : " + octets(a.totalDossier.octets) + " (" + a.totalDossier.fichiers + " fichiers)");
    L("");
  });

  const avecDonnees = analyses.filter((a) => !a.erreur && (a.comptages.commandes || 0) + (a.comptages.articles || 0) > 0);
  if (avecDonnees.length > 1) {
    probleme("bloquant",
      "DEUX dossiers de données contiennent des données réelles.",
      "C'est le cas prévu au § 1 du plan. Rien ne sera fusionné ni écrasé automatiquement : "
      + "il faudra décider ensemble, sur les chiffres ci-dessus, lequel fait foi.");
  } else if (analyses.length > 1) {
    probleme("info",
      "Plusieurs dossiers existent, mais un seul contient des données.",
      "Les autres sont vides ou résiduels. Le lot 1 fixera le dossier utilisé, et les vides pourront "
      + "être supprimés ensuite — jamais avant.");
  } else {
    L("  Un seul dossier de données : c'est le cas le plus simple. Le lot 1 le figera définitivement,");
    L("  et la version installée ouvrira exactement cette base.");
  }

  const choisi = analyses.find((a) => a.enService && !a.erreur) || analyses.find((a) => !a.erreur);
  // L'analyse APPROFONDIE — la cohérence base <-> images — ne porte que sur ce dossier-là.
  const principal = choisi
    ? Object.assign(analyser({ dossier: choisi.dossier, base: choisi.base }, true),
                    { enService: choisi.enService, raison: choisi.raison })
    : null;
  if (!principal) {
    fs.writeFileSync(sortie, lignes.join("\r\n"), "utf-8");
    console.log("Rapport écrit dans " + path.resolve(sortie));
    return;
  }

  // ------------------------------------------------------------- C. Détail du dossier en service
  titre("C. Le dossier en service, en détail");
  L("  " + principal.dossier);
  L("  Lu avec : " + principal.moteur);
  L("");
  L("  " + "Sous-dossier".padEnd(42) + "Fichiers".padStart(10) + "Taille".padStart(14));
  L("  " + "-".repeat(66));
  SOUS_DOSSIERS_IMAGES.forEach((rel) => {
    const m = principal.images[rel];
    L("  " + rel.padEnd(42) + String(m.existe ? m.fichiers : 0).padStart(10) + octets(m.octets).padStart(14)
      + (m.existe ? "" : "   (dossier absent)"));
  });
  L("  " + "-".repeat(66));
  L("  " + "backups/auto".padEnd(42) + String(principal.backupsAuto.fichiers).padStart(10)
    + octets(principal.backupsAuto.octets).padStart(14));
  L("  " + "backups/pre-migration".padEnd(42) + String(principal.backupsPreMigration.fichiers).padStart(10)
    + octets(principal.backupsPreMigration.octets).padStart(14));
  L("");
  L("  TOTAL du dossier de données : " + octets(principal.totalDossier.octets)
    + " (" + principal.totalDossier.fichiers + " fichiers)");

  const imagesSeules = SOUS_DOSSIERS_IMAGES.reduce((s, r) => s + principal.images[r].octets, 0);
  const sauvegardesSeules = principal.backupsAuto.octets + principal.backupsPreMigration.octets;
  L("    dont images                : " + octets(imagesSeules));
  L("    dont sauvegardes existantes: " + octets(sauvegardesSeules));
  L("    dont base                  : " + octets(principal.taille));

  sousTitre("Ce que cela implique pour la sauvegarde automatique");
  L("  Aujourd'hui, à chaque fermeture, l'application copie la base et images/commandes, et garde");
  L("  les 5 dernières copies.");
  L("");
  const parFermetureActuel = principal.taille + principal.images["images/commandes"].octets;
  const parFermetureComplet = principal.taille + imagesSeules;
  L("  Copie par fermeture, AUJOURD'HUI          : " + octets(parFermetureActuel));
  L("  Si l'on copiait TOUTES les images         : " + octets(parFermetureComplet));
  L("  Place occupée par 5 copies complètes      : " + octets(parFermetureComplet * 5));
  L("  Place occupée par 5 copies « base seule » : " + octets(principal.taille * 5));
  L("");
  L("  C'est le chiffre sur lequel repose votre décision n° 1 : base + inventaire à chaque");
  L("  fermeture, et copie complète à la demande.");

  if (parFermetureComplet * 5 > 2 * 1024 * 1024 * 1024) {
    probleme("moyen",
      "Copier toutes les images à chaque fermeture occuperait " + octets(parFermetureComplet * 5) + ".",
      "Votre décision n° 1 (base + inventaire en automatique, copie complète à la demande) est donc "
      + "la bonne : elle ramène les sauvegardes automatiques à " + octets(principal.taille * 5) + ".");
  }

  // ------------------------------------------------------- D. Cohérence entre la base et le disque
  titre("D. Chaque image citée par la base existe-t-elle sur le disque ?");
  L("  C'est le contrôle du § 3 du plan. Il parcourt les neuf colonnes de la base qui citent un");
  L("  fichier, et vérifie la présence de chacun.");
  L("");
  L("  " + "Ce qui est cité".padEnd(34) + "Citées".padStart(8) + "Présentes".padStart(11)
    + "Manquantes".padStart(12) + "Taille".padStart(12));
  L("  " + "-".repeat(77));

  let totalCitees = 0, totalManquantes = 0, totalAbsolues = 0;
  principal.references.forEach((b) => {
    if (b.absente) {
      L("  " + b.libelle.padEnd(34) + "(table ou colonne absente de cette base)");
      return;
    }
    totalCitees += b.citees;
    totalManquantes += b.manquantes.length;
    totalAbsolues += b.absolues.length;
    L("  " + b.libelle.padEnd(34) + String(b.citees).padStart(8) + String(b.presentes).padStart(11)
      + String(b.manquantes.length).padStart(12) + octets(b.octets).padStart(12));
  });
  L("  " + "-".repeat(77));
  L("  " + "TOTAL".padEnd(34) + String(totalCitees).padStart(8)
    + String(totalCitees - totalManquantes).padStart(11) + String(totalManquantes).padStart(12));

  if (totalManquantes > 0) {
    sousTitre("Les fichiers cités par la base mais ABSENTS du disque");
    principal.references.forEach((b) => {
      if (!b.manquantes || b.manquantes.length === 0) return;
      L("  " + b.libelle + " (" + b.table + "." + b.colonne + ") — " + b.manquantes.length + " manquant(s) :");
      b.manquantes.slice(0, 20).forEach((m) => L("      " + m));
      if (b.manquantes.length > 20) L("      … et " + (b.manquantes.length - 20) + " autre(s)");
      L("");
    });
    probleme("moyen",
      totalManquantes + " image(s) citée(s) par la base sont absentes du disque.",
      "Ces images apparaîtront comme cassées dans l'application. Ce n'est pas causé par le diagnostic : "
      + "elles l'étaient déjà. La liste complète est au § D.");
  } else if (totalCitees > 0) {
    L("");
    L("  Aucune image manquante : la base et le disque sont cohérents.");
  }

  if (totalAbsolues > 0) {
    probleme("bloquant",
      totalAbsolues + " chemin(s) ABSOLU(S) trouvé(s) dans la base.",
      "Un chemin absolu casse dès que le dossier de données change de nom ou de machine. Le plan "
      + "reposait sur le fait qu'il n'y en avait aucun : il faudra les corriger avant le lot 1.");
    sousTitre("Chemins absolus trouvés");
    principal.references.forEach((b) => {
      (b.absolues || []).slice(0, 10).forEach((x) => L("  " + b.table + "." + b.colonne + " : " + x));
    });
  } else if (totalCitees > 0) {
    L("  Aucun chemin absolu : tous les chemins sont relatifs au dossier de données, donc le");
    L("  dossier peut être figé sans rien réécrire. C'est l'hypothèse centrale du plan, vérifiée.");
  }

  const horsDossier = principal.references.reduce((s, b) => s + ((b.horsDossierAttendu || []).length), 0);
  if (horsDossier > 0) {
    probleme("info", horsDossier + " chemin(s) ne sont pas dans le sous-dossier attendu.",
      "Sans gravité tant que le fichier existe, mais la sauvegarde complète doit les couvrir aussi — "
      + "raison de plus pour sauvegarder tout le dossier plutôt qu'une liste de sous-dossiers.");
  }

  // ------------------------------------------------- E. Ce que la sauvegarde d'aujourd'hui oublie
  titre("E. Que contiendrait une sauvegarde faite AUJOURD'HUI ?");
  L("  La sauvegarde actuelle copie la base et UN SEUL dossier d'images : " + COUVERT_PAR_LA_SAUVEGARDE_ACTUELLE);
  L("  (electron/ipc/system.js, fonction copyImagesDirIfPresent — et la restauration fait de même)");
  L("");
  L("  " + "Ce qui est cité".padEnd(34) + "Citées".padStart(8) + "Sauvegardées".padStart(14) + "PERDUES".padStart(10));
  L("  " + "-".repeat(66));

  let perduesTotal = 0;
  principal.references.forEach((b) => {
    if (b.absente || b.citees === 0) return;
    const couverte = b.dossier.indexOf(COUVERT_PAR_LA_SAUVEGARDE_ACTUELLE) === 0;
    const perdues = couverte ? 0 : b.presentes;
    perduesTotal += perdues;
    L("  " + b.libelle.padEnd(34) + String(b.citees).padStart(8)
      + String(couverte ? b.presentes : 0).padStart(14) + String(perdues).padStart(10));
  });
  L("  " + "-".repeat(66));
  L("  " + "TOTAL PERDU".padEnd(56) + String(perduesTotal).padStart(10));

  if (perduesTotal > 0) {
    L("");
    L("  Autrement dit : une sauvegarde faite aujourd'hui, restaurée sur une machine neuve, rendrait");
    L("  une base complète et " + perduesTotal + " image(s) manquante(s) — croquis techniques et logo compris.");
    probleme("bloquant",
      perduesTotal + " image(s) ne seraient PAS sauvegardées aujourd'hui.",
      "C'est le défaut du § 2 du plan, mesuré sur vos données réelles. C'est la raison pour laquelle "
      + "le lot 2 doit passer avant toute installation.");
  } else if (totalCitees > 0) {
    L("");
    L("  Aucune perte : toutes les images citées sont dans le dossier couvert par la sauvegarde.");
  }

  // ------------------------------------------------------------- F. Les sauvegardes qui existent
  titre("F. Les sauvegardes déjà présentes");
  const auto = path.join(principal.dossier, "backups", "auto");
  if (fs.existsSync(auto)) {
    const entrees = fs.readdirSync(auto, { withFileTypes: true })
      .filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
    L("  " + entrees.length + " sauvegarde(s) automatique(s), " + octets(principal.backupsAuto.octets) + " au total :");
    entrees.slice(0, 8).forEach((nom) => {
      const m = mesurerDossier(path.join(auto, nom));
      L("      " + nom.padEnd(44) + String(m.fichiers).padStart(7) + " fichiers" + octets(m.octets).padStart(12));
    });
    if (entrees.length > 8) L("      … et " + (entrees.length - 8) + " autre(s)");
  } else {
    L("  Aucune sauvegarde automatique. L'application n'a peut-être jamais été fermée proprement,");
    L("  ou le dossier a été nettoyé.");
    probleme("moyen", "Aucune sauvegarde automatique trouvée.",
      "La sauvegarde automatique se déclenche à la fermeture de l'application. Si vous la fermez en "
      + "coupant le terminal, elle n'a pas le temps de s'exécuter.");
  }
  L("");
  const preMig = path.join(principal.dossier, "backups", "pre-migration");
  if (fs.existsSync(preMig)) {
    const n = fs.readdirSync(preMig).length;
    L("  " + n + " sauvegarde(s) pré-migration, " + octets(principal.backupsPreMigration.octets) + " au total.");
  } else {
    L("  Aucune sauvegarde pré-migration : normal si aucune migration lourde n'a été nécessaire.");
  }

  // --------------------------------------------------------------- G. Prêt pour l'installateur ?
  titre("G. Le projet est-il prêt pour fabriquer l'installateur ?");
  const projet = process.cwd();
  const pkgPath = path.join(projet, "package.json");
  let pkg = null;
  try { pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")); } catch (_) {}

  if (!pkg) {
    L("  package.json introuvable dans " + projet);
    L("  Lancez le diagnostic DEPUIS le dossier du projet :  npm run diagnostic");
    probleme("moyen", "Le diagnostic n'a pas été lancé depuis le dossier du projet.",
      "Les sections A à F restent valables ; seule la section G n'a pas pu être établie.");
  } else {
    const b = pkg.build || {};
    L("  " + "Élément".padEnd(46) + "État");
    L("  " + "-".repeat(84));
    const dire = (quoi, ok, detail) => L("  " + quoi.padEnd(46) + (ok ? "OK   " : "À FAIRE  ") + (detail || ""));

    dire("Nom de l'application (package.json \"name\")", true, pkg.name);
    dire("Nom affiché (build.productName)", true, b.productName || "(absent)");
    dire("Version", true, pkg.version);
    dire("Cible NSIS (assistant Windows)", !!(b.win && b.win.target), JSON.stringify(b.win && b.win.target));
    dire("perMachine: false (aucun mot de passe admin)", b.nsis && b.nsis.perMachine === false, "");

    const icone = b.win && b.win.icon ? path.join(projet, b.win.icon) : null;
    const icoPresente = icone && fs.existsSync(icone);
    dire("Icône " + (b.win && b.win.icon ? b.win.icon : "(non déclarée)"), !!icoPresente,
      icoPresente ? octets(fs.statSync(icone).size) : "le fichier n'existe pas");
    if (!icoPresente) {
      probleme("bloquant",
        "L'icône " + (b.win && b.win.icon ? b.win.icon : "") + " est déclarée mais absente.",
        "La fabrication de l'installateur s'arrêtera là. C'est le point 1 du § 4 du plan, et votre "
        + "décision n° 4 (produire l'icône à partir du logo) y répond — voir ci-dessous.");
    }

    const distPresent = fs.existsSync(path.join(projet, "dist", "index.html"));
    dire("Interface construite (dist/index.html)", distPresent,
      distPresent ? "" : "sera produite par npm run build:renderer");
    dire("electron-builder", !!(pkg.devDependencies && pkg.devDependencies["electron-builder"]),
      (pkg.devDependencies && pkg.devDependencies["electron-builder"]) || "");
    dire("postinstall (modules compilés)", !!(pkg.scripts && pkg.scripts.postinstall),
      (pkg.scripts && pkg.scripts.postinstall) || "");

    const nm = fs.existsSync(path.join(projet, "node_modules"));
    dire("node_modules installés", nm, nm ? "" : "lancez npm install avant toute fabrication");
  }

  // --- Le logo, pour l'icône (votre décision n° 4) ---
  sousTitre("Le logo existant, pour en faire l'icône");
  let logoRel = null;
  const blocLogo = principal.references.find((b) => b.table === "entreprise");
  try {
    const o = ouvrirEnLecture(principal.base);
    if (!o.erreur) {
      try {
        const row = o.db.prepare("SELECT logo_path FROM entreprise WHERE logo_path IS NOT NULL AND logo_path <> ''").get();
        logoRel = row ? row.logo_path : null;
      } catch (_) {}
      try { o.db.close(); } catch (_) {}
    }
  } catch (_) {}

  if (!logoRel) {
    L("  Aucun logo enregistré dans la fiche Entreprise.");
    probleme("moyen", "Aucun logo trouvé pour fabriquer l'icône.",
      "Votre décision n° 4 était d'utiliser le logo existant. Il faudra soit en déposer un dans "
      + "Paramètres → Entreprise, soit me fournir un fichier image directement.");
  } else {
    const abs = path.join(principal.dossier, logoRel.split("/").join(path.sep));
    L("  Chemin en base : " + logoRel);
    if (!fs.existsSync(abs)) {
      L("  LE FICHIER EST ABSENT du disque.");
      probleme("moyen", "Le logo est cité par la base mais absent du disque.", abs);
    } else {
      const st = fs.statSync(abs);
      const d = dimensionsImage(abs);
      L("  Fichier        : " + abs);
      L("  Taille         : " + octets(st.size));
      if (d) {
        L("  Format         : " + d.format
          + (d.largeur ? "  " + d.largeur + " × " + d.hauteur + " pixels" : "  (dimensions non lisibles)"));
        if (d.largeur && Math.min(d.largeur, d.hauteur) < 256) {
          L("");
          L("  ATTENTION : une icône Windows a besoin d'au moins 256 × 256 pixels. Ce logo est plus");
          L("  petit ; l'agrandir donnerait une icône floue.");
          probleme("moyen",
            "Le logo fait " + d.largeur + " × " + d.hauteur + " pixels, moins que les 256 × 256 requis.",
            "Il faudra soit un fichier d'origine en meilleure définition, soit accepter une icône moins nette. "
            + "Je vous montrerai un aperçu avant de valider, comme convenu.");
        } else if (d.largeur) {
          L("");
          L("  Définition suffisante pour produire une icône 256 × 256 nette.");
        }
      } else {
        L("  Format         : non reconnu par la lecture d'en-tête");
      }
      L("");
      L("  Pour l'aperçu de l'icône, envoyez-moi simplement ce fichier.");
    }
  }

  // ---------------------------------------------------------------------- H. Ce qu'il faut retenir
  titre("H. Ce qu'il faut retenir");

  const ordre = { bloquant: 0, moyen: 1, info: 2 };
  const etiquette = { bloquant: "À CORRIGER AVANT D'INSTALLER", moyen: "À REGARDER", info: "POUR INFORMATION" };
  problemes.sort((a, b) => ordre[a.gravite] - ordre[b.gravite]);

  if (problemes.length === 0) {
    L("  Aucun problème détecté. Rien ne s'oppose à la suite du plan.");
  } else {
    let gravitePrecedente = null;
    problemes.forEach((p, i) => {
      if (p.gravite !== gravitePrecedente) {
        L("");
        L("  " + etiquette[p.gravite]);
        L("  " + "-".repeat(etiquette[p.gravite].length));
        gravitePrecedente = p.gravite;
      }
      L("");
      L("  " + (i + 1) + ". " + p.texte);
      if (p.detail) {
        p.detail.match(/.{1,88}(\s|$)/g).forEach((l) => L("     " + l.trim()));
      }
    });
  }

  L("");
  L("");
  L("  Ce diagnostic n'a rien modifié. Aucun lot n'a été développé : envoyez-moi ce rapport et");
  L("  nous déciderons de la suite ensemble.");
  L("");

  fs.writeFileSync(sortie, lignes.join("\r\n"), "utf-8");
  console.log("");
  console.log("  Rapport écrit dans : " + path.resolve(sortie));
  console.log("");
  const bloquants = problemes.filter((p) => p.gravite === "bloquant").length;
  const moyens = problemes.filter((p) => p.gravite === "moyen").length;
  console.log("  " + bloquants + " point(s) à corriger avant d'installer, " + moyens + " point(s) à regarder.");
  console.log("");
}

try {
  // Un dossier de données peut être imposé en second argument, si la base n'est pas à sa place
  // habituelle.
  if (process.argv[3]) dossierImpose = process.argv[3];
  main();
} catch (err) {
  console.error("");
  console.error("  Le diagnostic s'est interrompu : " + (err && err.message));
  console.error("");
  console.error("  Rien n'a été modifié. Envoyez-moi ce message et je corrige le script.");
  console.error(err && err.stack);
  process.exit(1);
}
