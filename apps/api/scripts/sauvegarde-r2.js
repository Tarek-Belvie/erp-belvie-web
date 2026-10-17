#!/usr/bin/env node
// ================================================================================================
// SAUVEGARDE QUOTIDIENNE DE LA BASE VERS CLOUDFLARE R2
//
//   node scripts/sauvegarde-r2.js            une sauvegarde maintenant
//   node scripts/sauvegarde-r2.js --planifier   tourne en continu : une sauvegarde chaque jour à
//                                               HEURE_SAUVEGARDE (défaut 00:00), fuseau TZ_SAUVEGARDE
//                                               (défaut Europe/Paris)
//
// Déroulé (rien n'est supprimé tant que la nouvelle sauvegarde n'est pas vérifiée) :
//   1. pg_dump --format=custom de DATABASE_URL dans un fichier temporaire ;
//   2. contrôle : pg_restore --list doit lire l'archive ;
//   3. envoi sur R2 : <R2_PREFIXE>belvie-AAAA-MM-JJ-HHMM.dump (+ empreinte SHA-256 en métadonnée) ;
//   4. relecture de l'objet envoyé (taille identique) ;
//   5. rotation : on garde les R2_VERSIONS (défaut 5) plus récentes, les autres sont supprimées ;
//   6. e-mail de compte rendu à MAIL_DESTINATAIRE — y compris, et surtout, en cas d'échec.
//
// Variables : DATABASE_URL, R2_ENDPOINT, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
//   [R2_PREFIXE=base/], [R2_VERSIONS=5], SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS,
//   [SMTP_SECURISE=1], MAIL_EXPEDITEUR, MAIL_DESTINATAIRE.
// ================================================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const { chargerFichierEnv } = require("../src/config");

const executer = promisify(execFile);
chargerFichierEnv();

const env = (cle, defaut) => {
  const v = process.env[cle];
  if (v === undefined || v === "") { if (defaut === undefined) throw new Error(`Variable manquante : ${cle}`); return defaut; }
  return v;
};

// Dépendances remplaçables par les tests (faux stockage, faux envoi d'e-mail).
const deps = { clientR2: () => clientR2(), transportMail: null };

function clientR2() {
  const { S3Client } = require("@aws-sdk/client-s3");
  return new S3Client({
    region: "auto",
    endpoint: env("R2_ENDPOINT"),
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
}

// Configuration validée AVANT toute action : une valeur absurde ne doit jamais conduire à
// supprimer des sauvegardes (R2_VERSIONS=0 ou « cinq » viderait le bucket).
function nombreVersions() {
  const v = Number(env("R2_VERSIONS", "5"));
  if (!Number.isInteger(v) || v < 1 || v > 365) throw new Error(`R2_VERSIONS invalide (${process.env.R2_VERSIONS}) : entier de 1 à 365 attendu.`);
  return v;
}
function heureSauvegarde() {
  const h = env("HEURE_SAUVEGARDE", "00:00");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(h)) throw new Error(`HEURE_SAUVEGARDE invalide (${h}) : format HH:MM attendu, ex. 00:00.`);
  return h;
}
const echapper = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function octets(n) {
  const u = ["o", "Ko", "Mo", "Go"]; let v = n; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 1 : 0)} ${u[i]}`;
}

async function comptages() {
  const pg = require("pg");
  const c = new pg.Client({ connectionString: env("DATABASE_URL") });
  await c.connect();
  try {
    const tables = (await c.query("SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY 1")).rows;
    const out = {};
    for (const { table_name: t } of tables) out[t] = Number((await c.query(`SELECT count(*) n FROM "${t}"`)).rows[0].n);
    return out;
  } finally { await c.end(); }
}

async function sauvegarder() {
  const { PutObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require("@aws-sdk/client-s3");
  const bucket = env("R2_BUCKET");
  const prefixe = env("R2_PREFIXE", "base/");
  const versions = nombreVersions();
  let rotationCommencee = false;
  const debut = Date.now();
  const horo = new Date().toLocaleString("sv-SE", { timeZone: env("TZ_SAUVEGARDE", "Europe/Paris") }).replace(/[: ]/g, "-").slice(0, 16).replace(/-(\d\d)-(\d\d)$/, "-$1$2");
  const cle = `${prefixe}belvie-${horo}.dump`;
  const tmp = path.join(os.tmpdir(), `belvie-${process.pid}-${Date.now()}.dump`);
  try {
    // 1-2. Export et contrôle de lisibilité
    await executer("pg_dump", ["--format=custom", "--compress=9", "--no-owner", "--no-privileges", "--file", tmp, env("DATABASE_URL")], { maxBuffer: 1 << 26 });
    await executer("pg_restore", ["--list", tmp], { maxBuffer: 1 << 26 });
    const taille = fs.statSync(tmp).size;
    const empreinte = crypto.createHash("sha256").update(fs.readFileSync(tmp)).digest("hex");
    const tables = await comptages();

    // 3-4. Envoi et relecture
    const s3 = deps.clientR2();
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: cle, Body: fs.createReadStream(tmp), ContentLength: taille,
      ContentType: "application/octet-stream", Metadata: { sha256: empreinte, lignes: String(Object.values(tables).reduce((a, b) => a + b, 0)) },
    }));
    const tete = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: cle }));
    if (Number(tete.ContentLength) !== taille) throw new Error(`Taille relue sur R2 (${tete.ContentLength}) différente de la taille envoyée (${taille}).`);

    // 5. Rotation : uniquement maintenant que la nouvelle sauvegarde est vérifiée
    const objets = [];
    let jeton;
    do {
      const r = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefixe, ContinuationToken: jeton }));
      // Seules les sauvegardes AUTOMATIQUES (nom horodaté exact) entrent dans la rotation ; un
      // fichier déposé à la main dans le même dossier n'est jamais compté ni supprimé.
      const motif = new RegExp(`^${echapper(prefixe)}belvie-\\d{4}-\\d{2}-\\d{2}-\\d{4}\\.dump$`);
      for (const o of r.Contents || []) if (motif.test(o.Key)) objets.push(o);
      jeton = r.IsTruncated ? r.NextContinuationToken : undefined;
    } while (jeton);
    objets.sort((a, b) => String(b.Key).localeCompare(String(a.Key)));
    if (!objets.some((o) => o.Key === cle)) throw new Error(`La sauvegarde envoyée (${cle}) n'apparaît pas dans la liste R2 : rotation annulée.`);
    const supprimes = [];
    rotationCommencee = true;
    for (const o of objets.slice(versions)) {
      if (o.Key === cle) continue; // jamais la sauvegarde qui vient d'être envoyée
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: o.Key })); supprimes.push(o.Key);
    }
    const conserves = objets.slice(0, versions).map((o) => o.Key);

    const rapport = { ok: true, cle, taille, empreinte, duree: Math.round((Date.now() - debut) / 1000), tables, conserves, supprimes };
    console.log(`[sauvegarde] OK ${cle} (${octets(taille)}, ${rapport.duree} s) — ${conserves.length} version(s) conservée(s), ${supprimes.length} supprimée(s).`);
    await notifier(rapport);
    return rapport;
  } catch (err) {
    const rapport = { ok: false, cle, erreur: err.message, rotationCommencee, duree: Math.round((Date.now() - debut) / 1000) };
    console.error(`[sauvegarde] ÉCHEC : ${err.message}`);
    await notifier(rapport).catch((e) => console.error("[sauvegarde] e-mail d'échec impossible :", e.message));
    throw err;
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}

async function notifier(r) {
  if (!deps.transportMail && (!process.env.SMTP_HOST || !process.env.MAIL_DESTINATAIRE)) {
    console.warn("[sauvegarde] SMTP_HOST / MAIL_DESTINATAIRE non configurés : aucun e-mail envoyé.");
    return;
  }
  const nodemailer = require("nodemailer");
  const transport = deps.transportMail || nodemailer.createTransport({
    host: env("SMTP_HOST"), port: Number(env("SMTP_PORT", "465")), secure: env("SMTP_SECURISE", "1") === "1",
    auth: process.env.SMTP_USER ? { user: env("SMTP_USER"), pass: env("SMTP_PASS") } : undefined,
  });
  const date = new Date().toLocaleString("fr-FR", { timeZone: env("TZ_SAUVEGARDE", "Europe/Paris") });
  const sujet = r.ok ? `✅ Belvie ERP — sauvegarde du ${date} réussie` : `❌ Belvie ERP — ÉCHEC de la sauvegarde du ${date}`;
  const lignes = r.ok
    ? [
        `La sauvegarde quotidienne de la base Belvie ERP a réussi.`, "",
        `Fichier : ${r.cle}`, `Taille : ${octets(r.taille)}`, `Durée : ${r.duree} s`, `Empreinte SHA-256 : ${r.empreinte}`, "",
        `Versions conservées sur R2 (${r.conserves.length}) :`, ...r.conserves.map((k) => `  • ${k}`),
        ...(r.supprimes.length ? ["", `Versions supprimées (rotation) :`, ...r.supprimes.map((k) => `  • ${k}`)] : []), "",
        `Contenu (lignes par table, tables non vides) :`,
        ...Object.entries(r.tables).filter(([, n]) => n > 0).map(([t, n]) => `  ${t} : ${n}`),
      ]
    : [
        `La sauvegarde quotidienne de la base Belvie ERP a ÉCHOUÉ.`, "",
        `Cause : ${r.erreur}`, "",
        r.rotationCommencee
          ? `L'échec est survenu PENDANT la suppression des anciennes versions : vérifier le contenu du bucket R2.`
          : `Les sauvegardes précédentes n'ont pas été touchées (aucune rotation sans nouvelle sauvegarde vérifiée).`,
        `À vérifier sur le serveur : docker compose logs sauvegarde`,
      ];
  await transport.sendMail({ from: env("MAIL_EXPEDITEUR", process.env.SMTP_USER || "belvie@localhost"), to: env("MAIL_DESTINATAIRE"), subject: sujet, text: lignes.join("\n") });
}

// Planificateur minimal : calcule le prochain HH:MM dans le fuseau voulu, attend, sauvegarde.
function prochaineEcheance(heure, fuseau) {
  const [h, m] = heure.split(":").map(Number);
  const maintenant = new Date();
  for (let jours = 0; jours < 3; jours++) {
    for (let decalage = -14; decalage <= 14; decalage++) {
      // On cherche l'instant UTC dont l'heure locale (fuseau) vaut h:m, aujourd'hui ou les jours suivants.
      const base = new Date(Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate() + jours, h - decalage, m, 0));
      const local = new Intl.DateTimeFormat("en-GB", { timeZone: fuseau, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(base);
      if (local === `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}` && base > maintenant) return base;
    }
  }
  throw new Error("Impossible de calculer la prochaine échéance de sauvegarde.");
}

async function planifier() {
  const heure = heureSauvegarde(); const fuseau = env("TZ_SAUVEGARDE", "Europe/Paris");
  nombreVersions(); // validée dès le démarrage, pas seulement à minuit
  for (;;) {
    const quand = prochaineEcheance(heure, fuseau);
    console.log(`[sauvegarde] prochaine sauvegarde : ${quand.toLocaleString("fr-FR", { timeZone: fuseau })} (${fuseau})`);
    await new Promise((ok) => setTimeout(ok, quand - Date.now()));
    try { await sauvegarder(); } catch (_) { /* déjà journalisé et notifié */ }
  }
}

if (require.main === module) {
  (process.argv.includes("--planifier") ? planifier() : sauvegarder()).catch(() => process.exit(1));
}
module.exports = { sauvegarder, prochaineEcheance, deps };
