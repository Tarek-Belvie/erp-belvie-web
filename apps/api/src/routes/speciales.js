// ================================================================================================
// ROUTES SPÉCIALES — tout ce qui n'est pas « un appel = une fonction métier » :
// envoi de fichiers, PDF, export Excel/CSV, sauvegardes, fichiers médias.
// Elles suivent la même convention que le registre (GET = lecture, POST = écriture, { resultat }).
// ================================================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { enregistrerTeleversement } = require("../lib/plateforme");
const { lire, typeDe, verifierRelatif, stockage } = require("../lib/stockage");
const { lireParametre } = require("./index");
const photos = require("../modules/photos");
const sauvegardesR2 = require("../lib/sauvegardesR2");
const bcPf = require("../modules/bcPf");
const bcPfPdf = require("../modules/bcPfPdf");
const commandes = require("../modules/commandes");
const entreprise = require("../modules/entreprise");
const articles = require("../modules/articles");
const ficheTechnique = require("../modules/ficheTechnique");
const ficheTechniquePdf = require("../modules/ficheTechniquePdf");
const system = require("../modules/system");

const envoi = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });

function nomFichierSur(nom, defaut) {
  const n = String(nom || defaut).replace(/[\\/:*?"<>|\r\n]+/g, "-").slice(0, 150);
  return n || defaut;
}
function envoyerFichier(res, { contenu, type, nomFichier }) {
  res.setHeader("Content-Type", type);
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(nomFichier)}`);
  res.send(contenu);
}
async function genererPdf(construire, nomFichier, res) {
  const tmp = path.join(os.tmpdir(), `belvie-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.pdf`);
  try {
    await construire(tmp);
    envoyerFichier(res, { contenu: fs.readFileSync(tmp), type: "application/pdf", nomFichier });
  } finally {
    fs.rm(tmp, { force: true }, () => {});
  }
}
const indisponible = (message) => (_req, res) => res.status(400).json({ erreur: message });

function monterSpeciales({ db, exigerAdmin }) {
  const dbLecture = db; // lectures : même base (les générateurs PDF/export ne font que lire)
  const r = express.Router();
  const q = (req, nom) => lireParametre(req.query[nom]);

  // --- Envoi d'un fichier (remplace les sélecteurs natifs photos:pick, entreprise:pickLogo,
  //     ficheTechnique:pickCroquis, ficheTechnique:pickAccessoirePhoto). Renvoie le même aperçu.
  r.post("/fichiers", envoi.single("fichier"), async (req, res, next) => {
    try {
      if (!req.file) return res.status(400).json({ erreur: "Aucun fichier reçu." });
      const nomOriginal = Buffer.from(req.file.originalname, "latin1").toString("utf8");
      const jeton = await enregistrerTeleversement(req.file.buffer, nomOriginal);
      res.json({ resultat: await photos.decrireTeleversement(jeton, nomOriginal) });
    } catch (err) { next(err); }
  });

  // --- PDF
  r.get("/bcPf/telechargerPdf", async (req, res, next) => {
    try {
      const bc = await bcPf.get(dbLecture, q(req, "id"));
      if (!bc) return res.status(404).json({ erreur: "Bon de commande introuvable." });
      const ent = await entreprise.get(dbLecture);
      const html = bcPfPdf.buildBcPfHtml(bc, ent);
      await genererPdf((f) => bcPfPdf.genererPdfDepuisFenetreDediee(html, f), nomFichierSur(q(req, "suggestedName"), "bon-de-commande.pdf"), res);
    } catch (err) { next(err); }
  });
  r.get("/ficheTechnique/telechargerPdf", async (req, res, next) => {
    try {
      const fiche = await ficheTechnique.get(dbLecture, q(req, "ficheId"));
      if (!fiche) return res.status(404).json({ erreur: "Fiche technique introuvable." });
      const article = await articles.get(dbLecture, fiche.article_id);
      if (!article) return res.status(404).json({ erreur: "Article introuvable." });
      const ent = await entreprise.get(dbLecture);
      const html = ficheTechniquePdf.buildFicheTechniqueHtml(fiche, article, ent);
      await genererPdf((f) => ficheTechniquePdf.genererPdfDepuisFenetreDediee(html, f), nomFichierSur(q(req, "suggestedName"), "fiche-technique.pdf"), res);
    } catch (err) { next(err); }
  });

  // --- Lancer un BC PF : marque le document comme lancé, PUIS fait passer la commande en
  //     production si elle est encore « validée » (jamais l'inverse). Repris de l'ancien main.js.
  r.post("/bcPf/lancer", async (req, res, next) => {
    try {
      const id = (req.body || {}).id;
      const bc = await bcPf.lancerBcPf(db, id);
      try {
        const commande = await commandes.get(db, bc.commande_id);
        if (commande && commande.statut === "validee") await commandes.lancerProduction(db, bc.commande_id);
      } catch (err) {
        console.error("BC lancé, mais le passage automatique de la commande en production a échoué :", err);
      }
      res.json({ resultat: await bcPf.get(db, id) });
    } catch (err) { next(err); }
  });

  // --- Export Excel / CSV des commandes
  r.get("/system/exportFile", async (req, res, next) => {
    try { envoyerFichier(res, await system.exportFile(dbLecture, q(req, "format"))); } catch (err) { next(err); }
  });

  // --- Sauvegardes (administrateurs)
  r.post("/system/backup", exigerAdmin, async (req, res, next) => {
    try { res.json({ resultat: await system.backup(db, (req.body || {}).options) }); } catch (err) { next(err); }
  });
  r.post("/system/backupAvantOperation", exigerAdmin, async (req, res, next) => {
    try { res.json({ resultat: await system.backupAvantOperation(db, (req.body || {}).motif) }); } catch (err) { next(err); }
  });
  r.get("/system/listerSauvegardes", exigerAdmin, async (_req, res, next) => {
    try { res.json({ resultat: await system.listerSauvegardes() }); } catch (err) { next(err); }
  });
  r.get("/system/verifierSauvegarde", exigerAdmin, async (req, res, next) => {
    try { res.json({ resultat: await system.verifierSauvegarde(q(req, "dossier")) }); } catch (err) { next(err); }
  });
  r.get("/system/telechargerSauvegarde", exigerAdmin, (req, res, next) => {
    try {
      const p = system.cheminFichierSauvegarde(q(req, "nom"), q(req, "fichier"));
      res.download(p, `${path.basename(path.dirname(p))}-${path.basename(p)}`);
    } catch (err) { next(err); }
  });
  // Mode des sauvegardes : « serveur » (pg_dump sur le serveur Docker) ou « r2 » (version en ligne :
  // sauvegardes de la nuit dans Cloudflare R2, téléchargées par lien signé).
  r.get("/system/modeSauvegardes", exigerAdmin, (_req, res) => res.json({ resultat: { mode: sauvegardesR2.actif() ? "r2" : "serveur" } }));
  r.get("/system/lienSauvegarde", exigerAdmin, async (req, res, next) => {
    try {
      if (!sauvegardesR2.actif()) return res.status(400).json({ erreur: "Lien disponible uniquement pour la version en ligne." });
      res.json({ resultat: await sauvegardesR2.lienTelechargement(q(req, "nom")) });
    } catch (err) { next(err); }
  });
  r.get("/system/dossierExterne", (_req, res) => res.json({ resultat: { dossier: null } }));
  const msgRestauration = "La restauration se fait sur le serveur par un administrateur (procédure : docs/exploitation/sauvegarde-restauration.md).";
  r.post("/system/restore", indisponible(msgRestauration));
  r.post("/system/essaiRestauration", indisponible(msgRestauration));
  r.post("/system/choisirDossierExterne", indisponible("Les sauvegardes sont gérées sur le serveur : il n'y a plus de dossier à choisir."));
  r.post("/system/oublierDossierExterne", indisponible("Les sauvegardes sont gérées sur le serveur : il n'y a plus de dossier à choisir."));
  r.post("/system/loadDemoData", exigerAdmin, async (_req, res, next) => {
    try { res.json({ resultat: await system.loadDemoData(db) }); } catch (err) { next(err); }
  });
  r.post("/system/clearDemoData", exigerAdmin, async (_req, res, next) => {
    try { res.json({ resultat: await system.clearDemoData(db) }); } catch (err) { next(err); }
  });
  r.get("/system/version", (_req, res) => res.json({ resultat: { version: system.versionApplication() } }));
  return r;
}

// Fichiers médias (photos, logo, croquis) : uniquement le dossier images/, session obligatoire.
// Servis depuis le stockage (disque ou R2) ; les noms sont uniques (UUID) donc jamais modifiés :
// le navigateur peut les garder en cache.
function routeMedias() {
  return async (req, res) => {
    let rel;
    try { rel = verifierRelatif(decodeURIComponent(req.path.replace(/^\//, ""))); } catch (_) { return res.status(400).end(); }
    if (!rel.startsWith("images/")) return res.status(404).end();
    try {
      // Mode R2 : redirection vers un lien signé d'une heure (session déjà vérifiée par l'API). La
      // redirection elle-même est gardée 50 minutes par le navigateur : pas d'appel à chaque affichage.
      const s = stockage();
      if (s.mode === "r2") {
        res.setHeader("Cache-Control", "private, max-age=3000");
        return res.redirect(302, await s.lienSigne(rel, 3600));
      }
      const contenu = await lire(rel);
      if (!contenu) return res.status(404).end();
      res.setHeader("Content-Type", typeDe(rel));
      res.setHeader("Cache-Control", "private, max-age=604800, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.send(contenu);
    } catch (err) {
      console.error("Lecture du média impossible :", rel, err.message);
      res.status(502).end();
    }
  };
}

// Chemins traités ici : ils ne doivent JAMAIS exister aussi dans le registre (voir monterRegistre),
// sinon une version sans contrôle (admin, fichier…) pourrait être servie selon l'ordre de montage.
const CHEMINS_SPECIAUX = new Set([
  "/fichiers", "/bcPf/telechargerPdf", "/ficheTechnique/telechargerPdf", "/bcPf/lancer", "/system/exportFile",
  "/system/backup", "/system/backupAvantOperation", "/system/listerSauvegardes", "/system/verifierSauvegarde",
  "/system/telechargerSauvegarde", "/system/dossierExterne", "/system/restore", "/system/essaiRestauration",
  "/system/choisirDossierExterne", "/system/oublierDossierExterne", "/system/loadDemoData", "/system/clearDemoData", "/system/version",
  "/system/modeSauvegardes", "/system/lienSauvegarde",
]);

module.exports = { monterSpeciales, routeMedias, CHEMINS_SPECIAUX };
