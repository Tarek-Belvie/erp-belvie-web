const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { dossierDonnees, resoudreTeleversement, libererCopieLocale } = require("../lib/plateforme");
const stockage = require("../lib/stockage");
const sharp = require("sharp");

const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024; // 10 Mo
const MIME_BY_EXT = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const THUMB_SIZE = 160;

function getUserDataDir() {
  return dossierDonnees();
}
function getImagesDir() {
  return path.join(getUserDataDir(), "images", "commandes");
}
function getThumbsDir() {
  return path.join(getImagesDir(), "thumbs");
}

// Les fichiers sont rangés par lib/stockage.js (disque ou Cloudflare R2), toujours sous des
// chemins RELATIFS identiques à ceux de la version Electron : « images/commandes/<uuid>.jpg ».
const DOSSIER_PHOTOS = "images/commandes";
const DOSSIER_LOGO = "images/entreprise";
const DOSSIER_BC_PF = "images/bc_pf";

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

// Version web du sélecteur d'image : le navigateur a déjà envoyé le fichier (POST /api/fichiers),
// qui a été rangé dans les téléversements. On le valide et on renvoie le même aperçu que
// l'ancien sélecteur natif — sans encore rien copier dans le stockage de l'ERP. `filePath` est
// l'identifiant de téléversement, que l'interface repasse tel quel à ajouterPhoto / setLogo…
async function decrireTeleversement(jeton, nomOriginal) {
  let filePath = null;
  try {
    filePath = await resoudreTeleversement(jeton);
    const { ext, size } = validateFile(filePath);
    const buffer = fs.readFileSync(filePath);
    const dataUrl = `data:${MIME_BY_EXT[ext]};base64,${buffer.toString("base64")}`;
    return { canceled: false, filePath: jeton, fileName: nomOriginal || path.basename(filePath), sizeBytes: size, dataUrl };
  } catch (err) {
    return { canceled: false, error: err.message };
  } finally {
    libererCopieLocale(filePath);
  }
}

// Copie le fichier choisi dans le stockage géré par l'ERP, sous un nom unique, et génère
// une miniature optimisée pour le tableau. Retourne les chemins RELATIFS à enregistrer en base.
async function copyIntoStore(sourcePath) {
  const { ext } = validateFile(sourcePath); // re-vérifié : le fichier a pu changer entre la sélection et l'enregistrement
  const contenu = fs.readFileSync(sourcePath);

  const uniqueName = `${crypto.randomUUID()}${ext}`;
  const photo_path = `${DOSSIER_PHOTOS}/${uniqueName}`;
  await stockage.ecrire(photo_path, contenu);

  let photo_thumb_path = photo_path; // repli par défaut si la génération de miniature échoue
  try {
    const miniature = await sharp(contenu).rotate().resize(THUMB_SIZE, THUMB_SIZE, { fit: "cover" }).jpeg({ quality: 72 }).toBuffer();
    const rel = `${DOSSIER_PHOTOS}/thumbs/${path.parse(uniqueName).name}.jpg`;
    await stockage.ecrire(rel, miniature);
    photo_thumb_path = rel;
  } catch (err) {
    console.error("Génération de la miniature impossible, utilisation de l'image d'origine :", err);
  }

  return { photo_path, photo_thumb_path };
}

async function isReferenced(db, relPath, excludeArticlePhotoId) {
  if (!relPath) return false;
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM article_photos WHERE id <> ? AND (photo_path = ? OR photo_thumb_path = ?)")
    .get(excludeArticlePhotoId ?? -1, relPath, relPath);
  return row.n > 0;
}

async function removeFileIfOrphan(db, relPath, excludeArticlePhotoId) {
  if (!relPath) return;
  if (await isReferenced(db, relPath, excludeArticlePhotoId)) return; // encore utilisée ailleurs : on ne touche à rien
  await stockage.supprimerSansErreur(relPath, "Suppression de l'image devenue orpheline");
}

// À appeler après avoir remplacé ou retiré une photo d'article : libère l'ancien fichier
// (et son ancienne miniature) uniquement si plus aucune autre photo d'article ne le référence.
async function cleanupOldPhoto(db, oldPhotoPath, oldThumbPath, excludeArticlePhotoId) {
  await removeFileIfOrphan(db, oldPhotoPath, excludeArticlePhotoId);
  if (oldThumbPath && oldThumbPath !== oldPhotoPath) await removeFileIfOrphan(db, oldThumbPath, excludeArticlePhotoId);
}

// Copie et redimensionne le logo en un SEUL fichier (pas de miniature séparée : un logo
// correctement redimensionné à l'affichage suffit pour cette version). Le fichier d'origine
// choisi par l'utilisateur n'est jamais référencé directement : toujours une copie interne,
// pour que le logo ne disparaisse pas si le fichier source est déplacé ou supprimé.
async function copyLogoIntoStore(sourcePath) {
  const { ext } = validateFile(sourcePath);
  const contenu = fs.readFileSync(sourcePath);
  try {
    const rel = `${DOSSIER_LOGO}/logo-${crypto.randomUUID()}.jpg`;
    await stockage.ecrire(rel, await sharp(contenu).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer());
    return { logo_path: rel };
  } catch (err) {
    // Repli : copie brute si le redimensionnement échoue (format inhabituel, etc.).
    console.error("Redimensionnement du logo impossible, copie de l'original :", err);
    const rel = `${DOSSIER_LOGO}/logo-${crypto.randomUUID()}${ext}`;
    await stockage.ecrire(rel, contenu);
    return { logo_path: rel };
  }
}

// Un seul logo existe jamais à la fois (une seule ligne "entreprise") : pas besoin de vérifier
// s'il est "encore référencé ailleurs" comme pour les photos d'article, partagées entre plusieurs
// commandes.
async function removeLogoFile(relPath) {
  await stockage.supprimerSansErreur(relPath, "Suppression de l'ancien logo");
}

// Copie une photo DÉJÀ interne (ex: photo principale d'un article) vers un nouvel emplacement
// dédié à un document figé dans le temps (BC PF aujourd'hui, réutilisable pour BC MP plus tard).
// Contrairement à copyIntoStore/copyLogoIntoStore, la source est déjà un fichier géré par
// l'application (pas un chemin choisi par l'utilisateur) : pas de revalidation de format/taille
// nécessaire, une simple copie suffit. Ne lève jamais d'erreur : l'absence de photo ou
// un fichier source manquant ne doivent jamais empêcher la création du document.
async function snapshotArticlePhoto(articlePhotoRelPath) {
  if (!articlePhotoRelPath) return null;
  try {
    const ext = path.extname(articlePhotoRelPath) || ".jpg";
    const rel = `${DOSSIER_BC_PF}/bcpf-${crypto.randomUUID()}${ext}`;
    return (await stockage.copier(articlePhotoRelPath, rel)) ? rel : null;
  } catch (err) {
    console.error("Copie de la photo pour le document impossible (non bloquant) :", err.message);
    return null;
  }
}

async function removeSnapshotFile(relPath) {
  await stockage.supprimerSansErreur(relPath, "Suppression du snapshot photo");
}

module.exports = {
  decrireTeleversement,
  copyIntoStore,
  cleanupOldPhoto,
  copyLogoIntoStore,
  removeLogoFile,
  snapshotArticlePhoto,
  removeSnapshotFile,
  getUserDataDir,
  getImagesDir,
};
