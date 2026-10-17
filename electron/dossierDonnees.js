// ================================================================================================
// LE DOSSIER DE DONNÉES — lot 1
// ================================================================================================
//
// LE PROBLÈME. Electron range les données dans `%APPDATA%\<nom de l'application>`. En
// développement ce nom vient de `package.json` → `belvie-erp`, et c'est là que vivent vos
// données. Une fois empaquetée, l'application prend le nom de `build.productName` → `Belvie ERP`,
// avec l'espace et les majuscules. **La version installée s'ouvrirait donc sur une base vide**,
// sans que rien à l'écran ne l'explique.
//
// LA CORRECTION. Le dossier est FIXÉ ici, une fois pour toutes, et ne dépend plus du nom que
// porte l'application. Quel que soit le `productName` de demain, les deux versions ouvrent le
// même dossier.
//
// POURQUOI C'EST SANS DANGER. Le diagnostic du lot 0 l'a vérifié sur vos données : aucun chemin
// absolu n'est stocké en base — `photos.js` et `ficheTechnique.js` écrivent tous les chemins
// d'images RELATIVEMENT au dossier de données. Fixer le dossier ne demande donc aucune
// réécriture, aucun déplacement, aucune migration.
//
// CE MODULE NE DÉPLACE NI NE FUSIONNE JAMAIS RIEN. Il résout un chemin, et il constate. S'il
// trouve un second dossier contenant des données, il le décrit et s'arrête là : deux bases
// contenant chacune des commandes ne peuvent pas être réunies sans arbitrer des conflits de
// numérotation, et un arbitrage automatique produirait un historique faux que personne ne
// pourrait plus démêler.

const fs = require("fs");
const path = require("path");

/** Le nom du dossier, définitif. C'est celui où sont vos données aujourd'hui — décision n° 2. */
const NOM_DOSSIER = "belvie-erp";

/** L'autre nom, celui qu'aurait pris la version empaquetée sans cette correction. Conservé ici
 *  uniquement pour savoir où regarder. */
const NOM_EMPAQUETE = "Belvie ERP";

const NOM_BASE = "belvie.db";

/** Le chemin définitif du dossier de données. `appData` vaut `%APPDATA%` sous Windows. */
function cheminDonnees(appData) {
  return path.join(appData, NOM_DOSSIER);
}

/** Les tables dont le nombre de lignes dit si un dossier contient de vraies données. */
const TABLES_TEMOIN = ["commandes", "articles", "fiches_techniques"];

function compterSansErreur(db, table) {
  try { return db.prepare("SELECT COUNT(*) AS n FROM " + table).get().n; }
  catch (_) { return null; }
}

function mesurerImages(dossier) {
  const racine = path.join(dossier, "images");
  if (!fs.existsSync(racine)) return 0;
  let n = 0;
  const pile = [racine];
  while (pile.length) {
    const courant = pile.pop();
    let entrees;
    try { entrees = fs.readdirSync(courant, { withFileTypes: true }); } catch (_) { continue; }
    entrees.forEach((e) => {
      // `courant` et non `racine` : sans cela, les sous-dossiers ne seraient jamais parcourus et
      // les vignettes, par exemple, ne compteraient pas.
      if (e.isDirectory()) pile.push(path.join(courant, e.name));
      else n += 1;
    });
  }
  return n;
}

/**
 * Tous les dossiers de données présents sur la machine, décrits.
 *
 * On ne se limite pas aux deux noms attendus : un troisième dossier, pour une raison quelconque,
 * doit se voir. `ouvrirBase` est injecté (chemin -> base en lecture seule) pour que ce module ne
 * dépende ni d'Electron ni de better-sqlite3, et reste éprouvable hors application.
 */
function inventorier(appData, ouvrirBase) {
  const trouves = [];
  const vus = new Set();

  function examiner(dossier, raison) {
    const cle = dossier.toLowerCase();
    if (vus.has(cle)) return;
    vus.add(cle);
    const base = path.join(dossier, NOM_BASE);
    if (!fs.existsSync(base)) return;

    const st = fs.statSync(base);
    const entree = {
      dossier,
      base,
      raison,
      octets: st.size,
      modifie: st.mtime.toISOString(),
      images: mesurerImages(dossier),
      comptages: {},
      lisible: false,
      erreur: null,
    };

    if (typeof ouvrirBase === "function") {
      let db = null;
      try {
        db = ouvrirBase(base);
        // Une vraie lecture, AVANT de déclarer la base lisible : certains moteurs n'ouvrent le
        // fichier qu'à la première requête, et un fichier qui n'est pas une base SQLite passerait
        // alors pour lisible avec des comptages « inconnus ». Un dossier corrompu annoncé comme
        // valable serait pire que pas d'annonce du tout.
        db.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get();
        entree.lisible = true;
        TABLES_TEMOIN.forEach((t) => { entree.comptages[t] = compterSansErreur(db, t); });
      } catch (err) {
        entree.erreur = err && err.message ? err.message : String(err);
      } finally {
        if (db && typeof db.close === "function") { try { db.close(); } catch (_) {} }
      }
    }
    entree.contient_des_donnees = TABLES_TEMOIN.some((t) => (entree.comptages[t] || 0) > 0);
    trouves.push(entree);
  }

  examiner(cheminDonnees(appData), "dossier définitif de l'application");
  examiner(path.join(appData, NOM_EMPAQUETE), "nom qu'aurait pris la version installée");

  try {
    fs.readdirSync(appData, { withFileTypes: true }).forEach((e) => {
      if (!e.isDirectory()) return;
      if (e.name.toLowerCase().replace(/[\s_-]/g, "").indexOf("belvie") === -1) return;
      examiner(path.join(appData, e.name), "trouvé par balayage");
    });
  } catch (_) { /* dossier illisible : les deux noms attendus suffisent */ }

  return trouves;
}

/**
 * Y a-t-il un conflit à signaler ?
 *
 * Conflit = un AUTRE dossier que le dossier définitif contient de vraies données. C'est le seul
 * cas qui demande une décision humaine. Un dossier vide ou résiduel n'en est pas un : on le
 * signale pour information, et rien de plus.
 *
 * Aucune donnée n'est déplacée, copiée ni supprimée par cette fonction. Elle rend un constat.
 */
function analyser(appData, ouvrirBase) {
  const tous = inventorier(appData, ouvrirBase);
  const definitif = cheminDonnees(appData).toLowerCase();
  const principal = tous.find((d) => d.dossier.toLowerCase() === definitif) || null;
  const autres = tous.filter((d) => d.dossier.toLowerCase() !== definitif);
  const avecDonnees = autres.filter((d) => d.contient_des_donnees);

  // Une base illisible n'est pas un « dossier avec des données » : on ne peut rien en affirmer.
  // Elle mérite pourtant d'être signalée, et elle l'est à part.
  const illisibles = tous.filter((d) => d.erreur !== null);

  return {
    dossier_definitif: cheminDonnees(appData),
    principal,
    autres,
    illisibles,
    conflit: avecDonnees.length > 0,
    autres_avec_donnees: avecDonnees,
    // Le cas « le dossier définitif est vide mais un autre contient tout » mérite son propre nom :
    // c'est ce qui arriverait à quelqu'un ayant lancé la version installée avant cette correction.
    inversion: !!(avecDonnees.length > 0 && (!principal || !principal.contient_des_donnees)),
  };
}

/** Le texte montré à l'utilisateur. Écrit ici plutôt que dans main.js pour qu'il soit éprouvable
 *  — un message d'alerte qui se trompe de chiffres est pire que pas d'alerte. */
function messageConflit(analyse) {
  const decrire = (d) => {
    const c = d.comptages || {};
    return "  " + d.dossier + "\n"
      + "      base : " + (d.octets / (1024 * 1024)).toFixed(1) + " Mo, modifiée le "
      + String(d.modifie).slice(0, 10) + "\n"
      + "      contenu : " + (c.commandes != null ? c.commandes : "?") + " commandes, "
      + (c.articles != null ? c.articles : "?") + " articles, "
      + (c.fiches_techniques != null ? c.fiches_techniques : "?") + " fiches techniques, "
      + d.images + " images";
  };

  const lignes = [];
  lignes.push("Deux dossiers de données ont été trouvés sur cet ordinateur.");
  lignes.push("");
  lignes.push("CELUI QUE L'APPLICATION UTILISE :");
  lignes.push(analyse.principal ? decrire(analyse.principal)
    : "  " + analyse.dossier_definitif + "\n      (vide pour l'instant)");
  lignes.push("");
  lignes.push("L'AUTRE :");
  analyse.autres_avec_donnees.forEach((d) => lignes.push(decrire(d)));
  lignes.push("");
  if (analyse.inversion) {
    lignes.push("ATTENTION : le dossier utilisé est vide alors que l'autre contient vos données.");
    lignes.push("N'utilisez pas l'application avant d'avoir décidé quoi faire — vous risqueriez");
    lignes.push("de créer de nouvelles données dans le dossier vide.");
  } else {
    lignes.push("Vos données sont dans le premier. Le second est probablement un reste d'un essai");
    lignes.push("de version installée.");
  }
  lignes.push("");
  lignes.push("AUCUNE DONNÉE N'A ÉTÉ DÉPLACÉE, COPIÉE NI SUPPRIMÉE, et aucune ne le sera sans");
  lignes.push("votre instruction. Faites une sauvegarde complète, puis signalez-le.");
  if ((analyse.illisibles || []).length > 0) {
    lignes.push("");
    lignes.push("Par ailleurs, ce ou ces fichiers n'ont pas pu être lus comme une base de données :");
    analyse.illisibles.forEach((d) => lignes.push("  " + d.base));
  }
  return lignes.join("\n");
}

module.exports = {
  NOM_DOSSIER, NOM_EMPAQUETE, NOM_BASE, TABLES_TEMOIN,
  cheminDonnees, inventorier, analyser, messageConflit,
};
