// ================================================================================================
// L'ICÔNE WINDOWS, À PARTIR DE VOTRE LOGO — lot 3
// ================================================================================================
//
// DEUX TEMPS, ET C'EST VOULU.
//
//   1. Sans option, ce script ne fabrique QU'UN APERÇU : `build\apercu-icone.png`. Il ne crée pas
//      l'icône, il ne touche à rien d'autre. Vous regardez, et vous décidez.
//   2. Avec l'option /valider, et seulement alors, il écrit `build\icon.ico`.
//
// C'est votre consigne, prise au mot : rien n'est figé avant votre validation.
//
// IL NE MODIFIE JAMAIS VOTRE LOGO. Le fichier d'origine est lu, jamais réécrit, jamais déplacé.
//
// Lancement, depuis le dossier du projet, avec les outils déjà installés :
//     npm run icone              (aperçu seulement, rien n'est figé)
//     npm run icone:valider      (écrit build\icon.ico)

const fs = require("fs");
const path = require("path");

const TAILLES_ICO = [16, 24, 32, 48, 64, 128, 256];
/** Windows affiche l'icône à ces trois tailles-là dans 95 % des cas : le menu Démarrer, la barre
 *  des tâches, et l'explorateur en grandes icônes. C'est ce que l'aperçu doit montrer. */
const TAILLES_APERCU = [256, 48, 32, 16];

const VERT = "#1F3A2E";

function dossierDonnees() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "belvie-erp");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "belvie-erp");
  }
  return path.join(process.env.HOME || "", ".config", "belvie-erp");
}

/** Le logo tel que l'application le connaît : le chemin est en base, relatif au dossier de
 *  données. On le lit là plutôt que de deviner un nom de fichier. */
function trouverLogo() {
  const dossier = dossierDonnees();
  const base = path.join(dossier, "belvie.db");
  if (!fs.existsSync(base)) {
    throw new Error("Base de données introuvable : " + base);
  }
  let db = null;
  try {
    const Database = require("better-sqlite3");
    db = new Database(base, { readonly: true, fileMustExist: true });
  } catch (_) {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(base, { readOnly: true });
  }
  let relatif = null;
  try {
    const row = db.prepare(
      "SELECT logo_path FROM entreprise WHERE logo_path IS NOT NULL AND logo_path <> ''"
    ).get();
    relatif = row ? row.logo_path : null;
  } finally {
    try { db.close(); } catch (_) {}
  }
  if (!relatif) {
    throw new Error(
      "Aucun logo n'est enregistré dans la fiche Entreprise.\n"
      + "Déposez-en un dans Paramètres -> Entreprise, puis relancez."
    );
  }
  const absolu = path.join(dossier, String(relatif).split("/").join(path.sep));
  if (!fs.existsSync(absolu)) {
    throw new Error("Le logo est enregistré (" + relatif + ") mais le fichier est absent :\n" + absolu);
  }
  return { relatif, absolu };
}

// ------------------------------------------------------------------------------------------------
// L'assemblage du fichier .ico
// ------------------------------------------------------------------------------------------------
/**
 * Un fichier ICO est un en-tête de 6 octets, puis une entrée de 16 octets par image, puis les
 * images elles-mêmes. Depuis Windows Vista, une entrée peut être un PNG tel quel — ce qui évite
 * d'avoir à produire du bitmap non compressé, et donne un fichier bien plus léger.
 *
 * Écrit à la main plutôt qu'avec une bibliothèque : ajouter une dépendance juste avant votre
 * première fabrication d'installateur serait exactement le mauvais moment.
 */
function assemblerIco(images) {
  const n = images.length;
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0);
  entete.writeUInt16LE(1, 2);     // 1 = icône
  entete.writeUInt16LE(n, 4);

  const entrees = Buffer.alloc(16 * n);
  let decalage = 6 + 16 * n;
  images.forEach((img, i) => {
    const o = i * 16;
    // 256 s'écrit 0 : le champ ne fait qu'un seul octet.
    const t = img.taille >= 256 ? 0 : img.taille;
    entrees.writeUInt8(t, o);
    entrees.writeUInt8(t, o + 1);
    entrees.writeUInt8(0, o + 2);
    entrees.writeUInt8(0, o + 3);
    entrees.writeUInt16LE(1, o + 4);
    entrees.writeUInt16LE(32, o + 6);
    entrees.writeUInt32LE(img.donnees.length, o + 8);
    entrees.writeUInt32LE(decalage, o + 12);
    decalage += img.donnees.length;
  });

  return Buffer.concat([entete, entrees].concat(images.map((i) => i.donnees)));
}

// ------------------------------------------------------------------------------------------------
// Le rendu
// ------------------------------------------------------------------------------------------------
/**
 * Redimensionne le logo dans un carré, sur fond transparent, sans le déformer.
 *
 * `fit: "contain"` et non `"cover"` : un logo rectangulaire recadré en carré perdrait une partie
 * de lui-même, et personne ne s'en apercevrait avant de voir l'icône dans la barre des tâches.
 * Une marge de 8 % évite que le dessin touche les bords, ce qui ferait tache à côté des autres
 * icônes de Windows.
 */
async function carre(sharp, source, taille) {
  const interieur = Math.max(1, Math.round(taille * 0.84));
  const contenu = await sharp(source)
    .resize(interieur, interieur, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  const marge = Math.round((taille - interieur) / 2);
  return sharp({
    create: { width: taille, height: taille, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: contenu, top: marge, left: marge }])
    .png()
    .toBuffer();
}

function etiquette(texte, largeur, couleur) {
  const svg = '<svg width="' + largeur + '" height="22" xmlns="http://www.w3.org/2000/svg">'
    + '<text x="0" y="16" font-family="Segoe UI, Arial, sans-serif" font-size="13" fill="'
    + couleur + '">' + texte + "</text></svg>";
  return Buffer.from(svg);
}

/**
 * La planche d'aperçu : les tailles RÉELLES, sur fond clair ET sur fond sombre — Windows affiche
 * les deux selon le thème, et un logo sombre disparaît sur une barre des tâches sombre.
 *
 * La hauteur est CALCULÉE à partir des tailles affichées, jamais fixée à la main : écrite en dur,
 * elle devenait trop courte dès qu'une taille changeait, et la composition échouait.
 */
async function planche(sharp, source) {
  const MARGE = 40;
  // Assez large pour la marge, l'icône la plus grande, un écart, puis le libellé.
  const COLONNE = MARGE + 256 + 24 + 140 + MARGE;
  const LARGEUR = COLONNE * 2 - 20;
  const ESPACE = 26;
  const HAUT = 70 + TAILLES_APERCU.reduce((s, t) => s + t + ESPACE, 0) + 20;

  const calques = [];
  // Panneau sombre, à droite
  calques.push({
    input: await sharp({
      create: { width: LARGEUR - COLONNE, height: HAUT, channels: 4, background: { r: 32, g: 33, b: 30, alpha: 1 } },
    }).png().toBuffer(),
    top: 0, left: COLONNE,
  });
  calques.push({ input: etiquette("Fond clair", 240, "#3A3B35"), top: 22, left: MARGE });
  calques.push({ input: etiquette("Fond sombre (barre des tâches)", 320, "#E8E9E3"), top: 22, left: COLONNE + MARGE });

  let y = 70;
  for (const t of TAILLES_APERCU) {
    const img = await carre(sharp, source, t);
    calques.push({ input: img, top: y, left: MARGE });
    calques.push({ input: img, top: y, left: COLONNE + MARGE });
    // Le libellé est aligné à droite de la plus grande icône, donc toujours au même endroit.
    const yTexte = y + Math.max(0, Math.round((t - 22) / 2));
    calques.push({ input: etiquette(t + " × " + t + " px", 130, "#5B5C52"), top: yTexte, left: MARGE + 256 + 24 });
    y += t + ESPACE;
  }

  return sharp({
    create: { width: LARGEUR, height: HAUT, channels: 4, background: { r: 247, g: 248, b: 243, alpha: 1 } },
  }).composite(calques).png().toBuffer();
}

// ------------------------------------------------------------------------------------------------
async function main() {
  const valider = process.argv.slice(2).some((a) => /^[/-]{1,2}valider$/i.test(a));
  const projet = process.cwd();
  const dossierBuild = path.join(projet, "build");

  console.log("");
  console.log("  ICÔNE WINDOWS — " + (valider ? "VALIDATION" : "APERÇU SEULEMENT"));
  console.log("  " + "-".repeat(56));

  let sharp;
  try {
    sharp = require("sharp");
  } catch (err) {
    throw new Error(
      "Le module « sharp » n'a pas pu être chargé.\n"
      + "Lancez d'abord npm install dans le dossier du projet.\n\n" + (err && err.message)
    );
  }

  const logo = trouverLogo();
  const meta = await sharp(logo.absolu).metadata();
  console.log("  Logo       : " + logo.absolu);
  console.log("  Format     : " + (meta.format || "?").toUpperCase()
    + "   " + meta.width + " × " + meta.height + " pixels");

  const plusPetitCote = Math.min(meta.width || 0, meta.height || 0);
  if (plusPetitCote < 256) {
    console.log("");
    console.log("  ATTENTION : Windows demande 256 × 256 pixels pour la plus grande taille.");
    console.log("  Votre logo est plus petit (" + plusPetitCote + " px) : l'icône sera agrandie,");
    console.log("  donc moins nette aux grandes tailles. Les petites tailles — celles qu'on voit");
    console.log("  le plus — resteront correctes.");
    console.log("  Un fichier d'origine en meilleure définition donnerait un meilleur résultat.");
  } else {
    console.log("  Définition suffisante pour une icône 256 × 256 nette.");
  }

  fs.mkdirSync(dossierBuild, { recursive: true });
  const cheminApercu = path.join(dossierBuild, "apercu-icone.png");
  fs.writeFileSync(cheminApercu, await planche(sharp, logo.absolu));
  console.log("");
  console.log("  Aperçu     : " + cheminApercu);

  if (!valider) {
    console.log("");
    console.log("  RIEN N'A ÉTÉ FIGÉ. L'icône build\\icon.ico n'a pas été créée.");
    console.log("  Regardez l'aperçu. S'il vous convient, relancez en validant :");
    console.log("      npm run icone:valider");
    console.log("");
    return;
  }

  const cheminIco = path.join(dossierBuild, "icon.ico");
  if (fs.existsSync(cheminIco)) {
    const sauvegarde = cheminIco + ".precedent-" + Date.now();
    fs.copyFileSync(cheminIco, sauvegarde);
    console.log("  Icône précédente conservée : " + sauvegarde);
  }

  const images = [];
  for (const t of TAILLES_ICO) {
    images.push({ taille: t, donnees: await carre(sharp, logo.absolu, t) });
  }
  fs.writeFileSync(cheminIco, assemblerIco(images));

  console.log("  Icône      : " + cheminIco
    + "   (" + TAILLES_ICO.join(", ") + " px, " + fs.statSync(cheminIco).size + " octets)");
  console.log("");
  console.log("  Vous pouvez maintenant fabriquer l'installateur :  npm run installateur");
  console.log("");
}

// Le script ne s'exécute que lancé directement : requis par un test, il n'expose que ses
// fonctions, sans rien écrire.
if (require.main === module) main().catch((err) => {
  console.error("");
  console.error("  " + (err && err.message ? err.message : String(err)));
  console.error("");
  console.error("  Rien n'a été modifié.");
  console.error("");
  process.exit(1);
});

module.exports = { assemblerIco, TAILLES_ICO, VERT };
