/**
 * Belvie ERP — Les tailles des commandes historiques designent-elles la bonne valeur ?
 *
 * LECTURE SEULE. N'ecrit rien, ne modifie rien, ne migre rien.
 *
 *     node diagnostic-tailles-commandes.js
 *     node diagnostic-tailles-commandes.js "C:\chemin\vers\belvie.db"
 *
 * POURQUOI CE SCRIPT
 * PRAGMA foreign_key_check renvoie 0 et pourtant une taille peut etre FAUSSE. La contrainte
 * verifie seulement que l'identifiant EXISTE dans grilles_tailles_valeurs, jamais qu'il designe
 * la bonne taille. Or l'ancien referentiel listes_valeurs(type='taille') et grilles_tailles_valeurs
 * ont des identifiants qui se CHEVAUCHENT : un id ecrit depuis la mauvaise table passe donc la
 * contrainte tout en pointant une autre taille.
 *
 * La comparaison se fait sur commande_lignes.taille_nom, qui est un SNAPSHOT du libelle fige au
 * moment de la commande. C'est la seule trace fiable de ce que l'utilisateur avait reellement
 * choisi.
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
const ligne = "-".repeat(78);
const titre = (t) => console.log("\n" + ligne + "\n" + t + "\n" + ligne);

const norm = (s) => String(s == null ? "" : s)
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase().replace(/\s+/g, " ");

console.log("\nBase analysee (lecture seule) : " + dbPath);

// ---------------------------------------------------------------- recouvrement des identifiants
titre("1. LES DEUX REFERENTIELS SE CHEVAUCHENT-ILS ?");
const anciens = db.prepare("SELECT id, nom FROM listes_valeurs WHERE type = 'taille' ORDER BY id").all();
const grille = db.prepare("SELECT id, valeur FROM grilles_tailles_valeurs ORDER BY id").all();
const idsAnciens = new Set(anciens.map((a) => a.id));
const communs = grille.filter((g) => idsAnciens.has(g.id));
console.log("  listes_valeurs(type='taille') : " + anciens.length + " valeur(s), ids " +
  (anciens.length ? anciens[0].id + " a " + anciens[anciens.length - 1].id : "-"));
console.log("  grilles_tailles_valeurs       : " + grille.length + " valeur(s), ids " +
  (grille.length ? grille[0].id + " a " + grille[grille.length - 1].id : "-"));
console.log("  identifiants presents DANS LES DEUX : " + communs.length +
  (communs.length ? "   <<< une ecriture depuis la mauvaise table y passe inapercue" : ""));

// ---------------------------------------------------------------------- analyse ligne par ligne
titre("2. ANALYSE DES LIGNES DE COMMANDE");
const lignes = db.prepare(
  "SELECT cl.id, cl.commande_id, cl.taille_id, cl.taille_nom, cl.quantite, " +
  "c.numero, c.statut, " +
  "v.valeur AS valeur_pointee, v.grille_id, g.nom AS grille_nom " +
  "FROM commande_lignes cl " +
  "LEFT JOIN commandes c ON c.id = cl.commande_id " +
  "LEFT JOIN grilles_tailles_valeurs v ON v.id = cl.taille_id " +
  "LEFT JOIN grilles_tailles g ON g.id = v.grille_id " +
  "ORDER BY cl.commande_id, cl.id"
).all();

const parAncien = new Map(anciens.map((a) => [a.id, a.nom]));
const stats = { total: lignes.length, sansTaille: 0, correct: 0, incoherent: 0, introuvable: 0, sansSnapshot: 0 };
const incoherences = [];

lignes.forEach((l) => {
  if (l.taille_id == null) { stats.sansTaille += 1; return; }
  if (l.valeur_pointee == null) {
    stats.introuvable += 1;
    incoherences.push({ ...l, cause: "id absent de grilles_tailles_valeurs" });
    return;
  }
  if (!l.taille_nom || !String(l.taille_nom).trim()) { stats.sansSnapshot += 1; return; }
  if (norm(l.taille_nom) === norm(l.valeur_pointee)) { stats.correct += 1; return; }
  stats.incoherent += 1;
  incoherences.push({ ...l, cause: "le libelle enregistre ne correspond pas a la valeur pointee" });
});

console.log("  lignes analysees          : " + stats.total);
console.log("  correspondances correctes : " + stats.correct);
console.log("  INCOHERENTES              : " + stats.incoherent);
console.log("  id introuvable en grille  : " + stats.introuvable);
console.log("  sans taille (NULL)        : " + stats.sansTaille);
console.log("  sans libelle enregistre   : " + stats.sansSnapshot + "   (comparaison impossible)");

// ------------------------------------------------------------------------------- le detail
titre("3. DETAIL DES INCOHERENCES");
if (incoherences.length === 0) {
  console.log("  Aucune. Chaque taille_id designe bien la taille enregistree au moment de la commande.");
} else {
  const commandes = new Set(incoherences.map((i) => i.commande_id));
  console.log("  " + incoherences.length + " ligne(s) sur " + commandes.size + " commande(s).\n");
  console.log("  " + "COMMANDE".padEnd(16) + "ATTENDU".padEnd(14) + "ID".padEnd(7) + "DESIGNE EN REALITE".padEnd(22) + "ORIGINE PROBABLE");
  console.log("  " + "-".repeat(90));
  incoherences.forEach((i) => {
    const ancien = parAncien.get(i.taille_id);
    console.log("  " +
      String(i.numero || "cmd " + i.commande_id).slice(0, 15).padEnd(16) +
      String(i.taille_nom || "-").slice(0, 13).padEnd(14) +
      String(i.taille_id).padEnd(7) +
      String(i.valeur_pointee == null ? "(rien)" : i.valeur_pointee + (i.grille_nom ? " [" + i.grille_nom + "]" : "")).slice(0, 21).padEnd(22) +
      (ancien ? "ancien referentiel : « " + ancien + " »" : "inconnue"));
  });
}

// ------------------------------------------------------------------------------------ bilan
titre("BILAN");
if (stats.incoherent === 0 && stats.introuvable === 0) {
  console.log("  Vos commandes historiques sont SAINES : aucune taille ne designe une autre valeur.");
  console.log("  Aucune correction de donnees n'est necessaire.");
} else {
  console.log("  " + (stats.incoherent + stats.introuvable) + " ligne(s) a examiner.");
  console.log("  AUCUNE correction n'a ete faite : ce script est en lecture seule.");
  console.log("  Le libelle enregistre (taille_nom) reste juste sur les documents deja emis :");
  console.log("  c'est un instantane fige, il n'est jamais relu depuis grilles_tailles_valeurs.");
}
console.log("\n  foreign_key_check : " + db.prepare("PRAGMA foreign_key_check").all().length + " violation(s)");
console.log("  (rappel : 0 ne signifie PAS que les tailles sont fonctionnellement correctes)");
console.log("\n  Votre base n'a pas ete modifiee.\n");

db.close();
