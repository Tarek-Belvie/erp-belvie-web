/**
 * Belvie ERP — Diagnostic des valeurs anormales dans la colonne « unite » des mesures
 *
 * LECTURE SEULE. N'écrit rien, ne modifie rien, ne supprime rien.
 *
 * À lancer AVANT d'installer le lot Gradation :
 *
 *     node diagnostic-unites.js
 *
 * Utilise node:sqlite (intégré à Node 22+), et NON better-sqlite3 : ce dernier est un module
 * natif compilé pour l'ABI d'Electron, pas pour celui de Node — d'où l'erreur
 * « NODE_MODULE_VERSION 125 vs 127 ». Surtout, ne PAS lancer `npm rebuild better-sqlite3` pour
 * contourner cela : le module serait alors recompilé pour Node et l'application Electron ne
 * pourrait plus l'ouvrir. Ici, aucun module natif n'est chargé, donc aucun conflit d'ABI.
 *
 * Le script peut donc être lancé depuis n'importe quel dossier : il n'a besoin d'aucun
 * node_modules.
 *
 * Contexte : `unite` est du TEXT libre, sans CHECK ni liste de valeurs autorisées. Dans
 * l'interface, ce champ étroit était coincé entre le nom de la mesure et les colonnes de tailles —
 * il a donc reçu en pratique des VALEURS de mesure ("75cm", "58cm") au lieu d'unités.
 *
 * Le lot Gradation masque cette colonne dans la saisie et dans l'impression, mais ne supprime
 * RIEN en base. Ce script vous dit ce qu'elle contient réellement, et où, pour que vous décidiez
 * vous-même si ce sont des erreurs à ignorer ou des valeurs à récupérer.
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
  console.error("Vous pouvez passer le chemin en argument : node diagnostic-unites.js \"C:\\chemin\\belvie.db\"");
  process.exit(1);
}

// readOnly : garantie au niveau du moteur qu'aucune écriture n'est possible, quoi que fasse le
// script. La base peut rester ouverte dans l'application pendant l'exécution.
const db = new DatabaseSync(dbPath, { readOnly: true });
console.log("Base analysee (lecture seule) : " + dbPath);

// node:sqlite ne connaît pas .get() : .all() suffit partout, on prend le premier élément.
function un(sql, ...params) {
  const r = db.prepare(sql).all(...params);
  return r.length ? r[0] : null;
}
function compter(sql, ...params) {
  const r = un(sql, ...params);
  return r ? Number(r.n) : 0;
}

// Une table absente (base plus ancienne) ne doit pas faire planter le diagnostic.
function tableExiste(nom) {
  return compter("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name = ?", nom) > 0;
}

// Unités plausibles pour une mesure de vêtement. Tout le reste est signalé — sans jugement :
// c'est vous qui tranchez.
const UNITES_ATTENDUES = ["cm", "mm", "m", "in", "inch", "pouce", "pouces", '"', "g", "g/m2", "g/m²"];
const estAttendue = (u) => UNITES_ATTENDUES.includes(String(u || "").trim().toLowerCase());
// "75cm", "58 cm", "12,5cm" — un nombre collé à une unité : c'est une VALEUR, pas une unité.
const ressembleAUneValeur = (u) => /^\s*\d+[.,]?\d*\s*[a-zA-Z"]*\s*$/.test(String(u || ""));

function titre(t) {
  console.log("\n" + "=".repeat(80) + "\n" + t + "\n" + "=".repeat(80));
}

// ------------------------------------------------------- FICHES TECHNIQUES
titre("1. ft_mesures_lignes — unités saisies dans les FICHES TECHNIQUES");

const lignesFiches = !tableExiste("ft_mesures_lignes") ? [] : db.prepare(
  "SELECT l.id, l.unite, mc.nom AS mesure, f.id AS fiche_id, f.statut, " +
  "a.reference_principale, p.nom AS produit " +
  "FROM ft_mesures_lignes l " +
  "JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
  "JOIN fiches_techniques f ON f.id = l.fiche_id " +
  "LEFT JOIN articles a ON a.id = f.article_id " +
  "LEFT JOIN listes_valeurs p ON p.id = a.produit_id " +
  "WHERE l.unite IS NOT NULL AND TRIM(l.unite) <> '' " +
  "ORDER BY f.id, l.ordre"
).all();

const anormalesFiches = lignesFiches.filter((r) => !estAttendue(r.unite));
console.log(`  ${lignesFiches.length} ligne(s) avec une unité renseignée, dont ${anormalesFiches.length} anormale(s).\n`);

if (anormalesFiches.length === 0) {
  console.log("  Aucune anomalie.");
} else {
  anormalesFiches.forEach((r) => {
    const drapeau = ressembleAUneValeur(r.unite) ? "VALEUR ?" : "inhabituel";
    console.log(
      "  [" + drapeau.padEnd(10) + "] unite=" + JSON.stringify(r.unite).padEnd(12) +
      " | " + String(r.mesure).padEnd(28) +
      " | fiche " + String(r.fiche_id).padEnd(4) + "(" + r.statut + ")" +
      " | " + (r.reference_principale || "sans réf.") + " — " + (r.produit || "")
    );
  });
}

// ------------------------------------------------------------- MODÈLES
titre("2. modeles_mesures_lignes — unités saisies dans les MODÈLES");

const lignesModeles = !tableExiste("modeles_mesures_lignes") ? [] : db.prepare(
  "SELECT l.id, l.unite, mc.nom AS mesure, m.nom AS modele, p.nom AS produit " +
  "FROM modeles_mesures_lignes l " +
  "JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
  "JOIN modeles_mesures m ON m.id = l.modele_id " +
  "LEFT JOIN listes_valeurs p ON p.id = m.produit_id " +
  "WHERE l.unite IS NOT NULL AND TRIM(l.unite) <> '' " +
  "ORDER BY m.nom, l.ordre"
).all();

const anormalesModeles = lignesModeles.filter((r) => !estAttendue(r.unite));
console.log(`  ${lignesModeles.length} ligne(s) avec une unité renseignée, dont ${anormalesModeles.length} anormale(s).\n`);

if (anormalesModeles.length === 0) {
  console.log("  Aucune anomalie.");
} else {
  anormalesModeles.forEach((r) => {
    const drapeau = ressembleAUneValeur(r.unite) ? "VALEUR ?" : "inhabituel";
    console.log(
      "  [" + drapeau.padEnd(10) + "] unite=" + JSON.stringify(r.unite).padEnd(12) +
      " | " + String(r.mesure).padEnd(28) +
      " | modèle « " + r.modele + " » — " + (r.produit || "")
    );
  });
}

// ------------------------------------------------- LE POINT QUI COMPTE
titre("3. Ces unités anormales cachent-elles une valeur PERDUE ?");
console.log("  Une unité du type « 75cm » n'est un problème que si la cellule de taille");
console.log("  correspondante est VIDE : la valeur aurait alors été saisie au mauvais endroit.\n");

let recuperables = 0;
anormalesFiches.filter((r) => ressembleAUneValeur(r.unite)).forEach((r) => {
  const ligne = un("SELECT mesure_catalogue_id FROM ft_mesures_lignes WHERE id = ?", r.id);
  if (!ligne) return;
  const nbValeurs = compter(
    "SELECT COUNT(*) AS n FROM ft_mesures_valeurs WHERE fiche_id = ? AND mesure_catalogue_id = ? AND valeur IS NOT NULL AND TRIM(valeur) <> ''",
    r.fiche_id, ligne.mesure_catalogue_id
  );
  const nbTailles = compter("SELECT COUNT(*) AS n FROM ft_tailles WHERE fiche_id = ?", r.fiche_id);

  if (nbValeurs === 0) {
    recuperables += 1;
    console.log(`  À RÉCUPÉRER  « ${r.unite} » sur « ${r.mesure} » (fiche ${r.fiche_id}) : aucune valeur saisie sur ${nbTailles} taille(s).`);
  } else {
    console.log(`  sans risque  « ${r.unite} » sur « ${r.mesure} » (fiche ${r.fiche_id}) : ${nbValeurs}/${nbTailles} valeur(s) déjà saisies.`);
  }
});
if (recuperables === 0) {
  console.log("  Aucune valeur ne semble avoir été perdue dans la colonne unité.");
}

// --------------------------------------------------------------- RÉSUMÉ
titre("RÉSUMÉ");
const toutes = lignesFiches.concat(lignesModeles);
const distinctes = [...new Set(toutes.map((r) => String(r.unite).trim()))].sort();
console.log("  Valeurs distinctes rencontrées : " + (distinctes.length ? distinctes.map((u) => JSON.stringify(u)).join(", ") : "aucune"));
console.log(`\n  Fiches  : ${anormalesFiches.length} anomalie(s) sur ${lignesFiches.length} ligne(s) renseignée(s).`);
console.log(`  Modèles : ${anormalesModeles.length} anomalie(s) sur ${lignesModeles.length} ligne(s) renseignée(s).`);
console.log(`  Potentiellement à récupérer : ${recuperables}`);
console.log("\n  Rien n'a été modifié. La colonne reste en base et reste modifiable dans");
console.log("  « Gérer les modèles » ; elle est simplement masquée dans la saisie et l'impression.\n");

db.close();
