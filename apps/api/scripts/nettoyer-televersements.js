#!/usr/bin/env node
// ================================================================================================
// NETTOYAGE DES TÉLÉVERSEMENTS ABANDONNÉS DANS R2 (version en ligne)
//
// Un fichier choisi dans l'interface est d'abord rangé dans « fichiers/televersements/ ». S'il est
// enregistré, il est COPIÉ vers images/… ; sinon (formulaire abandonné) il reste là. Ce script
// supprime ceux de plus de 24 h. Il ne touche à rien d'autre : seul le préfixe des téléversements
// est listé, et seuls les noms « <uuid>.<ext> » sont supprimés.
//
// Lancé chaque nuit par .github/workflows/sauvegarde.yml, après la sauvegarde.
//   node scripts/nettoyer-televersements.js [--essai]
// Variables : R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (ou R2_BUCKET_FICHIERS),
//   [R2_PREFIXE_FICHIERS=fichiers/]
// ================================================================================================
const { chargerFichierEnv } = require("../src/config");

chargerFichierEnv();

async function nettoyer({ s3, bucket, prefixe, ageMaxMs = 24 * 3600 * 1000, maintenant = Date.now(), essai = false, journal = console.log }) {
  const { ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const dossier = `${prefixe}televersements/`;
  const nom = /^[0-9a-f-]{36}\.[a-z0-9]{1,5}$/;
  let jeton; let supprimes = 0; let gardes = 0;
  do {
    const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: dossier, ContinuationToken: jeton }));
    for (const o of r.Contents || []) {
      const vieux = maintenant - new Date(o.LastModified).getTime() > ageMaxMs;
      if (!vieux || !nom.test(o.Key.slice(dossier.length))) { gardes++; continue; }
      if (!essai) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key }));
      supprimes++;
    }
    jeton = r.IsTruncated ? r.NextContinuationToken : undefined;
  } while (jeton);
  journal(`[téléversements] ${supprimes} fichier(s) abandonné(s) ${essai ? "à supprimer" : "supprimé(s)"}, ${gardes} conservé(s).`);
  return { supprimes, gardes };
}

if (require.main === module) {
  const exiger = (k) => { if (!process.env[k]) { console.error(`Variable manquante : ${k}`); process.exit(1); } return process.env[k]; };
  const { S3Client } = require("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: "auto", requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", endpoint: exiger("R2_ENDPOINT"),
    credentials: { accessKeyId: exiger("R2_ACCESS_KEY_ID"), secretAccessKey: exiger("R2_SECRET_ACCESS_KEY") },
  });
  nettoyer({
    s3, bucket: process.env.R2_BUCKET_FICHIERS || exiger("R2_BUCKET"),
    prefixe: process.env.R2_PREFIXE_FICHIERS ?? "fichiers/", essai: process.argv.includes("--essai"),
  }).catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
}

module.exports = { nettoyer };
