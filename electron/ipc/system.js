const path = require("path");
const fs = require("fs");
const { dialog, app } = require("electron");
const XLSX = require("xlsx");
const photos = require("./photos");
const sauvegarde = require("./sauvegarde");
const demoData = require("../db/demoData");
const DEFAULTS = require("../db/defaults");
const { normalizeNom } = require("../db/normalize");

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

// ================================================================================================
// SAUVEGARDE ET RESTAURATION — lot 2
// ================================================================================================
// Toute la mécanique vit dans ./sauvegarde.js, qui ne dépend ni d'Electron ni de better-sqlite3 et
// peut donc être éprouvé en entier hors application. Ce fichier-ci ne fait que ce qu'il est seul à
// pouvoir faire : demander un dossier à l'utilisateur, et fournir de quoi ouvrir une base.
//
// L'ANCIENNE VERSION NE COPIAIT QU'UN DOSSIER D'IMAGES SUR CINQ. Sur les données réelles mesurées
// au lot 0, 93 images — croquis techniques et logo compris — ne partaient pas dans la sauvegarde,
// et la restauration avait le même angle mort.

const CLE_DOSSIER_EXTERNE = "sauvegarde_dossier_externe";

/** Ouvre une base en LECTURE SEULE, pour la vérification. Injecté dans le module de sauvegarde
 *  plutôt qu'importé par lui : c'est ce qui le garde indépendant de better-sqlite3. */
function ouvrirBaseLecture(chemin) {
  const Database = require("better-sqlite3");
  return new Database(chemin, { readonly: true, fileMustExist: true });
}

function dossierDonnees() {
  return app.getPath("userData");
}

function versionApplication() {
  try { return require("../../package.json").version; } catch (_) { return null; }
}

/** L'emplacement externe choisi pour les sauvegardes complètes (exigence n° 4). Rangé dans la
 *  table `parametres`, comme les autres réglages — donc sauvegardé avec la base. */
function lireDossierExterne(db) {
  try {
    const row = db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(CLE_DOSSIER_EXTERNE);
    return row && row.valeur ? row.valeur : null;
  } catch (_) { return null; }
}

function definirDossierExterne(db, chemin) {
  const valeur = chemin && String(chemin).trim() ? String(chemin).trim() : null;
  if (valeur === null) {
    db.prepare("DELETE FROM parametres WHERE cle = ?").run(CLE_DOSSIER_EXTERNE);
  } else {
    db.prepare(
      "INSERT INTO parametres (cle, valeur) VALUES (?, ?) " +
      "ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur"
    ).run(CLE_DOSSIER_EXTERNE, valeur);
  }
  return { dossier: valeur };
}

async function choisirDossier(mainWindow, titre) {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: titre,
    properties: ["openDirectory", "createDirectory"],
  });
  if (canceled || filePaths.length === 0) return null;
  return filePaths[0];
}

/** Sauvegarde COMPLÈTE, à l'endroit choisi — clé USB, disque externe, dossier partagé. */
async function backup(db, mainWindow, options) {
  const opts = options || {};
  let destination = opts.destination || null;
  if (!destination) {
    destination = await choisirDossier(mainWindow, "Choisir où enregistrer la sauvegarde complète");
    if (!destination) return { canceled: true };
  }
  const r = await sauvegarde.sauvegardeComplete(db, dossierDonnees(), destination, {
    version: versionApplication(),
    ouvrirBase: ouvrirBaseLecture,
  });
  if (opts.memoriser) definirDossierExterne(db, destination);
  return {
    canceled: false,
    folderPath: r.dossier,
    manifeste: r.manifeste,
    verification: r.verification,
  };
}

/** Sauvegarde AUTOMATIQUE, à la fermeture : la base et un inventaire des images, pas les images. */
async function autoBackup(db, keep) {
  return sauvegarde.sauvegardeAutomatique(db, dossierDonnees(), {
    garder: keep === undefined ? 10 : keep,
    version: versionApplication(),
  });
}

/** Sauvegarde complète avant une installation ou une migration (exigence n° 3). */
async function backupAvantOperation(db, motif) {
  return sauvegarde.sauvegardeAvantOperation(db, dossierDonnees(), motif || "operation", {
    dossierExterne: lireDossierExterne(db),
    version: versionApplication(),
    ouvrirBase: ouvrirBaseLecture,
  });
}

/** Vérifier une sauvegarde sans rien restaurer : les sept contrôles, sur un dossier choisi. */
async function verifierSauvegarde(mainWindow, dossier) {
  let cible = dossier || null;
  if (!cible) {
    cible = await choisirDossier(mainWindow, "Choisir la sauvegarde à vérifier");
    if (!cible) return { canceled: true };
  }
  return { canceled: false, rapport: sauvegarde.verifierSauvegarde(cible, { ouvrirBase: ouvrirBaseLecture }) };
}

/**
 * ESSAI de restauration, dans un dossier isolé (exigence n° 6).
 *
 * C'est la seule façon de répondre à « ma sauvegarde est-elle exploitable ? » sans risque : on
 * restaure ailleurs et on vérifie le résultat. Le dossier de données réel n'est pas touché, et le
 * module refuse catégoriquement de l'utiliser comme cible.
 */
async function essaiRestauration(mainWindow, dossierSauvegarde, dossierEssai) {
  let source = dossierSauvegarde || null;
  if (!source) {
    source = await choisirDossier(mainWindow, "Choisir la sauvegarde à essayer");
    if (!source) return { canceled: true };
  }
  let cible = dossierEssai || null;
  if (!cible) {
    const parent = await choisirDossier(mainWindow, "Choisir un dossier VIDE pour l'essai de restauration");
    if (!parent) return { canceled: true };
    cible = path.join(parent, "essai-restauration-" + new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19));
  }
  const r = sauvegarde.restaurerVersDossierIsole(source, cible, {
    ouvrirBase: ouvrirBaseLecture,
    dossierDonnees: dossierDonnees(),
  });
  return Object.assign({ canceled: false }, r);
}

/** Les sauvegardes présentes sous un dossier, avec leur type et leur date. */
async function listerSauvegardes(mainWindow, dossier) {
  let cible = dossier || null;
  if (!cible) {
    cible = await choisirDossier(mainWindow, "Choisir le dossier contenant vos sauvegardes");
    if (!cible) return { canceled: true };
  }
  return { canceled: false, dossier: cible, sauvegardes: sauvegarde.listerSauvegardes(cible) };
}

/**
 * RESTAURATION RÉELLE. La sauvegarde est vérifiée d'abord ; les données actuelles sont DÉPLACÉES
 * dans `backups/avant-restauration-<date>`, jamais supprimées ; et le dossier `backups` lui-même
 * n'est pas touché, donc les sauvegardes existantes survivent.
 */
async function restore(mainWindow, deps, options) {
  const opts = options || {};
  let source = opts.dossier || null;
  if (!source) {
    source = await choisirDossier(mainWindow, "Choisir le dossier de sauvegarde à restaurer");
    if (!source) return { canceled: true };
  }

  const r = sauvegarde.restaurerSurPlace(source, dossierDonnees(), {
    ouvrirBase: ouvrirBaseLecture,
    forcer: !!opts.forcer,
    fermerBase: deps.closeDatabase,
    ouvrirBaseApres: deps.openDatabase,
  });
  return Object.assign({ canceled: false, restoredFrom: source }, r);
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
  backupAvantOperation: backupAvantOperation,
  restore: restore,
  verifierSauvegarde: verifierSauvegarde,
  essaiRestauration: essaiRestauration,
  listerSauvegardes: listerSauvegardes,
  lireDossierExterne: lireDossierExterne,
  definirDossierExterne: definirDossierExterne,
  choisirDossier: choisirDossier,
  ouvrirBaseLecture: ouvrirBaseLecture,
  exportFile: exportFile,
  loadDemoData: loadDemoData,
  clearDemoData: clearDemoData,
};
