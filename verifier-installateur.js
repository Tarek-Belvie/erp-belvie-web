// ================================================================================================
// VÉRIFICATION DE L'INSTALLATEUR FABRIQUÉ — lot 3
// ================================================================================================
//
// Lancé automatiquement par « npm run installateur », juste après la fabrication. Il vérifie
// ce qu'on ne peut constater qu'une fois l'application empaquetée, et qui casse silencieusement
// quand c'est faux :
//
//   - les modules compilés (better-sqlite3, sharp) sont-ils EXTRAITS de l'archive app.asar ?
//     Restés dedans, ils ne se chargent pas, et l'application ne démarre pas du tout ;
//   - l'interface construite est-elle bien embarquée ?
//   - le numéro de version de l'installateur correspond-il à celui du projet ?
//   - la désinstallation effacerait-elle vos données ? (elle ne doit pas)
//
// CE SCRIPT NE MODIFIE RIEN quand il vérifie. Il lit le dossier `release` et rend un verdict.
// Deux modes annexes, en bas de fichier, s'ajoutent à la vérification :
//   --prerequis  (lecture seule) : l'icône est-elle prête, AVANT de lancer la fabrication ?
//   --archiver   : conserve une copie du .exe dans `release\installateurs`. C'est la SEULE
//                  écriture de ce fichier, elle reste dans le dossier du projet, et n'efface rien.

const fs = require("fs");
const path = require("path");

const controles = [];
function ok(nom, detail) { controles.push({ nom, etat: "ok", detail: detail || "" }); }
function echec(nom, detail) { controles.push({ nom, etat: "echec", detail: detail || "" }); }
function info(nom, detail) { controles.push({ nom, etat: "info", detail: detail || "" }); }

function octets(n) {
  const u = ["o", "Ko", "Mo", "Go"];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)) + " " + u[i];
}

function listerRecursif(racine) {
  const out = [];
  if (!fs.existsSync(racine)) return out;
  const pile = [racine];
  while (pile.length) {
    const courant = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(courant, { withFileTypes: true }); } catch (_) { continue; }
    for (const e of entrees) {
      const complet = path.join(courant, e.name);
      if (e.isDirectory()) pile.push(complet);
      else out.push(complet);
    }
  }
  return out;
}

function main() {
  const projet = process.cwd();
  const release = path.join(projet, "release");
  const pkg = JSON.parse(fs.readFileSync(path.join(projet, "package.json"), "utf-8"));

  console.log("");
  console.log("  VÉRIFICATION DE L'INSTALLATEUR");
  console.log("  " + "-".repeat(70));

  if (!fs.existsSync(release)) {
    echec("Le dossier release existe", "La fabrication n'a produit aucun dossier release.");
    return rendre();
  }

  // --- 1. L'installateur lui-même ---------------------------------------------------------------
  const exes = fs.readdirSync(release).filter((n) => n.toLowerCase().endsWith(".exe"));
  if (exes.length === 0) {
    echec("Un installateur .exe a été produit", "Aucun fichier .exe dans " + release);
  } else {
    const principal = exes.find((n) => /setup/i.test(n)) || exes[0];
    const taille = fs.statSync(path.join(release, principal)).size;
    ok("Un installateur .exe a été produit", principal + "  (" + octets(taille) + ")");
    if (principal.indexOf(pkg.version) === -1) {
      echec("Le nom de l'installateur porte la version du projet",
        "attendu « " + pkg.version + " » dans « " + principal + " »");
    } else {
      ok("Le nom de l'installateur porte la version du projet", "version " + pkg.version);
    }
  }

  // --- 2. L'application décompressée ------------------------------------------------------------
  const unpacked = path.join(release, "win-unpacked");
  if (!fs.existsSync(unpacked)) {
    info("Le dossier win-unpacked est présent",
      "absent — la vérification des modules compilés n'a pas pu être faite");
    return rendre();
  }
  const resources = path.join(unpacked, "resources");

  if (fs.existsSync(path.join(resources, "app.asar"))) {
    ok("L'application est empaquetée (app.asar)",
      octets(fs.statSync(path.join(resources, "app.asar")).size));
  } else {
    echec("L'application est empaquetée (app.asar)", "app.asar introuvable dans " + resources);
  }

  // --- 3. LE contrôle qui compte : les modules compilés sont-ils extraits ? ----------------------
  // Un .node resté dans app.asar ne peut pas être chargé par Node. L'application ne démarre alors
  // pas du tout — panne franche, mais qu'on ne découvre qu'en lançant le .exe sur une machine.
  const horsAsar = path.join(resources, "app.asar.unpacked");
  const natifs = listerRecursif(horsAsar).filter((f) => f.toLowerCase().endsWith(".node"));
  const parModule = {};
  natifs.forEach((f) => {
    const m = f.replace(/\\/g, "/").match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
    const nom = m ? m[1] : "(inconnu)";
    parModule[nom] = (parModule[nom] || 0) + 1;
  });

  if (natifs.length === 0) {
    echec("Les modules compilés sont extraits de l'archive",
      "Aucun fichier .node hors de app.asar. L'application ne démarrera pas. "
      + "Vérifiez la section « asarUnpack » de package.json.");
  } else {
    ok("Les modules compilés sont extraits de l'archive",
      natifs.length + " fichier(s) .node — " + Object.keys(parModule).join(", "));
  }

  ["better-sqlite3", "sharp"].forEach((mod) => {
    const present = Object.keys(parModule).some((k) => k === mod || k.indexOf(mod) !== -1)
      || fs.existsSync(path.join(horsAsar, "node_modules", mod));
    if (present) ok("Le module « " + mod + " » est extrait", "");
    else echec("Le module « " + mod + " » est extrait",
      "introuvable hors de app.asar — l'application ne pourra pas s'en servir");
  });

  // --- 4. Les réglages qui protègent vos données ------------------------------------------------
  const nsis = (pkg.build && pkg.build.nsis) || {};
  if (nsis.deleteAppDataOnUninstall === false) {
    ok("La désinstallation NE supprimera PAS vos données", "deleteAppDataOnUninstall: false");
  } else {
    echec("La désinstallation NE supprimera PAS vos données",
      "deleteAppDataOnUninstall vaut " + String(nsis.deleteAppDataOnUninstall)
      + " — vos données pourraient être effacées à la désinstallation !");
  }
  if (nsis.perMachine === false) ok("Aucun mot de passe administrateur ne sera demandé", "perMachine: false");
  else echec("Aucun mot de passe administrateur ne sera demandé", "perMachine vaut " + String(nsis.perMachine));

  // --- 5. Le dossier de données est bien fixé (lot 1) -------------------------------------------
  const main_js = fs.readFileSync(path.join(projet, "electron", "main.js"), "utf-8");
  if (/app\.setPath\("userData"/.test(main_js)) {
    ok("Le dossier de données est fixé (lot 1)", "l'application installée ouvrira %APPDATA%\\belvie-erp");
  } else {
    echec("Le dossier de données est fixé (lot 1)",
      "app.setPath absent de main.js — l'application installée s'ouvrirait sur une base VIDE");
  }
  if (/requestSingleInstanceLock/.test(main_js)) ok("La protection contre les instances simultanées est présente", "");
  else echec("La protection contre les instances simultanées est présente", "");

  return rendre();
}

function rendre() {
  const large = controles.reduce((m, c) => Math.max(m, c.nom.length), 0);
  controles.forEach((c) => {
    const etiquette = c.etat === "ok" ? "OK    " : c.etat === "echec" ? "ÉCHEC " : "info  ";
    console.log("  " + etiquette + c.nom.padEnd(large + 2) + (c.detail || ""));
  });
  const echecs = controles.filter((c) => c.etat === "echec").length;
  console.log("  " + "-".repeat(70));
  if (echecs === 0) {
    console.log("  Tout est conforme. L'installateur peut être essayé.");
  } else {
    console.log("  " + echecs + " PROBLÈME(S). N'installez pas avant de les avoir réglés.");
  }
  console.log("");
  process.exitCode = echecs === 0 ? 0 : 1;
}

// ------------------------------------------------------------------------------------------------
// Les deux modes annexes, demandés explicitement en ligne de commande
// ------------------------------------------------------------------------------------------------
/** AVANT de fabriquer : l'icône est-elle prête ? S'arrêter ici coûte une seconde ; s'arrêter au
 *  milieu d'electron-builder coûte plusieurs minutes et un message illisible. */
function prerequis() {
  const projet = process.cwd();
  const icone = path.join(projet, "build", "icon.ico");
  console.log("");
  if (!fs.existsSync(icone)) {
    console.error("  L'icône build\\icon.ico est absente.");
    console.error("");
    console.error("  Préparez-la d'abord :");
    console.error("      npm run icone            (aperçu seulement, rien n'est figé)");
    console.error("      npm run icone:valider    (écrit build\\icon.ico)");
    console.error("");
    process.exit(1);
  }
  console.log("  Icône présente : " + icone + "  (" + octets(fs.statSync(icone).size) + ")");
  console.log("");
}

/**
 * APRÈS la fabrication : conserve une copie de l'installateur.
 *
 * C'est le seul mode de ce fichier qui ÉCRIT quelque chose, et il n'écrit que dans
 * `release\installateurs`, à l'intérieur du dossier du projet. Il ne supprime jamais rien : c'est
 * cette accumulation qui permet de revenir à une version précédente.
 */
function archiver() {
  const release = path.join(process.cwd(), "release");
  const dest = path.join(release, "installateurs");
  console.log("");
  if (!fs.existsSync(release)) {
    console.log("  Aucun dossier release : rien à conserver.");
    console.log("");
    return;
  }
  fs.mkdirSync(dest, { recursive: true });
  let copies = 0;
  fs.readdirSync(release).filter((n) => n.toLowerCase().endsWith(".exe")).forEach((n) => {
    const cible = path.join(dest, n);
    if (fs.existsSync(cible)) return;          // jamais d'écrasement
    fs.copyFileSync(path.join(release, n), cible);
    copies += 1;
    console.log("  Conservé : " + cible);
  });
  if (copies === 0) console.log("  Déjà conservé, rien de nouveau.");
  console.log("");
  console.log("  Les installateurs de " + dest);
  console.log("  ne sont jamais effacés : c'est ce qui permet de revenir à une version précédente.");
  console.log("");
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.some((a) => /^--?prerequis$/i.test(a))) { prerequis(); process.exit(0); }
  if (args.some((a) => /^--?archiver$/i.test(a))) { archiver(); process.exit(0); }
  try { main(); } catch (err) {
    console.error("");
    console.error("  La vérification s'est interrompue : " + (err && err.message));
    console.error("");
    process.exit(1);
  }
}
