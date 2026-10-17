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
  const d = path.resolve(process.env.DOSSIER_DONNEES || path.join(__dirname, "../../../../donnees"));
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
function enregistrerTeleversement(buffer, nomOriginal) {
  const ext = path.extname(nomOriginal || "").toLowerCase().replace(/[^.a-z0-9]/g, "");
  const nom = crypto.randomUUID() + ext;
  fs.writeFileSync(path.join(dossierTeleversements(), nom), buffer);
  return "televersement:" + nom;
}
function resoudreTeleversement(jeton) {
  const m = /^televersement:([0-9a-f-]{36}\.[a-z0-9]{1,5})$/.exec(String(jeton || ""));
  if (!m) throw new Error("Fichier envoyé introuvable ou invalide.");
  return path.join(dossierTeleversements(), m[1]);
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

module.exports = { dossierDonnees, dossierTeleversements, enregistrerTeleversement, resoudreTeleversement, nettoyerTeleversements, cheminMedia };
