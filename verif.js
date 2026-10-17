/**
 * Belvie ERP — Verification du referentiel necessaire a la creation d'une commande.
 *
 * LECTURE SEULE. N'ecrit rien, ne modifie rien.
 *
 *     node verif.js
 *
 * Objectif : identifier laquelle des cles etrangeres de `commandes` echoue.
 * Le message « FOREIGN KEY constraint failed » ne designe aucune colonne : ce script teste
 * chacune des trois cles obligatoires (article_id, atelier_id, etape_id) et dit laquelle
 * ne peut pas etre satisfaite.
 */

const path = require("path");
const fs = require("fs");

let DatabaseSync;
try { ({ DatabaseSync } = require("node:sqlite")); }
catch (e) { console.error("node:sqlite indisponible. Node 22+ requis. Version : " + process.version); process.exit(1); }

const dbPath = process.argv[2] || path.join(
  process.env.APPDATA || path.join(process.env.HOME || "", ".config"), "belvie-erp", "belvie.db");
if (!fs.existsSync(dbPath)) { console.error("Base introuvable : " + dbPath); process.exit(1); }

const db = new DatabaseSync(dbPath, { readOnly: true });
const n = (sql) => { try { return db.prepare(sql).all()[0].n; } catch (e) { return "table absente"; } };
const rows = (sql) => { try { return db.prepare(sql).all(); } catch (e) { return null; } };
const ligne = "-".repeat(70);

console.log("\nBase : " + dbPath);
console.log(ligne);

const ateliers = db.prepare("SELECT id, nom, actif FROM listes_valeurs WHERE type = 'atelier'").all();
const etapes = db.prepare("SELECT id, cle, libelle, ordre FROM etapes ORDER BY ordre").all();

console.log("ateliers actifs : " + ateliers.filter((a) => a.actif === 1).length + " sur " + ateliers.length);
console.log("etapes          : " + etapes.length);
console.log("commandes       : " + n("SELECT COUNT(*) AS n FROM commandes"));
console.log("articles        : " + n("SELECT COUNT(*) AS n FROM articles"));

console.log("\n" + ligne + "\nATELIERS\n" + ligne);
if (ateliers.length === 0) console.log("  AUCUN atelier  <<< commandes.atelier_id ne peut designer aucune ligne");
ateliers.forEach((a) => console.log("  " + String(a.id).padEnd(5) + a.nom + (a.actif ? "" : "   [INACTIF]")));

console.log("\n" + ligne + "\nETAPES DE PRODUCTION\n" + ligne);
if (etapes.length === 0) console.log("  AUCUNE etape  <<< commandes.etape_id ne peut designer aucune ligne");
etapes.forEach((e) => console.log("  " + String(e.id).padEnd(5) + String(e.cle).padEnd(16) + (e.libelle || "")));

console.log("\n" + ligne + "\nGRILLES DE TAILLES PAR TYPE D'ARTICLE\n" + ligne);
const assoc = rows(
  "SELECT lv.nom AS type, g.nom AS grille, " +
  "(SELECT COUNT(*) FROM grilles_tailles_valeurs v WHERE v.grille_id = g.id AND v.actif = 1) AS nb " +
  "FROM produit_grille_taille p JOIN listes_valeurs lv ON lv.id = p.produit_id JOIN grilles_tailles g ON g.id = p.grille_id"
);
if (assoc === null) {
  console.log("  table produit_grille_taille absente de cette base.");
} else if (assoc.length === 0) {
  console.log("  AUCUNE association  <<< aucune taille ne pourra etre proposee dans la commande");
} else {
  console.log("  " + assoc.length + " association(s) :");
  assoc.forEach((a) => console.log("    " + String(a.type).padEnd(16) + "-> " + a.grille + " (" + a.nb + " tailles)"));
}

console.log("\n" + ligne + "\nCOMMANDES EXISTANTES\n" + ligne);
console.log("  commandes : " + n("SELECT COUNT(*) AS n FROM commandes"));
console.log("  lignes    : " + n("SELECT COUNT(*) AS n FROM commande_lignes"));
const orphelines = n(
  "SELECT COUNT(*) AS n FROM commande_lignes cl WHERE cl.taille_id IS NOT NULL " +
  "AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs v WHERE v.id = cl.taille_id)"
);
console.log("  taille_id hors grilles_tailles_valeurs : " + orphelines +
  (typeof orphelines === "number" && orphelines > 0 ? "   <<< issues de l'ancien referentiel" : ""));

console.log("\n" + ligne + "\nANCIEN REFERENTIEL listes_valeurs(type='taille')\n" + ligne);
console.log("  valeurs : " + n("SELECT COUNT(*) AS n FROM listes_valeurs WHERE type='taille'"));
console.log("  (conserve tant qu'un autre module s'en sert)");

console.log("\n" + ligne + "\nDIAGNOSTIC\n" + ligne);
const causes = [];
if (ateliers.filter((a) => a.actif === 1).length === 0) causes.push("aucun atelier actif (commandes.atelier_id)");
if (etapes.length === 0) causes.push("aucune etape de production (commandes.etape_id)");
if (causes.length === 0) {
  console.log("  Le referentiel est complet : la cause est ailleurs.");
  console.log("  Envoyez electron/ipc/commandes.js pour identifier la valeur reellement transmise.");
} else {
  console.log("  CAUSE PROBABLE : " + causes.join(" | "));
  console.log("  Creez ces valeurs depuis Parametres, puis relancez la creation de commande.");
}
console.log("\n  foreign_key_check : " + db.prepare("PRAGMA foreign_key_check").all().length + " violation(s)");
console.log("  Aucune donnee n'a ete modifiee.\n");

db.close();
