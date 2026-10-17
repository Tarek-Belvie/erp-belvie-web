const path = require("path");
const fs = require("fs");
const { dialog, app } = require("electron");
const XLSX = require("xlsx");
const photos = require("./photos");
const demoData = require("../db/demoData");
const DEFAULTS = require("../db/defaults");
const { normalizeNom } = require("../db/normalize");

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function copyImagesDirIfPresent(destDir) {
  const imagesDir = photos.getImagesDir();
  if (fs.existsSync(imagesDir)) {
    fs.cpSync(imagesDir, path.join(destDir, "images", "commandes"), { recursive: true });
  }
}

async function backup(db, mainWindow) {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir où enregistrer la sauvegarde",
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };

  const destDir = path.join(filePaths[0], "belvie-sauvegarde-" + todayStamp());
  fs.mkdirSync(destDir, { recursive: true });

  await db.backup(path.join(destDir, "belvie.db"));
  copyImagesDirIfPresent(destDir);

  return { canceled: false, folderPath: destDir };
}

function getAutoBackupDir() {
  const dir = path.join(app.getPath("userData"), "backups", "auto");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function autoBackup(db, keep) {
  if (keep === undefined) keep = 5;
  const rootDir = getAutoBackupDir();
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const destDir = path.join(rootDir, "auto-" + stamp);
  fs.mkdirSync(destDir, { recursive: true });

  await db.backup(path.join(destDir, "belvie.db"));
  copyImagesDirIfPresent(destDir);

  const entries = fs.readdirSync(rootDir, { withFileTypes: true })
    .filter(function (e) { return e.isDirectory() && e.name.startsWith("auto-"); })
    .map(function (e) { return e.name; })
    .sort();

  const excess = entries.length - keep;
  if (excess > 0) {
    for (const name of entries.slice(0, excess)) {
      fs.rmSync(path.join(rootDir, name), { recursive: true, force: true });
    }
  }

  return destDir;
}

function resolveBackupFolder(selectedPath) {
  if (fs.statSync(selectedPath).isDirectory()) return selectedPath;
  return path.dirname(selectedPath);
}

async function restore(mainWindow, deps) {
  const getDbPath = deps.getDbPath;
  const closeDatabase = deps.closeDatabase;
  const openDatabase = deps.openDatabase;

  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Choisir le dossier de sauvegarde à restaurer",
    properties: ["openDirectory"],
  });
  if (canceled || filePaths.length === 0) return { canceled: true };

  const backupFolder = resolveBackupFolder(filePaths[0]);
  const sourceDb = path.join(backupFolder, "belvie.db");
  if (!fs.existsSync(sourceDb)) {
    throw new Error('Aucun fichier "belvie.db" trouvé dans "' + backupFolder + '". Sélectionnez le dossier créé par "Sauvegarder maintenant".');
  }

  const target = getDbPath();
  const stamp = Date.now();

  const safetyDbCopy = target + ".avant-restauration-" + stamp + ".bak";
  if (fs.existsSync(target)) fs.copyFileSync(target, safetyDbCopy);

  const imagesDir = photos.getImagesDir();
  let safetyImagesDir = null;
  if (fs.existsSync(imagesDir)) {
    safetyImagesDir = imagesDir + ".avant-restauration-" + stamp;
    fs.renameSync(imagesDir, safetyImagesDir);
  }

  closeDatabase();
  fs.copyFileSync(sourceDb, target);
  for (const ext of ["-wal", "-shm"]) {
    if (fs.existsSync(target + ext)) fs.unlinkSync(target + ext);
  }

  const sourceImages = path.join(backupFolder, "images", "commandes");
  if (fs.existsSync(sourceImages)) {
    fs.mkdirSync(path.dirname(imagesDir), { recursive: true });
    fs.cpSync(sourceImages, imagesDir, { recursive: true });
  }

  openDatabase();

  return { canceled: false, restoredFrom: backupFolder, safetyDbCopy: safetyDbCopy, safetyImagesDir: safetyImagesDir };
}

function fetchExportRows(db) {
  return db.prepare(
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

function fetchExportLignes(db) {
  return db.prepare(
    "SELECT " +
    "COALESCE(c.numero, 'Brouillon #' || c.id) AS \"Commande\", c.reference_production AS \"Référence de production\", " +
    "co.nom AS \"Couleur\", cl.reference_libre AS \"Réf couleur\", COALESCE(t.valeur, cl.taille_nom, 'Non renseignée') AS \"Taille\", cl.quantite AS \"Quantité\" " +
    "FROM commande_lignes cl " +
    "JOIN commandes c ON c.id = cl.commande_id " +
    "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
    "LEFT JOIN grilles_tailles_valeurs t ON t.id = cl.taille_id " +
    "WHERE c.deleted_at IS NULL " +
    "ORDER BY c.created_at ASC, co.nom COLLATE NOCASE ASC, t.ordre ASC"
  ).all();
}

async function exportFile(db, mainWindow, format) {
  const rows = fetchExportRows(db);
  const ext = format === "csv" ? "csv" : "xlsx";
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Exporter en " + ext.toUpperCase(),
    defaultPath: "belvie-commandes-" + todayStamp() + "." + ext,
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (canceled || !filePath) return { canceled: true };

  if (format === "csv") {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(worksheet);
    fs.writeFileSync(filePath, "\uFEFF" + csv, "utf-8");
  } else {
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "Commandes");
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(fetchExportLignes(db)), "Détail couleurs-tailles");
    XLSX.writeFile(workbook, filePath);
  }
  return { canceled: false, filePath: filePath };
}

function loadDemoData(db) {
  return demoData.loadDemoData(db);
}

function clearDemoData(db) {
  const tx = db.transaction(function () {
    const infoCmd = db.prepare("DELETE FROM commandes WHERE est_demo = 1").run();
    const infoArt = db.prepare("DELETE FROM articles WHERE est_demo = 1").run();

    const deactivate = db.prepare("UPDATE listes_valeurs SET actif = 0 WHERE type = ? AND nom_normalise = ?");
    DEFAULTS.DEMO_PRODUITS.forEach(function (n) { deactivate.run("produit", normalizeNom(n)); });
    DEFAULTS.DEMO_COULEURS.forEach(function (n) { deactivate.run("couleur", normalizeNom(n)); });
    DEFAULTS.DEMO_RESPONSABLES.forEach(function (n) { deactivate.run("responsable", normalizeNom(n)); });
    DEFAULTS.DEMO_ATELIERS.forEach(function (n) { deactivate.run("atelier", normalizeNom(n)); });
    DEFAULTS.DEMO_OPERATEURS.forEach(function (n) { deactivate.run("operateur", normalizeNom(n)); });

    const actif = db.prepare("SELECT valeur FROM parametres WHERE cle = 'operateur_actif_id'").get();
    if (actif) {
      const op = db.prepare("SELECT actif FROM listes_valeurs WHERE id = ?").get(Number(actif.valeur));
      if (!op || !op.actif) db.prepare("DELETE FROM parametres WHERE cle = 'operateur_actif_id'").run();
    }

    return { removed: infoCmd.changes, articlesRemoved: infoArt.changes };
  });
  return tx();
}

module.exports = {
  backup: backup,
  autoBackup: autoBackup,
  restore: restore,
  exportFile: exportFile,
  loadDemoData: loadDemoData,
  clearDemoData: clearDemoData,
};
