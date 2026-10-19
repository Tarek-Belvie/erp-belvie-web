// ================================================================================================
// SAUVEGARDES DE LA VERSION EN LIGNE (Vercel) — lecture seule des sauvegardes de la nuit.
//
// Sur Vercel il n'y a ni pg_dump ni disque durable : la sauvegarde est faite chaque nuit par
// GitHub Actions (.github/workflows/sauvegarde.yml → apps/api/scripts/sauvegarde-r2.js), qui dépose
// « <R2_PREFIXE>belvie-AAAA-MM-JJ-HHMM.dump » dans R2 et garde 5 versions.
// Les images n'ont pas besoin d'une copie : elles sont déjà dans R2 (stockage durable).
//
// Ce module permet à l'écran Paramètres → Sauvegardes de les lister, de les vérifier (relecture
// complète et comparaison avec l'empreinte SHA-256 enregistrée à l'envoi) et de les télécharger
// par un lien signé valable 5 minutes (le fichier ne transite pas par la fonction Vercel).
// ================================================================================================
const crypto = require("crypto");

const actif = () => !!process.env.VERCEL || process.env.SAUVEGARDES === "r2";
const prefixe = () => process.env.R2_PREFIXE || "base/";
const NOM = /^belvie-\d{4}-\d{2}-\d{2}-\d{4}\.dump$/;

// Recommandé : un bucket DÉDIÉ aux sauvegardes (R2_SAUVEGARDES_BUCKET) et, côté application, une clé
// en LECTURE SEULE sur ce bucket (R2_SAUVEGARDES_ACCESS_KEY_ID / _SECRET_ACCESS_KEY). Ainsi ni un bug
// ni une fuite des clés de l'application ne peut effacer les sauvegardes ; seul GitHub Actions écrit.
// À défaut, ce sont R2_BUCKET et les clés de l'application qui servent.
const val = (dedie, commun) => process.env[dedie] || process.env[commun];
let client = null;
function s3() {
  if (!client) {
    const { S3Client } = require("@aws-sdk/client-s3");
    const exiger = (dedie, commun) => { const v = val(dedie, commun || dedie); if (!v) throw new Error(`Variable manquante pour les sauvegardes : ${commun || dedie}`); return v; };
    client = new S3Client({
      region: "auto", requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", endpoint: exiger("R2_ENDPOINT"),
      credentials: {
        accessKeyId: exiger("R2_SAUVEGARDES_ACCESS_KEY_ID", "R2_ACCESS_KEY_ID"),
        secretAccessKey: exiger("R2_SAUVEGARDES_SECRET_ACCESS_KEY", "R2_SECRET_ACCESS_KEY"),
      },
    });
  }
  return client;
}
const bucket = () => { const b = val("R2_SAUVEGARDES_BUCKET", "R2_BUCKET"); if (!b) throw new Error("Variable manquante pour les sauvegardes : R2_SAUVEGARDES_BUCKET"); return b; };
function cleDe(nom) {
  const n = String(nom || "");
  if (!NOM.test(n)) throw new Error("Sauvegarde introuvable.");
  return prefixe() + n;
}

async function lister() {
  const { ListObjectsV2Command } = require("@aws-sdk/client-s3");
  const out = [];
  let jeton;
  do {
    const r = await s3().send(new ListObjectsV2Command({ Bucket: bucket(), Prefix: prefixe(), ContinuationToken: jeton }));
    for (const o of r.Contents || []) {
      const nom = o.Key.slice(prefixe().length);
      if (NOM.test(nom)) out.push({ nom, cree_le: o.LastModified ? new Date(o.LastModified).toISOString() : null, motif: "automatique (nuit)", version: null, taille: Number(o.Size) || 0 });
    }
    jeton = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (jeton);
  return out.sort((a, b) => b.nom.localeCompare(a.nom));
}

async function verifier(nom) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const controles = [];
  const ajouter = (libelle, ok, detail) => controles.push({ libelle, ok, detail: detail || null });
  try {
    const r = await s3().send(new GetObjectCommand({ Bucket: bucket(), Key: cleDe(nom) }));
    const contenu = Buffer.from(await r.Body.transformToByteArray());
    ajouter("Présente sur Cloudflare R2 et lisible", true);
    ajouter("Taille non nulle", contenu.length > 0, `${contenu.length} octets`);
    // Archive pg_dump au format « custom » : commence toujours par « PGDMP ».
    ajouter("Archive PostgreSQL reconnue", contenu.subarray(0, 5).toString("latin1") === "PGDMP");
    const attendue = (r.Metadata || {}).sha256;
    if (!attendue) ajouter("Empreinte SHA-256 enregistrée à l'envoi", false, "absente");
    else ajouter("Intacte (SHA-256 identique à l'envoi)", crypto.createHash("sha256").update(contenu).digest("hex") === attendue);
  } catch (err) {
    ajouter("Présente sur Cloudflare R2 et lisible", false, err.message);
  }
  return { nom: String(nom || ""), rapport: { ok: controles.length > 0 && controles.every((c) => c.ok), controles } };
}

async function lienTelechargement(nom) {
  const { GetObjectCommand } = require("@aws-sdk/client-s3");
  const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
  const cle = cleDe(nom);
  const url = await getSignedUrl(s3(), new GetObjectCommand({
    Bucket: bucket(), Key: cle, ResponseContentDisposition: `attachment; filename="${nom}"`,
  }), { expiresIn: 300 });
  return { url, nom };
}

const MESSAGE_SAUVEGARDE_MANUELLE =
  "Sur la version en ligne, la base est sauvegardée automatiquement chaque nuit à minuit (5 versions conservées). " +
  "Pour une sauvegarde immédiate : GitHub → dépôt erp-belvie-web → Actions → « Sauvegarde de la base » → Run workflow.";

module.exports = { actif, lister, verifier, lienTelechargement, MESSAGE_SAUVEGARDE_MANUELLE, _definirClient: (c) => { client = c; } };
