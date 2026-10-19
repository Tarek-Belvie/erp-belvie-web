// ================================================================================================
// Emplacements sur le serveur — remplace app.getPath("userData") d'Electron.
//
// DOSSIER_DONNEES contient les fichiers de l'application, avec EXACTEMENT la même arborescence que
// l'ancien %APPDATA%\belvie-erp (images/commandes, images/entreprise, images/fiches…). Les chemins
// enregistrés en base sont relatifs à ce dossier : la reprise des fichiers consiste donc à copier
// le dossier « images » de l'ancien poste dans DOSSIER_DONNEES, sans rien réécrire en base.
// ================================================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function dossierDonnees() {
  // Sur Vercel, seul le dossier temporaire est accessible en écriture (et rien n'y est conservé :
  // les fichiers durables vont dans R2, voir lib/stockage.js).
  const defaut = process.env.VERCEL ? path.join(require("os").tmpdir(), "belvie-donnees") : path.join(__dirname, "../../../../donnees");
  const d = path.resolve(process.env.DOSSIER_DONNEES || defaut);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// Fichiers envoyés par le navigateur (photos, logo, croquis) avant leur enregistrement définitif.
// Le navigateur ne reçoit qu'un identifiant « televersement:<uuid>.<ext> », jamais un chemin réel.
function dossierTeleversements() {
  const d = path.join(dossierDonnees(), "televersements");
  fs.mkdirSync(d, { recursive: true });
  return d;
}
// Le fichier envoyé est rangé dans le stockage (disque ou R2) sous « televersements/ » : sur
// Vercel, la requête qui l'utilisera ensuite peut tourner sur une autre instance.
async function enregistrerTeleversement(buffer, nomOriginal) {
  const ext = path.extname(nomOriginal || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  const nom = crypto.randomUUID() + ext;
  await require("./stockage").ecrire("televersements/" + nom, buffer);
  return "televersement:" + nom;
}
// Renvoie un chemin LOCAL lisible (sharp, copie…) : le fichier lui-même en mode disque, une copie
// dans le dossier temporaire en mode R2.
async function resoudreTeleversement(jeton) {
  const m = /^televersement:([0-9a-f-]{36}\.[a-z0-9]{1,5})$/.exec(String(jeton || ""));
  if (!m) throw new Error("Fichier envoyé introuvable ou invalide.");
  const { stockage } = require("./stockage");
  if (stockage().mode === "disque") return path.join(dossierTeleversements(), m[1]);
  const contenu = await stockage().lire("televersements/" + m[1]);
  if (!contenu) throw new Error("Fichier envoyé introuvable ou expiré. Choisissez-le à nouveau.");
  fs.mkdirSync(DOSSIER_COPIES, { recursive: true });
  purgerCopiesAnciennes();
  const local = path.join(DOSSIER_COPIES, m[1]);
  fs.writeFileSync(local, contenu);
  return local;
}
// Sur Vercel, /tmp est limité et partagé avec Chromium : chaque copie temporaire est supprimée dès
// que la requête qui l'utilise est terminée, et les restes éventuels (requête interrompue) au bout
// de 15 minutes. Seuls les fichiers de ce dossier temporaire sont concernés — jamais un original.
const DOSSIER_COPIES = path.join(require("os").tmpdir(), "belvie-televersements");
function libererCopieLocale(chemin) {
  if (!chemin || path.dirname(path.resolve(chemin)) !== DOSSIER_COPIES) return;
  try { fs.unlinkSync(chemin); } catch (_) { /* déjà supprimée */ }
}
function purgerCopiesAnciennes(ageMaxMs = 15 * 60 * 1000) {
  try {
    for (const f of fs.readdirSync(DOSSIER_COPIES)) {
      const p = path.join(DOSSIER_COPIES, f);
      try { if (Date.now() - fs.statSync(p).mtimeMs > ageMaxMs) fs.unlinkSync(p); } catch (_) { /* concurrente */ }
    }
  } catch (_) { /* dossier absent */ }
}
// Les téléversements non utilisés sont supprimés au bout de 24 h.
function nettoyerTeleversements(ageMaxMs = 24 * 3600 * 1000) {
  const d = dossierTeleversements();
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    try { if (Date.now() - fs.statSync(p).mtimeMs > ageMaxMs) fs.unlinkSync(p); } catch (_) { /* déjà supprimé */ }
  }
}

// Chemin absolu d'un fichier enregistré en base (chemin relatif), refusant toute sortie du dossier.
function cheminMedia(relatif) {
  const base = dossierDonnees();
  const abs = path.resolve(base, String(relatif || ""));
  if (!abs.startsWith(base + path.sep)) throw new Error("Chemin de fichier invalide.");
  return abs;
}

module.exports = { dossierDonnees, dossierTeleversements, enregistrerTeleversement, resoudreTeleversement, libererCopieLocale, nettoyerTeleversements, cheminMedia };
