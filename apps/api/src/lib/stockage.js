// ================================================================================================
// STOCKAGE DES FICHIERS (photos, croquis, logo, téléversements) — point unique.
//
// Deux modes, choisis par STOCKAGE :
//   * "disque" (défaut)  : fichiers dans DOSSIER_DONNEES (serveur Docker, développement) ;
//   * "r2"               : Cloudflare R2 (compatible S3) — obligatoire sur Vercel, qui n'a pas de
//                          disque persistant.
//
// Les chemins manipulés sont TOUJOURS relatifs (« images/commandes/<uuid>.jpg ») : ce sont ceux
// enregistrés en base depuis la version Electron. Passer d'un mode à l'autre consiste à copier
// les fichiers, jamais à réécrire la base.
//
// Variables (mode r2) : R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   R2_BUCKET_FICHIERS (défaut : R2_BUCKET), R2_PREFIXE_FICHIERS (défaut « fichiers/»).
// ================================================================================================
const fs = require("fs");
const path = require("path");

const MIME = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".pdf": "application/pdf" };
const typeDe = (rel) => MIME[path.extname(rel).toLowerCase()] || "application/octet-stream";

function verifierRelatif(rel) {
  const r = String(rel || "").replace(/\\/g, "/");
  if (!r || r.startsWith("/") || r.split("/").some((s) => s === ".." || s === "")) throw new Error("Chemin de fichier invalide.");
  return r;
}

// ---------------------------------------------------------------- Disque
function creerDisque() {
  const { cheminMedia } = require("./plateforme");
  return {
    mode: "disque",
    async ecrire(rel, contenu) { const abs = cheminMedia(verifierRelatif(rel)); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, contenu); },
    async lire(rel) { try { return fs.readFileSync(cheminMedia(verifierRelatif(rel))); } catch (_) { return null; } },
    async existe(rel) { try { return fs.existsSync(cheminMedia(verifierRelatif(rel))); } catch (_) { return false; } },
    async supprimer(rel) { try { fs.unlinkSync(cheminMedia(verifierRelatif(rel))); } catch (_) { /* déjà absent */ } },
  };
}

// ---------------------------------------------------------------- Cloudflare R2
function creerR2() {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const exiger = (k) => { if (!process.env[k]) throw new Error(`Variable manquante pour le stockage R2 : ${k}`); return process.env[k]; };
  const s3 = new S3Client({
    region: "auto", requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
    endpoint: exiger("R2_ENDPOINT"),
    credentials: { accessKeyId: exiger("R2_ACCESS_KEY_ID"), secretAccessKey: exiger("R2_SECRET_ACCESS_KEY") },
  });
  const bucket = process.env.R2_BUCKET_FICHIERS || exiger("R2_BUCKET");
  const prefixe = process.env.R2_PREFIXE_FICHIERS ?? "fichiers/";
  const cle = (rel) => prefixe + verifierRelatif(rel);
  const introuvable = (err) => err && (err.name === "NoSuchKey" || err.name === "NotFound" || (err.$metadata && err.$metadata.httpStatusCode === 404));
  return {
    mode: "r2",
    async ecrire(rel, contenu) {
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: cle(rel), Body: contenu, ContentType: typeDe(rel) }));
    },
    async lire(rel) {
      try {
        const r = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: cle(rel) }));
        return Buffer.from(await r.Body.transformToByteArray());
      } catch (err) { if (introuvable(err)) return null; throw err; }
    },
    async existe(rel) {
      try { await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: cle(rel) })); return true; }
      catch (err) { if (introuvable(err)) return false; throw err; }
    },
    async supprimer(rel) { await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: cle(rel) })); },
    // Lien de lecture signé, valable `secondes` : le navigateur lit l'image directement dans R2, sans
    // passer par la fonction Vercel (limitée à 4,5 Mo par réponse). Calcul local, aucun appel réseau.
    async lienSigne(rel, secondes = 3600) {
      const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: cle(rel) }), { expiresIn: secondes });
    },
  };
}

let instance = null;
function stockage() {
  if (!instance) {
    const mode = process.env.STOCKAGE || "disque";
    // Sur Vercel, le disque est effacé à chaque recyclage d'instance : un fichier « enregistré » sur
    // disque serait perdu alors que son chemin est en base. On refuse plutôt que de perdre des photos.
    if (process.env.VERCEL && mode !== "r2") throw new Error("Configuration : STOCKAGE=r2 est obligatoire sur Vercel (variables d'environnement du projet).");
    instance = mode === "r2" ? creerR2() : creerDisque();
  }
  return instance;
}
// Pour les tests : remplacer le stockage par une implémentation en mémoire.
function _definirStockage(s) { instance = s; }

// Opérations composées, communes aux deux modes.
async function copier(relSource, relDestination) {
  const contenu = await stockage().lire(relSource);
  if (!contenu) return false;
  await stockage().ecrire(relDestination, contenu);
  return true;
}
// Suppression qui n'échoue jamais (nettoyage non bloquant, comme dans la version Electron).
async function supprimerSansErreur(rel, contexte) {
  if (!rel) return;
  try { await stockage().supprimer(rel); } catch (err) { console.error(`${contexte || "Suppression de fichier"} impossible (non bloquant) :`, err.message); }
}

module.exports = {
  stockage, copier, supprimerSansErreur, typeDe, verifierRelatif, _definirStockage,
  ecrire: (r, c) => stockage().ecrire(r, c),
  lire: (r) => stockage().lire(r),
  existe: (r) => stockage().existe(r),
};
