/**
 * Belvie ERP — Diagnostic des deux référentiels de couleurs
 *
 * LECTURE SEULE. N'écrit rien, ne crée rien, ne modifie rien.
 *
 * Usage, depuis la racine du projet (là où se trouve node_modules) :
 *
 *     node diagnostic-couleurs.js
 *     node diagnostic-couleurs.js 12        <- 12 = id de l'article à analyser
 *
 * Sans argument, le script liste les articles disponibles et s'arrête.
 */

const path = require("path");
const fs = require("fs");

const dbPath = path.join(
  process.env.APPDATA || path.join(process.env.HOME || "", ".config"),
  "belvie-erp",
  "belvie.db"
);

if (!fs.existsSync(dbPath)) {
  console.error("Base introuvable : " + dbPath);
  process.exit(1);
}

let Database;
try {
  Database = require("better-sqlite3");
} catch (e) {
  console.error("Lancez ce script depuis la racine du projet (dossier contenant node_modules).");
  process.exit(1);
}

const db = new Database(dbPath, { readonly: true });
const articleId = process.argv[2] ? Number(process.argv[2]) : null;

function titre(t) {
  console.log("\n" + "=".repeat(78) + "\n" + t + "\n" + "=".repeat(78));
}

// ------------------------------------------------------------------ articles
if (!articleId) {
  titre("ARTICLES DISPONIBLES — relancez avec l'id de celui à analyser");
  const arts = db.prepare(
    "SELECT a.id, a.reference_principale, p.nom AS produit " +
    "FROM articles a LEFT JOIN listes_valeurs p ON p.id = a.produit_id " +
    "ORDER BY a.id"
  ).all();
  arts.forEach((a) => console.log("  id=" + String(a.id).padEnd(4) + (a.reference_principale || "(sans réf.)").padEnd(24) + (a.produit || "")));
  console.log("\nExemple : node diagnostic-couleurs.js " + (arts[0] ? arts[0].id : 1));
  process.exit(0);
}

// -------------------------------------------------- GROUPE 1 : listes_valeurs
titre("GROUPE 1 — listes_valeurs (type='couleur') : LE référentiel de production");
const lv = db.prepare(
  "SELECT id, nom, nom_normalise, actif FROM listes_valeurs WHERE type = 'couleur' " +
  "ORDER BY nom COLLATE NOCASE ASC"
).all();
console.log("  " + lv.length + " couleur(s) au total, dont " + lv.filter((c) => c.actif).length + " active(s).\n");
lv.forEach((c) => console.log("  id=" + String(c.id).padEnd(5) + (c.actif ? "[ACTIVE]  " : "[inactive]") + " " + c.nom));

// ------------------------------------------- GROUPE 2 : declinaison_valeurs
titre("GROUPE 2 — declinaison_valeurs : le référentiel du module Articles");
const types = db.prepare(
  "SELECT id, nom, code, affichage_couleur, actif FROM declinaison_types ORDER BY ordre, nom"
).all();
console.log("  Types de déclinaison définis :");
types.forEach((t) => console.log("    id=" + String(t.id).padEnd(4) + t.nom.padEnd(20) +
  " code=" + String(t.code).padEnd(12) + (t.affichage_couleur ? "affichage_couleur=1" : "") + (t.actif ? "" : "  [type inactif]")));

const typesCouleur = types.filter((t) => t.affichage_couleur === 1);
if (typesCouleur.length === 0) {
  console.log("\n  Aucun type avec affichage_couleur=1 : le module Articles ne gère pas de couleurs.");
}
const dv = typesCouleur.length
  ? db.prepare(
      "SELECT dv.id, dv.valeur, dv.valeur_normalisee, dv.actif, dt.nom AS type_nom " +
      "FROM declinaison_valeurs dv JOIN declinaison_types dt ON dt.id = dv.declinaison_type_id " +
      "WHERE dt.affichage_couleur = 1 ORDER BY dv.valeur COLLATE NOCASE ASC"
    ).all()
  : [];
console.log("\n  " + dv.length + " valeur(s) de couleur, dont " + dv.filter((c) => c.actif).length + " active(s).\n");
dv.forEach((c) => console.log("  id=" + String(c.id).padEnd(5) + (c.actif ? "[ACTIVE]  " : "[inactive]") + " " + c.valeur + "   (" + c.type_nom + ")"));

// ------------------------------------------------ GROUPE 3 : couleurs article
titre("GROUPE 3 — couleurs déclarées pour l'article " + articleId);
const art = db.prepare(
  "SELECT a.id, a.reference_principale, p.nom AS produit FROM articles a " +
  "LEFT JOIN listes_valeurs p ON p.id = a.produit_id WHERE a.id = ?"
).get(articleId);
if (!art) { console.log("  Article introuvable."); process.exit(1); }
console.log("  " + (art.reference_principale || "(sans réf.)") + " — " + (art.produit || "") + "\n");

const artCouleurs = db.prepare(
  "SELECT dv.id, dv.valeur, dv.valeur_normalisee, dv.actif, dt.nom AS type_nom " +
  "FROM article_declinaison_valeurs adv " +
  "JOIN declinaison_valeurs dv ON dv.id = adv.declinaison_valeur_id " +
  "JOIN declinaison_types dt ON dt.id = adv.declinaison_type_id " +
  "WHERE adv.article_id = ? AND dt.affichage_couleur = 1 " +
  "ORDER BY dv.valeur COLLATE NOCASE ASC"
).all(articleId);
console.log("  " + artCouleurs.length + " couleur(s) (source : declinaison_valeurs, PAS listes_valeurs).\n");
artCouleurs.forEach((c) => console.log("  dv.id=" + String(c.id).padEnd(5) + (c.actif ? "[ACTIVE]  " : "[inactive]") + " " + c.valeur));

// ------------------------------------------------ GROUPE 4 : menu de l'écran
titre("GROUPE 4 — ce que le menu « Couleur produit » affiche aujourd'hui");
console.log("  Requête exacte : listes.list(db,'couleur') => type='couleur' AND actif=1, tri alphabétique.\n");
const menu = lv.filter((c) => c.actif);
console.log("  " + menu.length + " entrée(s) :\n");
menu.forEach((c) => console.log("  id=" + String(c.id).padEnd(5) + c.nom));

// ------------------------------------------------------------------- ÉCARTS
titre("ÉCART RÉEL ENTRE LES DEUX RÉFÉRENTIELS");
const lvNorm = new Map(lv.map((c) => [c.nom_normalise, c]));
const dvNorm = new Map(dv.map((c) => [c.valeur_normalisee, c]));

const seulementDv = dv.filter((c) => !lvNorm.has(c.valeur_normalisee));
const seulementLv = lv.filter((c) => !dvNorm.has(c.nom_normalise));
const communes = dv.filter((c) => lvNorm.has(c.valeur_normalisee));

console.log("\n  A) UNIQUEMENT dans declinaison_valeurs — invisibles dans le menu (" + seulementDv.length + ") :");
seulementDv.length
  ? seulementDv.forEach((c) => console.log("       " + c.valeur))
  : console.log("       (aucune)");

console.log("\n  B) UNIQUEMENT dans listes_valeurs — absentes du module Articles (" + seulementLv.length + ") :");
seulementLv.length
  ? seulementLv.forEach((c) => console.log("       " + c.nom + (c.actif ? "" : "   [inactive : masquée du menu]")))
  : console.log("       (aucune)");

console.log("\n  C) Présentes des DEUX côtés, même nom, aucune FK entre elles (" + communes.length + ") :");
communes.length
  ? communes.forEach((c) => console.log("       " + c.valeur + "   (lv.id=" + lvNorm.get(c.valeur_normalisee).id + "  dv.id=" + c.id + ")"))
  : console.log("       (aucune)");

// Couleurs de CET article manquantes au menu — le cœur du problème signalé.
titre("POURQUOI DES COULEURS MANQUENT À L'ÉCRAN");
const manquantes = artCouleurs.filter((c) => {
  const corr = lvNorm.get(c.valeur_normalisee);
  return !corr || !corr.actif;
});
if (manquantes.length === 0) {
  console.log("  Toutes les couleurs de cet article ont une correspondance ACTIVE dans listes_valeurs.");
  console.log("  Les absences constatées viennent donc d'ailleurs (couleur jamais créée dans");
  console.log("  listes_valeurs, ou déjà associée à la matière).");
} else {
  manquantes.forEach((c) => {
    const corr = lvNorm.get(c.valeur_normalisee);
    if (!corr) console.log("  " + c.valeur.padEnd(22) + "-> ABSENTE de listes_valeurs (existe seulement côté Articles)");
    else console.log("  " + c.valeur.padEnd(22) + "-> présente mais INACTIVE dans listes_valeurs (lv.id=" + corr.id + ")");
  });
}

// Couleurs réellement utilisées en production : la preuve de quel référentiel fait foi.
titre("COULEURS RÉELLEMENT UTILISÉES EN PRODUCTION (commande_lignes)");
const prod = db.prepare(
  "SELECT lv.id, lv.nom, COUNT(*) AS nb_lignes, SUM(cl.quantite) AS pieces " +
  "FROM commande_lignes cl JOIN listes_valeurs lv ON lv.id = cl.couleur_id " +
  "GROUP BY lv.id ORDER BY pieces DESC"
).all();
console.log("  " + prod.length + " couleur(s) utilisée(s), toutes issues de listes_valeurs :\n");
prod.forEach((c) => console.log("  id=" + String(c.id).padEnd(5) + c.nom.padEnd(22) + String(c.nb_lignes).padStart(4) + " ligne(s)  " + String(c.pieces).padStart(7) + " pièces"));
console.log("\n  Aucune ligne de production ne référence declinaison_valeurs : c'est bien");
console.log("  listes_valeurs qui fait foi pour le calcul des besoins matières.\n");

db.close();
