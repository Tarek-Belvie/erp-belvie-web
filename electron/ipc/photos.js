const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { app, dialog } = require("electron");
const sharp = require("sharp");

const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo
const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const THUMB_SIZE = 160;

function getUserDataDir() {
  return app.getPath("userData");
}
function getImagesDir() {
  return path.join(getUserDataDir(), "images", "commandes");
}
function getThumbsDir() {
  return path.join(getImagesDir(), "thumbs");
}

function ensureDirs() {
  fs.mkdirSync(getImagesDir(), { recursive: true });
  fs.mkdirSync(getThumbsDir(), { recursive: true });
}

// Chemin relatif au dossier de données (jamais un chemin absolu propre à une machine),
// avec des séparateurs "/" uniformes quel que soit l'OS.
function toRelative(absPath) {
  return path.relative(getUserDataDir(), absPath).split(path.sep).join("/");
}

function validateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    throw new Error("Format d'image non pris en charge. Utilisez JPG, JPEG, PNG ou WEBP.");
  }
  if (!fs.existsSync(filePath)) {
    throw new Error("Le fichier sélectionné est introuvable.");
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_SIZE_BYTES) {
    throw new Error("L'image dépasse la taille maximale autorisée (10 Mo).");
  }
  return { ext, size: stat.size };
}

// Ouvre le sélecteur de fichier natif, valide le choix, et renvoie un aperçu (data URL) pour
// affichage immédiat dans le formulaire — sans encore rien copier dans le stockage de l'ERP.
async function pickImage(mainWindow, title = "Choisir une photo de l'article") {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };

  const filePath = filePaths[0];
  try {
    const { ext, size } = validateFile(filePath);
    const buffer = fs.readFileSync(filePath);
    const dataUrl = `data:${MIME_BY_EXT[ext]};base64,${buffer.toString("base64")}`;
    return { canceled: false, filePath, fileName: path.basename(filePath), sizeBytes: size, dataUrl };
  } catch (err) {
    return { canceled: false, error: err.message };
  }
}

// Copie le fichier choisi dans le stockage géré par l'ERP, sous un nom unique, et génère
// une miniature optimisée pour le tableau. Retourne les chemins RELATIFS à enregistrer en base.
async function copyIntoStore(sourcePath) {
  ensureDirs();
  const { ext } = validateFile(sourcePath); // re-vérifié : le fichier a pu changer entre la sélection et l'enregistrement

  const uniqueName = `${crypto.randomUUID()}${ext}`;
  const destAbs = path.join(getImagesDir(), uniqueName);
  fs.copyFileSync(sourcePath, destAbs);

  const photo_path = toRelative(destAbs);
  let photo_thumb_path = photo_path; // repli par défaut si la génération de miniature échoue

  try {
    const thumbName = `${path.parse(uniqueName).name}.jpg`;
    const thumbAbs = path.join(getThumbsDir(), thumbName);
    await sharp(destAbs).rotate().resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" }).jpeg({ quality: 72 }).toFile(thumbAbs);
    photo_thumb_path = toRelative(thumbAbs);
  } catch (err) {
    console.error("Génération de la miniature impossible, utilisation de l'image d'origine :", err);
  }

  return { photo_path, photo_thumb_path };
}

function isReferenced(db, relPath, excludeArticlePhotoId) {
  if (!relPath) return false;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM article_photos WHERE id <> ? AND (photo_path = ? OR photo_thumb_path = ?)")
    .get(excludeArticlePhotoId ?? -1, relPath, relPath);
  return row.n > 0;
}

function removeFileIfOrphan(db, relPath, excludeArticlePhotoId) {
  if (!relPath) return;
  if (isReferenced(db, relPath, excludeArticlePhotoId)) return; // encore utilisée ailleurs : on ne touche à rien
  const abs = path.join(getUserDataDir(), relPath);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.error("Impossible de supprimer le fichier image devenu orphelin :", err);
  }
}

// À appeler après avoir remplacé ou retiré une photo d'article : libère l'ancien fichier
// (et son ancienne miniature) uniquement si plus aucune autre photo d'article ne le référence.
function cleanupOldPhoto(db, oldPhotoPath, oldThumbPath, excludeArticlePhotoId) {
  removeFileIfOrphan(db, oldPhotoPath, excludeArticlePhotoId);
  if (oldThumbPath && oldThumbPath !== oldPhotoPath) removeFileIfOrphan(db, oldThumbPath, excludeArticlePhotoId);
}

function getEntrepriseDir() {
  return path.join(getUserDataDir(), "images", "entreprise");
}

// Copie et redimensionne le logo en un SEUL fichier (pas de miniature séparée : un logo
// correctement redimensionné à l'affichage suffit pour cette version). Le fichier d'origine
// choisi par l'utilisateur n'est jamais référencé directement : toujours une copie interne,
// pour que le logo ne disparaisse pas si le fichier source est déplacé ou supprimé.
async function copyLogoIntoStore(sourcePath) {
  const { ext } = validateFile(sourcePath);
  const dir = getEntrepriseDir();
  fs.mkdirSync(dir, { recursive: true });

  try {
    const destAbs = path.join(dir, `logo-${crypto.randomUUID()}.jpg`);
    await sharp(sourcePath).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toFile(destAbs);
    return { logo_path: toRelative(destAbs) };
  } catch (err) {
    // Repli : copie brute si le redimensionnement échoue (format inhabituel, etc.).
    console.error("Redimensionnement du logo impossible, copie de l'original :", err);
    const fallbackAbs = path.join(dir, `logo-${crypto.randomUUID()}${ext}`);
    fs.copyFileSync(sourcePath, fallbackAbs);
    return { logo_path: toRelative(fallbackAbs) };
  }
}

// Un seul logo existe jamais à la fois (une seule ligne "entreprise") : pas besoin de vérifier
// s'il est "encore référencé ailleurs" comme pour les photos d'article, partagées entre plusieurs
// commandes.
function removeLogoFile(relPath) {
  if (!relPath) return;
  const abs = path.join(getUserDataDir(), relPath);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.error("Impossible de supprimer l'ancien logo :", err);
  }
}

function getBcPfDir() {
  return path.join(getUserDataDir(), "images", "bc_pf");
}

// Copie une photo DÉJÀ interne (ex: photo principale d'un article) vers un nouvel emplacement
// dédié à un document figé dans le temps (BC PF aujourd'hui, réutilisable pour BC MP plus tard).
// Contrairement à copyIntoStore/copyLogoIntoStore, la source est déjà un fichier géré par
// l'application (pas un chemin choisi par l'utilisateur) : pas de revalidation de format/taille
// nécessaire, une simple copie physique suffit. Ne lève jamais d'erreur : l'absence de photo ou
// un fichier source manquant ne doivent jamais empêcher la création du document.
function snapshotArticlePhoto(articlePhotoRelPath) {
  if (!articlePhotoRelPath) return null;
  const srcAbs = path.join(getUserDataDir(), articlePhotoRelPath);
  if (!fs.existsSync(srcAbs)) return null;

  const dir = getBcPfDir();
  fs.mkdirSync(dir, { recursive: true });
  const ext = path.extname(srcAbs) || ".jpg";
  const destAbs = path.join(dir, `bcpf-${crypto.randomUUID()}${ext}`);
  fs.copyFileSync(srcAbs, destAbs);
  return toRelative(destAbs);
}

function removeSnapshotFile(relPath) {
  if (!relPath) return;
  const abs = path.join(getUserDataDir(), relPath);
  try {
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.error("Impossible de supprimer le snapshot photo :", err);
  }
}

module.exports = {
  pickImage,
  copyIntoStore,
  cleanupOldPhoto,
  copyLogoIntoStore,
  removeLogoFile,
  snapshotArticlePhoto,
  removeSnapshotFile,
  getUserDataDir,
  getImagesDir,
  ensureDirs,
};
