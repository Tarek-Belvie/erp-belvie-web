/**
 * Belvie ERP — Diagnostic : impossible d'ajouter une taille / FOREIGN KEY constraint failed
 *
 * LECTURE SEULE sur votre base. Les écritures de test sont faites sur une COPIE EN MÉMOIRE.
 *
 *     node diagnostic-tailles-selection.js
 *     node diagnostic-tailles-selection.js "C:\chemin\vers\belvie.db"
 *
 * node:sqlite, jamais better-sqlite3 (conflit d'ABI Electron).
 *
 * Ce script rejoue EXACTEMENT l'insertion que fait selectionnerTaille, sur une copie, pour chaque
 * taille non encore sélectionnée de chaque fiche. Il dit donc précisément laquelle échoue et
 * pourquoi, au lieu de supposer.
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
console.log("Base analysee (lecture seule) : " + dbPath);
const un = (sql, ...p) => { const r = db.prepare(sql).all(...p); return r.length ? r[0] : null; };
const titre = (t) => console.log("\n" + "=".repeat(90) + "\n" + t + "\n" + "=".repeat(90));

titre("1. INTEGRITE GENERALE");
const fkc = db.prepare("PRAGMA foreign_key_check").all();
console.log("  PRAGMA foreign_key_check : " + (fkc.length === 0 ? "propre" : fkc.length + " violation(s)"));
fkc.slice(0, 20).forEach((v) => console.log("     " + JSON.stringify(v)));

titre("2. FICHES TECHNIQUES ET LEUR GRILLE");
const fiches = db.prepare(
  "SELECT f.id, f.article_id, f.statut, f.grille_id, g.nom AS grille_nom, " +
  "a.reference_principale, a.designation, " +
  "(SELECT COUNT(*) FROM ft_tailles WHERE fiche_id = f.id) AS nb_tailles " +
  "FROM fiches_techniques f " +
  "LEFT JOIN grilles_tailles g ON g.id = f.grille_id " +
  "LEFT JOIN articles a ON a.id = f.article_id ORDER BY f.id"
).all();
fiches.forEach((f) => {
  const articleOk = f.article_id == null ? "article_id NULL" :
    (un("SELECT id FROM articles WHERE id = ?", f.article_id) ? "article ok" : ">>> ARTICLE INEXISTANT <<<");
  const grilleOk = f.grille_id == null ? "aucune grille" :
    (f.grille_nom ? "grille « " + f.grille_nom + " »" : ">>> GRILLE INEXISTANTE (id=" + f.grille_id + ") <<<");
  console.log("  fiche " + String(f.id).padEnd(4) + (f.reference_principale || f.designation || "sans ref.").padEnd(24) +
    f.statut.padEnd(12) + f.nb_tailles + " taille(s)  " + grilleOk + "  " + articleOk);
});

titre("3. ft_tailles — ou pointe reellement grille_valeur_id ?");
const tailles = db.prepare(
  "SELECT t.id, t.fiche_id, t.nom, t.grille_valeur_id, t.ordre, " +
  "v.valeur AS pointe_vers, v.grille_id AS pointe_grille, " +
  "(SELECT COUNT(*) FROM ft_mesures_valeurs WHERE ft_taille_id = t.id AND valeur IS NOT NULL) AS nb_valeurs " +
  "FROM ft_tailles t LEFT JOIN grilles_tailles_valeurs v ON v.id = t.grille_valeur_id ORDER BY t.fiche_id, t.ordre"
).all();
tailles.forEach((t) => {
  let etat = "hors grille (NULL)";
  if (t.grille_valeur_id != null) {
    if (t.pointe_vers == null) etat = ">>> POINTEUR CASSE : id " + t.grille_valeur_id + " absent de grilles_tailles_valeurs <<<";
    else if (String(t.pointe_vers).toUpperCase() !== String(t.nom).toUpperCase())
      etat = ">>> POINTEUR FAUX : « " + t.nom + " » designe en realite « " + t.pointe_vers + " » <<<";
    else etat = "correct (grille " + t.pointe_grille + ")";
  }
  console.log("  fiche " + String(t.fiche_id).padEnd(4) + t.nom.padEnd(8) + "gvi=" + String(t.grille_valeur_id).padEnd(6) +
    t.nb_valeurs + " valeur(s)  " + etat);
});

titre("4. SIMULATION REELLE DE selectionnerTaille (sur copie en memoire)");
console.log("  On rejoue l'INSERT exact, pour CHAQUE taille non selectionnee de chaque fiche.\n");

// Copie en mémoire : structures + données strictement nécessaires.
const mem = new DatabaseSync(":memory:");
mem.exec("PRAGMA foreign_keys = ON");
mem.exec(`
  CREATE TABLE fiches_techniques (id INTEGER PRIMARY KEY, article_id INTEGER, grille_id INTEGER);
  CREATE TABLE grilles_tailles (id INTEGER PRIMARY KEY, nom TEXT);
  CREATE TABLE grilles_tailles_valeurs (id INTEGER PRIMARY KEY, grille_id INTEGER REFERENCES grilles_tailles(id), valeur TEXT, actif INTEGER, ordre INTEGER);
  CREATE TABLE ft_tailles (id INTEGER PRIMARY KEY, fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
    nom TEXT NOT NULL, grille_valeur_id INTEGER REFERENCES grilles_tailles_valeurs(id), ordre INTEGER);
`);
mem.exec("PRAGMA foreign_keys = OFF");
db.prepare("SELECT id, article_id, grille_id FROM fiches_techniques").all()
  .forEach((r) => mem.prepare("INSERT INTO fiches_techniques VALUES (?,?,?)").run(r.id, r.article_id, r.grille_id));
db.prepare("SELECT id, nom FROM grilles_tailles").all()
  .forEach((r) => mem.prepare("INSERT INTO grilles_tailles VALUES (?,?)").run(r.id, r.nom));
db.prepare("SELECT id, grille_id, valeur, actif, ordre FROM grilles_tailles_valeurs").all()
  .forEach((r) => mem.prepare("INSERT INTO grilles_tailles_valeurs VALUES (?,?,?,?,?)").run(r.id, r.grille_id, r.valeur, r.actif, r.ordre));
db.prepare("SELECT id, fiche_id, nom, grille_valeur_id, ordre FROM ft_tailles").all()
  .forEach((r) => mem.prepare("INSERT INTO ft_tailles VALUES (?,?,?,?,?)").run(r.id, r.fiche_id, r.nom, r.grille_valeur_id, r.ordre));
mem.exec("PRAGMA foreign_keys = ON");

let echecs = 0, succes = 0;
fiches.forEach((f) => {
  if (!f.grille_id) return;
  const valeurs = db.prepare("SELECT id, valeur FROM grilles_tailles_valeurs WHERE grille_id = ? AND actif = 1 ORDER BY ordre").all(f.grille_id);
  const deja = new Set(db.prepare("SELECT grille_valeur_id FROM ft_tailles WHERE fiche_id = ?").all(f.id).map((r) => r.grille_valeur_id));
  valeurs.filter((v) => !deja.has(v.id)).forEach((v) => {
    try {
      mem.prepare("INSERT INTO ft_tailles (fiche_id, nom, grille_valeur_id, ordre) VALUES (?,?,?,?)")
        .run(f.id, v.valeur, v.id, 999);
      succes += 1;
      console.log("  OK      fiche " + String(f.id).padEnd(4) + "« " + v.valeur + " » (gvi=" + v.id + ")");
    } catch (err) {
      echecs += 1;
      console.log("  ECHEC   fiche " + String(f.id).padEnd(4) + "« " + v.valeur + " » (gvi=" + v.id + ") -> " + err.message);
      const fOk = mem.prepare("SELECT COUNT(*) AS n FROM fiches_techniques WHERE id = ?").all(f.id)[0].n;
      const vOk = mem.prepare("SELECT COUNT(*) AS n FROM grilles_tailles_valeurs WHERE id = ?").all(v.id)[0].n;
      console.log("             fiche_id " + f.id + " existe ? " + (fOk ? "OUI" : "NON  <<< CAUSE"));
      console.log("             grille_valeur_id " + v.id + " existe ? " + (vOk ? "OUI" : "NON  <<< CAUSE"));
    }
  });
});
if (succes === 0 && echecs === 0) console.log("  Aucune taille a tester (aucune fiche avec grille, ou toutes deja selectionnees).");

titre("RESUME");
console.log("  Fiches techniques        : " + fiches.length);
console.log("  Lignes ft_tailles        : " + tailles.length);
console.log("  Pointeurs casses         : " + tailles.filter((t) => t.grille_valeur_id != null && t.pointe_vers == null).length);
console.log("  Pointeurs faux (nom <> ) : " + tailles.filter((t) => t.pointe_vers != null && String(t.pointe_vers).toUpperCase() !== String(t.nom).toUpperCase()).length);
console.log("  Insertions simulees OK   : " + succes);
console.log("  Insertions en ECHEC      : " + echecs);
console.log("\n  Votre base n'a pas ete modifiee : toutes les ecritures ont eu lieu en memoire.\n");

mem.close();
db.close();
