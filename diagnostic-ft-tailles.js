/**
 * Belvie ERP — Diagnostic : d'où vient réellement le FOREIGN KEY sur ft_tailles ?
 *
 * LECTURE SEULE sur votre base. Les écritures de test ont lieu en mémoire.
 *
 *     node diagnostic-ft-tailles.js
 *     node diagnostic-ft-tailles.js "C:\chemin\vers\belvie.db"
 *
 * POURQUOI CE SCRIPT EXISTE
 * Le précédent diagnostic recréait la copie de test avec MES définitions de tables. Il testait
 * donc l'INSERT contre le schéma supposé, pas contre le vôtre — d'où 28 réussites alors que
 * l'application échoue. Or CREATE TABLE IF NOT EXISTS ne modifie JAMAIS une table existante :
 * une ft_tailles créée par une version antérieure peut porter des colonnes, des clés étrangères
 * ou des déclencheurs que schema.sql n'a jamais pu lui retirer.
 *
 * Ici, la copie est construite à partir du SQL RÉEL lu dans sqlite_master.
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
const titre = (t) => console.log("\n" + "=".repeat(92) + "\n" + t + "\n" + "=".repeat(92));

// ------------------------------------------------------------------ 1. LE SQL REEL
titre("1. CREATE TABLE REEL de ft_tailles (tel qu'il est dans VOTRE base)");
const sqlTable = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='ft_tailles'").all();
if (sqlTable.length === 0) { console.log("  ft_tailles n'existe pas."); process.exit(1); }
console.log(sqlTable[0].sql);

titre("2. PRAGMA foreign_key_list(ft_tailles) — TOUTES les cles etrangeres");
const fks = db.prepare("PRAGMA foreign_key_list(ft_tailles)").all();
if (fks.length === 0) console.log("  Aucune cle etrangere.");
fks.forEach((fk) => {
  console.log("  [" + fk.id + "] " + String(fk.from).padEnd(22) + " -> " + fk.table + "(" + fk.to + ")" +
    "   on_delete=" + fk.on_delete + "  on_update=" + fk.on_update);
  // Combien de valeurs de cette colonne n'ont pas de parent ?
  try {
    const orphelins = db.prepare(
      "SELECT COUNT(*) AS n FROM ft_tailles t WHERE t." + fk.from + " IS NOT NULL " +
      "AND NOT EXISTS (SELECT 1 FROM " + fk.table + " p WHERE p." + fk.to + " = t." + fk.from + ")"
    ).all()[0].n;
    console.log("        lignes existantes sans parent : " + orphelins);
  } catch (e) { console.log("        (verification impossible : " + e.message + ")"); }
});
console.log("\n  >>> Si cette liste contient PLUS de 2 cles, la cle supplementaire est la cause.");

titre("3. COLONNES reelles de ft_tailles");
const cols = db.prepare("PRAGMA table_info(ft_tailles)").all();
cols.forEach((c) => console.log("  " + String(c.name).padEnd(24) + String(c.type).padEnd(10) +
  (c.notnull ? "NOT NULL " : "         ") + (c.dflt_value != null ? "defaut=" + c.dflt_value : "")));
const attendues = ["id", "fiche_id", "nom", "grille_valeur_id", "ordre"];
const enTrop = cols.map((c) => c.name).filter((n) => attendues.indexOf(n) === -1);
console.log("\n  Colonnes inattendues : " + (enTrop.length ? enTrop.join(", ") + "   <<< A EXAMINER" : "aucune"));

titre("4. DECLENCHEURS (triggers) lies a ft_tailles");
const triggers = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='trigger'").all()
  .filter((t) => /ft_tailles/i.test(t.sql || ""));
if (triggers.length === 0) console.log("  Aucun trigger ne mentionne ft_tailles.");
triggers.forEach((t) => { console.log("  --- " + t.name + " ---"); console.log(t.sql); console.log(""); });

titre("5. TABLES qui referencent ft_tailles (ecritures secondaires possibles)");
db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().forEach((t) => {
  try {
    const l = db.prepare("PRAGMA foreign_key_list(" + t.name + ")").all().filter((f) => f.table === "ft_tailles");
    l.forEach((f) => console.log("  " + t.name + "." + f.from + " -> ft_tailles(" + f.to + ")  on_delete=" + f.on_delete));
  } catch (e) { /* table sans FK */ }
});

// --------------------------------------------------- 6. REJEU SUR LE SCHEMA REEL
titre("6. REJEU DE L'INSERT — sur une copie construite avec VOTRE schema reel");
console.log("  Toutes les tables et tous les triggers de votre base sont recrees a l'identique,");
console.log("  puis l'INSERT de selectionnerTaille est rejoue. C'est le test que le diagnostic");
console.log("  precedent ne faisait PAS : il utilisait des definitions simplifiees.\n");

const mem = new DatabaseSync(":memory:");
mem.exec("PRAGMA foreign_keys = OFF");
const objets = db.prepare(
  "SELECT type, name, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' " +
  "ORDER BY CASE type WHEN 'table' THEN 1 WHEN 'index' THEN 2 ELSE 3 END"
).all();
let objetsKo = 0;
objets.forEach((o) => { try { mem.exec(o.sql); } catch (e) { objetsKo += 1; console.log("  (recreation impossible : " + o.type + " " + o.name + ")"); } });
console.log("  " + (objets.length - objetsKo) + " objet(s) recree(s) a l'identique.\n");

// Copie des données des tables utiles à l'INSERT et à ses éventuels triggers.
["fiches_techniques", "grilles_tailles", "grilles_tailles_valeurs", "ft_tailles", "tailles_catalogue",
 "mesures_catalogue", "ft_mesures_lignes", "ft_mesures_valeurs", "articles", "listes_valeurs"].forEach((t) => {
  try {
    const lignes = db.prepare("SELECT * FROM " + t).all();
    if (lignes.length === 0) return;
    const noms = Object.keys(lignes[0]);
    const stmt = mem.prepare("INSERT INTO " + t + " (" + noms.join(",") + ") VALUES (" + noms.map(() => "?").join(",") + ")");
    lignes.forEach((l) => { try { stmt.run(...noms.map((n) => l[n])); } catch (e) { /* ignore */ } });
  } catch (e) { /* table absente */ }
});
mem.exec("PRAGMA foreign_keys = ON");

const fiches = db.prepare("SELECT id, grille_id FROM fiches_techniques WHERE grille_id IS NOT NULL").all();
let ok = 0, ko = 0;
fiches.forEach((f) => {
  const valeurs = db.prepare("SELECT id, valeur FROM grilles_tailles_valeurs WHERE grille_id = ? AND actif = 1 ORDER BY ordre").all(f.grille_id);
  const deja = new Set(db.prepare("SELECT nom FROM ft_tailles WHERE fiche_id = ?").all(f.id).map((r) => String(r.nom).toUpperCase()));
  valeurs.filter((v) => !deja.has(String(v.valeur).toUpperCase())).forEach((v) => {
    try {
      mem.prepare("INSERT INTO ft_tailles (fiche_id, nom, grille_valeur_id, ordre) VALUES (?,?,?,?)").run(f.id, v.valeur, v.id, 999);
      ok += 1;
    } catch (err) {
      ko += 1;
      console.log("  ECHEC  fiche " + f.id + " « " + v.valeur + " » (gvi=" + v.id + ") -> " + err.message);
      // On isole la cause : quelle FK, exactement ?
      fks.forEach((fk) => {
        const val = fk.from === "fiche_id" ? f.id : fk.from === "grille_valeur_id" ? v.id : null;
        if (val == null) { console.log("           colonne " + fk.from + " : non renseignee par l'INSERT (valeur NULL)"); return; }
        const n = mem.prepare("SELECT COUNT(*) AS n FROM " + fk.table + " WHERE " + fk.to + " = ?").all(val)[0].n;
        console.log("           " + fk.from + "=" + val + " -> " + fk.table + " : " + (n ? "present" : "ABSENT  <<< CAUSE"));
      });
    }
  });
});
console.log("\n  Insertions rejouees : " + ok + " reussie(s), " + ko + " en echec.");
if (ko === 0 && ok > 0) {
  console.log("\n  Le schema reel accepte les INSERT. La cause n'est donc PAS le schema :");
  console.log("  elle se situe dans le code execute (autre instruction dans la meme transaction).");
}

titre("RESUME");
console.log("  Cles etrangeres sur ft_tailles : " + fks.length + (fks.length > 2 ? "   <<< PLUS QUE PREVU" : ""));
console.log("  Colonnes inattendues           : " + (enTrop.length ? enTrop.join(", ") : "aucune"));
console.log("  Triggers mentionnant ft_tailles: " + triggers.length);
console.log("  Insertions rejouees en echec   : " + ko);
console.log("\n  Votre base n'a pas ete modifiee.\n");

mem.close();
db.close();
