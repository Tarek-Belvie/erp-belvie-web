/**
 * Belvie ERP — Diagnostic des repères en doublon dans les tableaux de mesures
 *
 * LECTURE SEULE. N'écrit rien, ne modifie rien, ne supprime rien.
 *
 *     node diagnostic-reperes.js
 *     node diagnostic-reperes.js "C:\chemin\vers\belvie.db"
 *
 * Utilise node:sqlite (intégré à Node 22+), et NON better-sqlite3 : ce dernier est compilé pour
 * l'ABI d'Electron, d'où l'erreur « NODE_MODULE_VERSION 125 vs 127 ». Ne PAS lancer
 * `npm rebuild better-sqlite3` pour contourner cela — le module serait recompilé pour Node et
 * l'application Electron ne pourrait plus l'ouvrir. Ici aucun module natif n'est chargé.
 *
 * POURQUOI CE DIAGNOSTIC
 * Le prochain lot ajoutera un index UNIQUE partiel :
 *
 *     CREATE UNIQUE INDEX idx_ft_mesures_repere
 *       ON ft_mesures_lignes(fiche_id, UPPER(TRIM(repere)))
 *       WHERE repere IS NOT NULL AND TRIM(repere) <> '';
 *
 * La création de cet index ÉCHOUE si des doublons existent déjà. indexes.sql étant rejoué à chaque
 * démarrage, l'échec bloquerait l'ouverture de l'application. Ce script vérifie donc AVANT.
 *
 * Le contrôle prévu ignore la casse et les espaces : "A", "a" et " A " sont le MÊME repère.
 * Plusieurs lignes sans repère restent autorisées (c'est le rôle de la clause WHERE).
 */

const path = require("path");
const fs = require("fs");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  console.error("node:sqlite est indisponible. Node.js 22 ou plus récent est requis.");
  console.error("Version detectee : " + process.version);
  process.exit(1);
}

const dbPath = process.argv[2] || path.join(
  process.env.APPDATA || path.join(process.env.HOME || "", ".config"),
  "belvie-erp",
  "belvie.db"
);

if (!fs.existsSync(dbPath)) {
  console.error("Base introuvable : " + dbPath);
  console.error('Vous pouvez passer le chemin en argument : node diagnostic-reperes.js "C:\\chemin\\belvie.db"');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
console.log("Base analysee (lecture seule) : " + dbPath);

function tableExiste(nom) {
  return db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?").all(nom)[0].n > 0;
}
function titre(t) {
  console.log("\n" + "=".repeat(80) + "\n" + t + "\n" + "=".repeat(80));
}
// Normalisation IDENTIQUE à celle de l'index : majuscules, espaces retirés aux extrémités.
const norm = (r) => String(r == null ? "" : r).trim().toUpperCase();

// =============================================================== FICHES TECHNIQUES
titre("1. Repères en doublon dans les FICHES TECHNIQUES");

const lignes = !tableExiste("ft_mesures_lignes") ? [] : db.prepare(
  "SELECT l.id, l.repere, l.ordre, mc.nom AS mesure, f.id AS fiche_id, f.statut, " +
  "a.reference_principale, p.nom AS produit " +
  "FROM ft_mesures_lignes l " +
  "JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
  "JOIN fiches_techniques f ON f.id = l.fiche_id " +
  "LEFT JOIN articles a ON a.id = f.article_id " +
  "LEFT JOIN listes_valeurs p ON p.id = a.produit_id " +
  "ORDER BY f.id, l.ordre, l.id"
).all();

const avecRepere = lignes.filter((l) => norm(l.repere) !== "");
console.log(`  ${lignes.length} ligne(s) de mesure au total, dont ${avecRepere.length} avec un repère renseigné.`);
console.log(`  ${lignes.length - avecRepere.length} sans repère — toujours autorisées, jamais en conflit.\n`);

// Regroupement par (fiche, repère normalisé) : exactement la clé du futur index.
const groupes = new Map();
avecRepere.forEach((l) => {
  const cle = l.fiche_id + "|" + norm(l.repere);
  if (!groupes.has(cle)) groupes.set(cle, []);
  groupes.get(cle).push(l);
});
const conflits = [...groupes.entries()].filter(([, v]) => v.length > 1);

if (conflits.length === 0) {
  console.log("  Aucun doublon. L'index UNIQUE pourra être créé sans aucune correction.");
} else {
  console.log(`  ${conflits.length} conflit(s) detecte(s) — a corriger AVANT la creation de l'index :\n`);
  conflits.forEach(([cle, v]) => {
    const f = v[0];
    console.log(`  Fiche ${f.fiche_id} (${f.statut}) — ${f.reference_principale || "sans réf."} — ${f.produit || ""}`);
    console.log(`    repère « ${cle.split("|")[1]} » utilisé ${v.length} fois :`);
    v.forEach((l) => {
      const brut = JSON.stringify(l.repere);
      const casse = l.repere !== norm(l.repere) ? "  (diffère par la casse ou les espaces)" : "";
      console.log(`      - ligne ${String(l.id).padEnd(5)} repère=${brut.padEnd(8)} ${l.mesure}${casse}`);
    });
    console.log("");
  });
}

// =============================================================== MODÈLES
titre("2. Repères en doublon dans les MODÈLES (information seulement)");
console.log("  L'index ne portera QUE sur les fiches. Mais un modèle contenant des doublons les");
console.log("  propagerait à chaque fiche créée à partir de lui : mieux vaut le savoir.\n");

const lignesMod = !tableExiste("modeles_mesures_lignes") ? [] : db.prepare(
  "SELECT l.id, l.repere, mc.nom AS mesure, m.id AS modele_id, m.nom AS modele " +
  "FROM modeles_mesures_lignes l " +
  "JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
  "JOIN modeles_mesures m ON m.id = l.modele_id " +
  "ORDER BY m.nom, l.ordre"
).all();

const groupesMod = new Map();
lignesMod.filter((l) => norm(l.repere) !== "").forEach((l) => {
  const cle = l.modele_id + "|" + norm(l.repere);
  if (!groupesMod.has(cle)) groupesMod.set(cle, []);
  groupesMod.get(cle).push(l);
});
const conflitsMod = [...groupesMod.entries()].filter(([, v]) => v.length > 1);

if (conflitsMod.length === 0) {
  console.log("  Aucun doublon dans les modèles.");
} else {
  conflitsMod.forEach(([cle, v]) => {
    console.log(`  Modèle « ${v[0].modele} » — repère « ${cle.split("|")[1]} » utilisé ${v.length} fois :`);
    v.forEach((l) => console.log(`      - ${JSON.stringify(l.repere).padEnd(8)} ${l.mesure}`));
    console.log("");
  });
}

// =============================================================== SIMULATION
titre("3. Simulation réelle de la création de l'index");
console.log("  L'index est construit ici sur une copie EN MÉMOIRE des données, jamais sur votre");
console.log("  base. C'est le test décisif : si cela passe ici, cela passera à l'installation.\n");

let simulationOk = false;
try {
  const memoire = new DatabaseSync(":memory:");
  memoire.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, fiche_id INTEGER, repere TEXT);");
  const ins = memoire.prepare("INSERT INTO t (id, fiche_id, repere) VALUES (?, ?, ?)");
  lignes.forEach((l) => ins.run(l.id, l.fiche_id, l.repere));
  memoire.exec(
    "CREATE UNIQUE INDEX idx_ft_mesures_repere ON t(fiche_id, UPPER(TRIM(repere))) " +
    "WHERE repere IS NOT NULL AND TRIM(repere) <> '';"
  );
  simulationOk = true;
  console.log("  RESULTAT : l'index se cree sans erreur. Aucune correction necessaire.");
  memoire.close();
} catch (err) {
  console.log("  RESULTAT : la creation ECHOUE — " + err.message);
  console.log("  Corrigez les conflits listes en section 1 avant d'installer le lot.");
}

// =============================================================== RÉSUMÉ
titre("RÉSUMÉ");
const distincts = [...new Set(avecRepere.map((l) => norm(l.repere)))].sort();
console.log("  Repères distincts utilisés : " + (distincts.length ? distincts.join(", ") : "aucun"));
console.log(`  Lignes avec repère   : ${avecRepere.length}`);
console.log(`  Lignes sans repère   : ${lignes.length - avecRepere.length}  (autorisées en nombre illimité)`);
console.log(`  Conflits en fiches   : ${conflits.length}`);
console.log(`  Conflits en modèles  : ${conflitsMod.length}  (n'empêchent pas l'index, mais se propageront)`);
console.log("\n  " + (simulationOk
  ? "PRET : l'index UNIQUE peut etre installe tel quel."
  : "A CORRIGER : renommez ou videz les reperes en conflit depuis l'interface avant installation."));
console.log("\n  Rien n'a ete modifie.\n");

db.close();
