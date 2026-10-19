#!/usr/bin/env node
// ================================================================================================
// ENVOI DES FICHIERS EXISTANTS VERS CLOUDFLARE R2
//
// Copie les images de Belvie ERP (photos d'articles, miniatures, croquis, logo, photos des BC…)
// vers R2, sous exactement les chemins enregistrés en base : « images/commandes/<uuid>.jpg »
// devient l'objet « fichiers/images/commandes/<uuid>.jpg ». La version web (STOCKAGE=r2) les
// retrouve donc sans rien modifier en base.
//
//   Windows : double-clic sur envoyer-fichiers-vers-r2.bat
//   Sinon   : node tools/fichiers/envoyer-vers-r2.js [--source <dossier images>] [--essai]
//
// --essai : liste ce qui serait envoyé, sans rien envoyer.
// Sans risque à relancer : un fichier déjà présent sur R2 avec la même taille est ignoré.
// Rien n'est jamais supprimé, ni sur R2 ni sur le PC.
//
// Configuration (fichier .env à la racine du projet) :
//   R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET (ou R2_BUCKET_FICHIERS),
//   [R2_PREFIXE_FICHIERS=fichiers/]
// ================================================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");

const RACINE = path.resolve(__dirname, "../..");
require(path.join(RACINE, "apps/api/src/config")).chargerFichierEnv();

const argument = (nom, defaut) => { const i = process.argv.indexOf(nom); return i === -1 ? defaut : process.argv[i + 1]; };
const essai = process.argv.includes("--essai");
const dossierElectron = process.platform === "win32" ? path.join(process.env.APPDATA || "", "belvie-erp") : path.join(os.homedir(), ".config", "belvie-erp");
const source = path.resolve(argument("--source", path.join(dossierElectron, "images")));

const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".svg"]);
const TYPES = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml" };

function lister(dossier, base = "") {
  const out = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...lister(path.join(dossier, e.name), rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}
const octets = (n) => { const u = ["o", "Ko", "Mo", "Go"]; let v = n; let i = 0; while (v >= 1024 && i < 3) { v /= 1024; i++; } return `${v.toFixed(i ? 1 : 0)} ${u[i]}`; };

// Si la configuration n'est pas dans .env, elle est demandée dans la fenêtre (rien n'est
// enregistré : les clés ne vivent que le temps de l'envoi).
async function demanderConfigurationManquante() {
  if (!process.stdin.isTTY) return;
  const readline = require("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (q) => new Promise((ok) => rl.question(q, (r) => ok(r.trim())));
  try {
    if (!process.env.R2_ENDPOINT) {
      const r = await question("Identifiant de compte Cloudflare (Account ID) ou URL de l'endpoint S3 R2 : ");
      if (r) process.env.R2_ENDPOINT = /^https?:\/\//.test(r) ? r.replace(/\/+$/, "").replace(/\/[^/]*$/, (m) => (m.includes(".") ? m : "")) : `https://${r}.r2.cloudflarestorage.com`;
    }
    if (!process.env.R2_BUCKET && !process.env.R2_BUCKET_FICHIERS) process.env.R2_BUCKET = (await question("Nom du bucket R2 [belvie-backup] : ")) || "belvie-backup";
    if (!process.env.R2_ACCESS_KEY_ID) process.env.R2_ACCESS_KEY_ID = await question("Access Key ID R2 : ");
    if (!process.env.R2_SECRET_ACCESS_KEY) process.env.R2_SECRET_ACCESS_KEY = await question("Secret Access Key R2 : ");
  } finally { rl.close(); }
}

async function principal() {
  console.log("Envoi des fichiers Belvie ERP vers Cloudflare R2" + (essai ? " — ESSAI (rien n'est envoyé)" : ""));
  if (!fs.existsSync(source)) throw new Error(`Dossier introuvable : ${source}`);
  await demanderConfigurationManquante();
  const manquantes = ["R2_ENDPOINT", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY"].filter((k) => !process.env[k]);
  if (!process.env.R2_BUCKET && !process.env.R2_BUCKET_FICHIERS) manquantes.push("R2_BUCKET");
  if (manquantes.length) throw new Error(`À renseigner dans le fichier .env du projet : ${manquantes.join(", ")}`);

  const bucket = process.env.R2_BUCKET_FICHIERS || process.env.R2_BUCKET;
  const prefixe = process.env.R2_PREFIXE_FICHIERS ?? "fichiers/";
  const { S3Client, PutObjectCommand, HeadObjectCommand } = require(require.resolve("@aws-sdk/client-s3", { paths: [path.join(RACINE, "apps/api"), RACINE] }));
  const s3 = new S3Client({
    region: "auto", requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED", endpoint: process.env.R2_ENDPOINT,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
  });

  const fichiers = lister(source).map((rel) => `images/${rel}`);
  const ignores = fichiers.filter((r) => !EXTENSIONS.has(path.extname(r).toLowerCase()));
  const aTraiter = fichiers.filter((r) => EXTENSIONS.has(path.extname(r).toLowerCase()));
  console.log(`Source : ${source}`);
  console.log(`Destination : r2://${bucket}/${prefixe}images/…`);
  console.log(`${aTraiter.length} image(s) trouvée(s)${ignores.length ? `, ${ignores.length} fichier(s) non image ignoré(s)` : ""}.\n`);

  const bilan = { envoyes: 0, dejaPresents: 0, erreurs: [], volume: 0 };
  for (const [i, rel] of aTraiter.entries()) {
    const local = path.join(source, rel.slice("images/".length));
    const taille = fs.statSync(local).size;
    const cle = prefixe + rel;
    const progression = `[${String(i + 1).padStart(String(aTraiter.length).length)}/${aTraiter.length}]`;
    try {
      let present = false;
      try { const t = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: cle })); present = Number(t.ContentLength) === taille; }
      catch (err) { if (!(err.name === "NotFound" || (err.$metadata && err.$metadata.httpStatusCode === 404))) throw err; }
      if (present) { bilan.dejaPresents++; continue; }
      if (essai) { console.log(`${progression} à envoyer : ${rel} (${octets(taille)})`); bilan.envoyes++; bilan.volume += taille; continue; }
      await s3.send(new PutObjectCommand({ Bucket: bucket, Key: cle, Body: fs.readFileSync(local), ContentType: TYPES[path.extname(rel).toLowerCase()] }));
      const verif = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: cle }));
      if (Number(verif.ContentLength) !== taille) throw new Error(`taille relue ${verif.ContentLength} ≠ ${taille}`);
      bilan.envoyes++; bilan.volume += taille;
      console.log(`${progression} envoyé : ${rel} (${octets(taille)})`);
    } catch (err) {
      bilan.erreurs.push(`${rel} : ${err.message}`);
      console.log(`${progression} ✖ ${rel} : ${err.message}`);
    }
  }

  console.log("\n================================================================");
  console.log(`  ${essai ? "À envoyer" : "Envoyés"} : ${bilan.envoyes} (${octets(bilan.volume)})`);
  console.log(`  Déjà présents sur R2 (identiques) : ${bilan.dejaPresents}`);
  console.log(`  Erreurs : ${bilan.erreurs.length}`);
  for (const e of bilan.erreurs) console.log(`    - ${e}`);
  if (bilan.erreurs.length) console.log("  ⚠ Relancer l'envoi : seuls les fichiers manquants seront renvoyés.");
  else if (essai) console.log("  Essai terminé : relancer sans --essai pour envoyer.");
  else console.log(`  ✔ ${aTraiter.length} image(s) présentes sur R2 et vérifiées.`);
  console.log("================================================================");
  if (bilan.erreurs.length) process.exitCode = 1;
}

principal().catch((err) => { console.error(`\n✖ ${err.message}`); process.exitCode = 1; });
