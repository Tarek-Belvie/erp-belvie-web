// ================================================================================================
// L'OUTILLAGE QUE ELECTRON-BUILDER TÉLÉCHARGE — préparé une fois, sans droits administrateur
// ================================================================================================
//
// LE PROBLÈME, EN UNE PHRASE.
//
// Pour écrire l'icône et le numéro de version dans « Belvie ERP.exe », electron-builder utilise
// l'outil `rcedit`. Cet outil est livré dans une archive unique — `winCodeSign-2.6.0.7z` — qui
// contient AUSSI les outils de signature de macOS et de Linux. Or cette archive renferme deux
// liens symboliques macOS :
//
//     darwin/10.12/lib/libcrypto.dylib  ->  libcrypto.1.0.0.dylib
//     darwin/10.12/lib/libssl.dylib     ->  libssl.1.0.0.dylib
//
// Créer un lien symbolique sous Windows demande un privilège réservé aux administrateurs. La
// décompression échoue donc sur ces deux entrées, et toute la fabrication s'arrête :
//
//     ERROR: Cannot create symbolic link : Le client ne dispose pas d'un privilège nécessaire.
//
// Rien de macOS n'est « construit » : ce sont simplement deux membres d'une archive commune.
// Et ces deux liens ne servent à rien ici — nous ne signons pas, et nous ne visons pas macOS.
//
// LA CORRECTION, EN UNE PHRASE.
//
// Décompresser l'archive NOUS-MÊMES, une seule fois, en excluant ces deux liens, puis les
// remplacer par de vraies copies. electron-builder trouve alors son outillage déjà en place et
// ne décompresse plus rien : il n'y a plus de lien symbolique à créer, donc plus de privilège à
// demander. Vérifié : avec le dossier déjà rempli, l'outil d'electron-builder se contente d'en
// afficher le chemin.
//
// CE QUE CE SCRIPT ÉCRIT, ET OÙ.
//
// Uniquement dans le cache d'electron-builder, c'est-à-dire
// %LOCALAPPDATA%\electron-builder\Cache\winCodeSign — le dossier que la fabrication remplirait
// elle-même si elle y arrivait. Il ne touche NI au projet, NI à %APPDATA%\belvie-erp. Il ne
// supprime que ses propres fichiers temporaires, et seulement ceux qu'il vient de créer.
//
// Lancement :  npm run installateur:outils     (appelé aussi par npm run installateur)

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { execFileSync } = require("child_process");

const VERSION = "winCodeSign-2.6.0";
const ARCHIVE = VERSION + ".7z";
const URL = "https://github.com/electron-userland/electron-builder-binaries/releases/download/"
  + VERSION + "/" + ARCHIVE;

/** Empreinte publiée par electron-builder lui-même (app-builder-lib 26, toolsets/windows.js).
 *  Elle sert à refuser une archive altérée ou tronquée : un téléchargement incomplet donnerait
 *  un outillage incomplet, et une erreur incompréhensible trois minutes plus tard. */
const SHA256 = "cdaec7154dda7cc31f88d886e2489379a0625a737d610b5ae7f62a12f16743a4";

/** Les deux seuls liens symboliques de l'archive — vérifié entrée par entrée sur les 96 qu'elle
 *  contient. On les exclut par nom, sans chemin : la correspondance ne dépend alors pas du sens
 *  des séparateurs de dossiers. */
const LIENS = [
  { lien: "libcrypto.dylib", cible: "libcrypto.1.0.0.dylib" },
  { lien: "libssl.dylib", cible: "libssl.1.0.0.dylib" },
];

/** Ce qui prouve que l'outillage est utilisable : l'outil dont la fabrication a besoin, et
 *  l'outil de signature, qui montre que l'archive a été décompressée en entier. */
const TEMOINS = [
  "rcedit-x64.exe",
  path.join("windows-10", "x64", "signtool.exe"),
];

function cacheElectronBuilder() {
  if (process.env.ELECTRON_BUILDER_CACHE) return process.env.ELECTRON_BUILDER_CACHE;
  if (process.platform === "win32") {
    const local = process.env.LOCALAPPDATA
      || path.join(process.env.USERPROFILE || "", "AppData", "Local");
    return path.join(local, "electron-builder", "Cache");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Caches", "electron-builder");
  }
  return path.join(process.env.HOME || "", ".cache", "electron-builder");
}

function sha256(fichier) {
  return crypto.createHash("sha256").update(fs.readFileSync(fichier)).digest("hex");
}

function octets(n) {
  const u = ["o", "Ko", "Mo"];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(1)) + " " + u[i];
}

function compter(racine) {
  let n = 0;
  const pile = [racine];
  while (pile.length) {
    const courant = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(courant, { withFileTypes: true }); } catch (_) { continue; }
    // Le chemin doit être construit depuis le dossier COURANT, pas depuis la racine : sinon les
    // sous-dossiers ne sont jamais parcourus et le compte est faux sans que rien ne le signale.
    entrees.forEach((e) => { n += 1; if (e.isDirectory()) pile.push(path.join(courant, e.name)); });
  }
  return n;
}

/** Le 7za livré avec le projet (dépendance de electron-builder, déjà installée par npm install).
 *  C'est le même programme que celui qu'emploie la fabrication — à ceci près que nous lui
 *  passons, nous, de quoi laisser les deux liens de côté. */
function chemin7za() {
  const direct = path.join(process.cwd(), "node_modules", "7zip-bin",
    process.platform === "win32" ? "win" : process.platform === "darwin" ? "mac" : "linux",
    process.arch, process.platform === "win32" ? "7za.exe" : "7za");
  if (fs.existsSync(direct)) return direct;
  try { return require("7zip-bin").path7za; } catch (_) {}
  throw new Error(
    "Le décompresseur 7za est introuvable.\n"
    + "Lancez d'abord npm install dans le dossier du projet."
  );
}

function telecharger(url, destination, redirections) {
  if ((redirections || 0) > 5) throw new Error("Trop de redirections en téléchargeant " + ARCHIVE);
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "belvie-erp-build" } }, (rep) => {
      if (rep.statusCode >= 300 && rep.statusCode < 400 && rep.headers.location) {
        rep.resume();
        return telecharger(rep.headers.location, destination, (redirections || 0) + 1)
          .then(resolve, reject);
      }
      if (rep.statusCode !== 200) {
        rep.resume();
        return reject(new Error("Téléchargement refusé (HTTP " + rep.statusCode + ") : " + url));
      }
      const sortie = fs.createWriteStream(destination);
      rep.pipe(sortie);
      sortie.on("finish", () => sortie.close(() => resolve()));
      sortie.on("error", reject);
    }).on("error", reject);
  });
}

/** Une archive déjà téléchargée par une fabrication précédente, et restée dans le cache.
 *  On ne s'en sert que si son empreinte est la bonne. */
function archiveDejaPresente(dossierWinCodeSign) {
  if (!fs.existsSync(dossierWinCodeSign)) return null;
  const candidats = fs.readdirSync(dossierWinCodeSign).filter((n) => n.toLowerCase().endsWith(".7z"));
  for (const n of candidats) {
    const complet = path.join(dossierWinCodeSign, n);
    try { if (sha256(complet) === SHA256) return complet; } catch (_) {}
  }
  return null;
}

async function main() {
  const cache = cacheElectronBuilder();
  const dossierWinCodeSign = path.join(cache, "winCodeSign");
  const destination = path.join(dossierWinCodeSign, VERSION);

  console.log("");
  console.log("  OUTILLAGE DE FABRICATION");
  console.log("  " + "-".repeat(70));
  console.log("  Cache electron-builder : " + cache);

  // --- Déjà prêt ? Alors ne rien faire. Le script est fait pour être relancé sans conséquence.
  const manquants = TEMOINS.filter((t) => !fs.existsSync(path.join(destination, t)));
  if (manquants.length === 0) {
    console.log("  Outillage déjà en place : " + destination);
    console.log("  Rien à faire.");
    console.log("");
    return;
  }

  // --- L'archive : réutilisée si elle est déjà là et intacte, téléchargée sinon.
  fs.mkdirSync(dossierWinCodeSign, { recursive: true });
  let archive = archiveDejaPresente(dossierWinCodeSign);
  let temporaireTelechargee = null;
  if (archive) {
    console.log("  Archive déjà téléchargée, empreinte vérifiée : " + path.basename(archive));
  } else {
    console.log("  Téléchargement de " + ARCHIVE + " (5,4 Mo environ)…");
    temporaireTelechargee = path.join(dossierWinCodeSign, "belvie-" + process.pid + ".7z");
    await telecharger(URL, temporaireTelechargee);
    const reel = sha256(temporaireTelechargee);
    if (reel !== SHA256) {
      fs.unlinkSync(temporaireTelechargee);     // notre propre fichier, créé à l'instant
      throw new Error(
        "L'archive téléchargée ne correspond pas à l'empreinte attendue.\n"
        + "  attendu : " + SHA256 + "\n  obtenu  : " + reel + "\n"
        + "Rien n'a été installé. Relancez : un téléchargement a pu être interrompu."
      );
    }
    archive = temporaireTelechargee;
    console.log("  Téléchargée et vérifiée (" + octets(fs.statSync(archive).size) + ")");
  }

  // --- La décompression, SANS les deux liens symboliques.
  // Dans un dossier temporaire, renommé seulement à la fin : une décompression interrompue ne
  // doit pas laisser un outillage incomplet qu'electron-builder prendrait pour complet.
  const provisoire = destination + ".en-cours-" + process.pid + "-" + Date.now();
  fs.mkdirSync(provisoire, { recursive: false });   // jamais sur un dossier existant

  const sept = chemin7za();
  const args = ["x", "-bd", "-y"]
    .concat(LIENS.map((l) => "-xr!" + l.lien))
    .concat(["-o" + provisoire, archive]);
  console.log("  Décompression sans les deux liens symboliques macOS…");
  try {
    execFileSync(sept, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf-8" });
  } catch (e) {
    throw new Error(
      "La décompression a échoué.\n"
      + ((e.stdout || "") + (e.stderr || "")).split("\n").slice(-8).join("\n")
    );
  }

  // --- Les deux liens, remplacés par de vraies copies.
  LIENS.forEach((l) => {
    const dossier = path.join(provisoire, "darwin", "10.12", "lib");
    const source = path.join(dossier, l.cible);
    if (!fs.existsSync(source)) {
      throw new Error("Archive inattendue : " + l.cible + " est absent après décompression.");
    }
    fs.copyFileSync(source, path.join(dossier, l.lien));
  });

  // --- Et seulement maintenant, la mise en place.
  if (fs.existsSync(destination)) {
    // Un reste de décompression ratée : on le met de côté, on ne l'efface pas.
    fs.renameSync(destination, destination + ".incomplet-" + Date.now());
    console.log("  Un outillage incomplet était présent : mis de côté, pas supprimé.");
  }
  fs.renameSync(provisoire, destination);
  if (temporaireTelechargee && fs.existsSync(temporaireTelechargee)) {
    fs.unlinkSync(temporaireTelechargee);       // notre propre fichier, créé à l'instant
  }

  // --- Vérification : l'outillage est-il réellement utilisable ?
  const encoreManquants = TEMOINS.filter((t) => !fs.existsSync(path.join(destination, t)));
  if (encoreManquants.length > 0) {
    throw new Error("Outillage incomplet après décompression : " + encoreManquants.join(", "));
  }
  console.log("  Outillage en place : " + destination);
  console.log("  " + compter(destination) + " entrées, aucun lien symbolique.");
  console.log("");
  console.log("  La fabrication n'aura plus à décompresser cette archive,");
  console.log("  donc plus de lien symbolique à créer, donc aucun droit administrateur.");
  console.log("");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("");
    console.error("  " + (err && err.message ? err.message : String(err)));
    console.error("");
    console.error("  Le cache d'electron-builder n'a pas été modifié de façon incomplète,");
    console.error("  et ni le projet ni vos données n'ont été touchés.");
    console.error("");
    process.exit(1);
  });
}

module.exports = { cacheElectronBuilder, chemin7za, LIENS, TEMOINS, VERSION, SHA256, URL };
