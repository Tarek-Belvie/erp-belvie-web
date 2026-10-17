// ================================================================================================
// SYSTÈME — version serveur.
//
// Ce qui disparaît avec le passage au web (et pourquoi) :
//   * dossier de données %APPDATA%, instance unique, choix d'un dossier externe : ils n'ont plus de
//     sens, la base est un serveur PostgreSQL et les fichiers sont dans DOSSIER_DONNEES ;
//   * restauration depuis l'interface : sur un serveur partagé, remplacer la base sous les pieds
//     des autres utilisateurs est trop dangereux. Elle se fait par une procédure d'administration
//     (docs/exploitation/sauvegarde-restauration.md), jamais par un bouton.
//
// Ce qui est conservé : la sauvegarde complète (base + fichiers + manifeste + vérification),
// l'export Excel/CSV des commandes, le chargement et le retrait des données de démonstration.
// ================================================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { promisify } = require("util");
const XLSX = require("xlsx");
const demoData = require("../lib/demoData");
const DEFAULTS = require("../lib/defaults");
const { normalizeNom } = require("../lib/normalize");
const { dossierDonnees } = require("../lib/plateforme");

const executer = promisify(execFile);
const FORMAT_MANIFESTE = 2;

function todayStamp() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function horodatage() {
  return new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
}
function versionApplication() {
  try { return require("../../package.json").version; } catch (_) { return null; }
}
function dossierSauvegardes() {
  const d = path.resolve(process.env.DOSSIER_SAUVEGARDES || path.join(dossierDonnees(), "..", "sauvegardes"));
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function sha256(fichier) {
  return new Promise((ok, ko) => {
    const h = crypto.createHash("sha256");
    fs.createReadStream(fichier).on("data", (c) => h.update(c)).on("end", () => ok(h.digest("hex"))).on("error", ko);
  });
}
async function comptagesTables(db) {
  const tables = await db.prepare("SELECT table_name AS t FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name").all();
  const out = {};
  for (const { t } of tables) out[t] = (await db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get()).n;
  return out;
}

// ------------------------------------------------------------------------------------------------
// Sauvegarde complète : base (pg_dump, format custom) + fichiers (images…) + manifeste.
// ------------------------------------------------------------------------------------------------
async function backup(db, options = {}) {
  const motif = String((options && options.motif) || "manuelle").replace(/[^a-z0-9-]/gi, "-").slice(0, 40);
  const nom = `belvie-${horodatage()}-${motif}`;
  const cible = path.join(dossierSauvegardes(), nom);
  fs.mkdirSync(cible, { recursive: true });

  const fichierBase = path.join(cible, "base.dump");
  await executer("pg_dump", ["--format=custom", "--no-owner", "--no-privileges", "--file", fichierBase, process.env.DATABASE_URL], { maxBuffer: 1 << 26 });

  const fichierImages = path.join(cible, "fichiers.tar.gz");
  const donnees = dossierDonnees();
  const aArchiver = fs.readdirSync(donnees).filter((f) => f !== "televersements");
  if (aArchiver.length) await executer("tar", ["-czf", fichierImages, "-C", donnees, ...aArchiver]);

  const manifeste = {
    format: FORMAT_MANIFESTE,
    application: "belvie-erp",
    version: versionApplication(),
    cree_le: new Date().toISOString(),
    motif,
    tables: await comptagesTables(db),
    fichiers: {},
  };
  for (const f of ["base.dump", "fichiers.tar.gz"]) {
    const p = path.join(cible, f);
    if (fs.existsSync(p)) manifeste.fichiers[f] = { taille: fs.statSync(p).size, sha256: await sha256(p) };
  }
  fs.writeFileSync(path.join(cible, "manifeste.json"), JSON.stringify(manifeste, null, 2));
  const rapport = await verifierSauvegarde(nom);
  return { canceled: false, nom, dossier: cible, manifeste, rapport: rapport.rapport };
}

async function backupAvantOperation(db, motif) {
  return backup(db, { motif: "avant-" + (motif || "operation") });
}

// Contrôles : manifeste lisible et au bon format, empreintes identiques, archive de base lisible
// par pg_restore. « Non effectué » ne vaut jamais réussite.
async function verifierSauvegarde(nom) {
  const dossier = path.join(dossierSauvegardes(), path.basename(String(nom || "")));
  const controles = [];
  const ajouter = (libelle, ok, detail) => controles.push({ libelle, ok, detail: detail || null });
  let manifeste = null;
  try {
    manifeste = JSON.parse(fs.readFileSync(path.join(dossier, "manifeste.json"), "utf8"));
    ajouter("Manifeste présent et lisible", true);
  } catch (err) { ajouter("Manifeste présent et lisible", false, err.message); }
  if (manifeste) {
    ajouter("Format de manifeste connu", manifeste.format === FORMAT_MANIFESTE, `format ${manifeste.format}`);
    for (const [f, attendu] of Object.entries(manifeste.fichiers || {})) {
      const p = path.join(dossier, f);
      if (!fs.existsSync(p)) { ajouter(`${f} présent`, false); continue; }
      const reel = await sha256(p);
      ajouter(`${f} intact (SHA-256)`, reel === attendu.sha256);
    }
    try {
      await executer("pg_restore", ["--list", path.join(dossier, "base.dump")], { maxBuffer: 1 << 26 });
      ajouter("Archive de base lisible par pg_restore", true);
    } catch (err) { ajouter("Archive de base lisible par pg_restore", false, err.message.slice(0, 300)); }
  }
  return { nom: path.basename(dossier), rapport: { ok: controles.length > 0 && controles.every((c) => c.ok), controles } };
}

async function listerSauvegardes() {
  const d = dossierSauvegardes();
  return fs.readdirSync(d).filter((n) => fs.existsSync(path.join(d, n, "manifeste.json"))).sort().reverse().map((n) => {
    let m = {};
    try { m = JSON.parse(fs.readFileSync(path.join(d, n, "manifeste.json"), "utf8")); } catch (_) { /* signalé par la vérification */ }
    const taille = Object.values(m.fichiers || {}).reduce((a, f) => a + (f.taille || 0), 0);
    return { nom: n, cree_le: m.cree_le || null, motif: m.motif || null, version: m.version || null, taille };
  });
}

// Rotation des sauvegardes AUTOMATIQUES uniquement ; les sauvegardes manuelles ne sont jamais purgées.
async function autoBackup(db, garder = 10) {
  const r = await backup(db, { motif: "auto" });
  const autos = (await listerSauvegardes()).filter((s) => s.motif === "auto");
  for (const s of autos.slice(garder)) fs.rmSync(path.join(dossierSauvegardes(), s.nom), { recursive: true, force: true });
  return r;
}

function cheminFichierSauvegarde(nom, fichier) {
  if (!["base.dump", "fichiers.tar.gz", "manifeste.json"].includes(fichier)) throw new Error("Fichier de sauvegarde inconnu.");
  const p = path.join(dossierSauvegardes(), path.basename(String(nom || "")), fichier);
  if (!fs.existsSync(p)) throw new Error("Sauvegarde introuvable.");
  return p;
}

// ------------------------------------------------------------------------------------------------
// Export des commandes (Excel ou CSV) — renvoie le contenu, l'API le transmet en téléchargement.
// ------------------------------------------------------------------------------------------------
async function fetchExportRows(db) {
  return await db.prepare(
    "SELECT " +
    "c.numero AS \"Numéro\", c.reference_production AS \"Référence de production\", " +
    "ar.reference_principale AS \"Référence article\", p.nom AS \"Produit\", " +
    "c.type_production AS \"Type\", c.numero_reassort AS \"N° réassort\", " +
    "(SELECT COUNT(DISTINCT couleur_id) FROM commande_lignes WHERE commande_id = c.id) AS \"Nb couleurs\", " +
    "(SELECT COUNT(DISTINCT taille_id) FROM commande_lignes WHERE commande_id = c.id AND taille_id IS NOT NULL) AS \"Nb tailles\", " +
    "c.quantite_totale AS \"Quantité totale\", " +
    "c.responsable_nom AS \"Responsable\", a.nom AS \"Atelier\", " +
    "c.date_lancement AS \"Date de lancement\", c.date_fin_prevue AS \"Date limite de production\", " +
    "e.libelle AS \"Étape\", " +
    "c.statut AS \"Statut\", c.priorite AS \"Priorité\", " +
    "CASE c.bloquee WHEN 1 THEN 'Oui' ELSE 'Non' END AS \"Bloquée\", c.blocage_motif AS \"Motif de blocage\", " +
    "c.commentaires AS \"Commentaires\", " +
    "CASE c.archived WHEN 1 THEN 'Oui' ELSE 'Non' END AS \"Archivée\", " +
    "c.created_at AS \"Créée le\", c.updated_at AS \"Modifiée le\" " +
    "FROM commandes c " +
    "JOIN etapes e ON e.id = c.etape_id " +
    "JOIN articles ar ON ar.id = c.article_id " +
    "JOIN listes_valeurs p ON p.id = ar.produit_id " +
    "JOIN listes_valeurs a ON a.id = c.atelier_id " +
    "WHERE c.deleted_at IS NULL " +
    "ORDER BY c.created_at ASC"
  ).all();
}

async function fetchExportLignes(db) {
  return await db.prepare(
    "SELECT " +
    "COALESCE(c.numero, 'Brouillon #' || c.id) AS \"Commande\", c.reference_production AS \"Référence de production\", " +
    "co.nom AS \"Couleur\", cl.reference_libre AS \"Réf couleur\", COALESCE(t.valeur, cl.taille_nom, 'Non renseignée') AS \"Taille\", cl.quantite AS \"Quantité\" " +
    "FROM commande_lignes cl " +
    "JOIN commandes c ON c.id = cl.commande_id " +
    "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
    "LEFT JOIN grilles_tailles_valeurs t ON t.id = cl.taille_id " +
    "WHERE c.deleted_at IS NULL " +
    "ORDER BY c.created_at ASC, LOWER(co.nom) COLLATE ucs_basic ASC, t.ordre ASC"
  ).all();
}

// Renvoie { nomFichier, type, contenu (Buffer) }.
async function exportFile(db, format) {
  const rows = await fetchExportRows(db);
  const ext = format === "csv" ? "csv" : "xlsx";
  const nomFichier = "belvie-commandes-" + todayStamp() + "." + ext;
  if (ext === "csv") {
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet(rows));
    return { nomFichier, type: "text/csv; charset=utf-8", contenu: Buffer.from("﻿" + csv, "utf-8") };
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Commandes");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(await fetchExportLignes(db)), "Détail couleurs-tailles");
  return {
    nomFichier,
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    contenu: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }),
  };
}

// ------------------------------------------------------------------------------------------------
// Données de démonstration
// ------------------------------------------------------------------------------------------------
async function loadDemoData(db) {
  return await demoData.loadDemoData(db);
}

async function clearDemoData(db) {
  const tx = db.transaction(async function () {
    const infoCmd = await db.prepare("DELETE FROM commandes WHERE est_demo = 1").run();
    const infoArt = await db.prepare("DELETE FROM articles WHERE est_demo = 1").run();

    const deactivate = db.prepare("UPDATE listes_valeurs SET actif = 0 WHERE type = ? AND nom_normalise = ?");
    for (const n of DEFAULTS.DEMO_PRODUITS) await deactivate.run("produit", normalizeNom(n));
    for (const n of DEFAULTS.DEMO_COULEURS) await deactivate.run("couleur", normalizeNom(n));
    for (const n of DEFAULTS.DEMO_RESPONSABLES) await deactivate.run("responsable", normalizeNom(n));
    for (const n of DEFAULTS.DEMO_ATELIERS) await deactivate.run("atelier", normalizeNom(n));
    for (const n of DEFAULTS.DEMO_OPERATEURS) await deactivate.run("operateur", normalizeNom(n));

    const actif = await db.prepare("SELECT valeur FROM parametres WHERE cle = 'operateur_actif_id'").get();
    if (actif) {
      const op = await db.prepare("SELECT actif FROM listes_valeurs WHERE id = ?").get(Number(actif.valeur));
      if (!op || !op.actif) await db.prepare("DELETE FROM parametres WHERE cle = 'operateur_actif_id'").run();
    }

    return { removed: infoCmd.changes, articlesRemoved: infoArt.changes };
  });
  return await tx();
}

module.exports = {
  backup, backupAvantOperation, verifierSauvegarde, listerSauvegardes, autoBackup, cheminFichierSauvegarde,
  exportFile, loadDemoData, clearDemoData, comptagesTables, versionApplication,
};
