/**
 * Belvie ERP — Mapping « produit » actuel -> Type d'article générique
 *
 * LECTURE SEULE. N'écrit rien, ne modifie rien, ne supprime rien.
 * AUCUNE migration n'est déclenchée : ce script ne fait que PROPOSER un mapping à valider.
 *
 *     node mapping-types-articles.js
 *     node mapping-types-articles.js "C:\chemin\vers\belvie.db"
 *
 * Utilise node:sqlite (Node 22+), jamais better-sqlite3 : ce dernier est compilé pour l'ABI
 * d'Electron (erreur « NODE_MODULE_VERSION 125 vs 127 »). Ne PAS lancer `npm rebuild` pour
 * contourner cela, l'application ne pourrait plus l'ouvrir.
 *
 * PRINCIPE : la reconnaissance se fait par MOTS-CLÉS sur le nom du produit. C'est une aide à la
 * décision, jamais une vérité. Tout ce qui n'est pas reconnu de façon certaine est marqué
 * « À VALIDER » et ne sera JAMAIS migré automatiquement.
 */

const path = require("path");
const fs = require("fs");

let DatabaseSync;
try {
  ({ DatabaseSync } = require("node:sqlite"));
} catch (e) {
  console.error("node:sqlite est indisponible. Node.js 22 ou plus recent est requis.");
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
  console.error('Passez le chemin en argument : node mapping-types-articles.js "C:\\chemin\\belvie.db"');
  process.exit(1);
}

const db = new DatabaseSync(dbPath, { readOnly: true });
console.log("Base analysee (lecture seule) : " + dbPath);

const norm = (s) => String(s == null ? "" : s)
  .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
  .trim().toLowerCase().replace(/\s+/g, " ");

function titre(t) { console.log("\n" + "=".repeat(100) + "\n" + t + "\n" + "=".repeat(100)); }

// ------------------------------------------------------------------------------------------------
// Règles de reconnaissance. L'ORDRE COMPTE : la première qui correspond gagne, donc les libellés
// les plus spécifiques sont placés avant les plus génériques ("jogging" avant "pantalon",
// "short de bain" avant "short").
//   type    : le type d'article générique proposé
//   modele  : la clé du jeu de mesures standard correspondant (voir modelesMesures.js)
//   famille : sert à proposer une catégorie et une nature de grille
// ------------------------------------------------------------------------------------------------
const REGLES = [
  { mots: ["hoodie", "capuche", "sweat a capuche", "sweat capuche"], type: "Hoodie", modele: "hoodie", famille: "haut_maille" },
  { mots: ["sweat", "crewneck"], type: "Sweat", modele: "sweat", famille: "haut_maille" },
  { mots: ["polo"], type: "Polo", modele: "polo", famille: "haut_maille" },
  { mots: ["debardeur", "tank"], type: "Débardeur", modele: "debardeur", famille: "haut_maille" },
  { mots: ["t-shirt", "tshirt", "tee shirt", "tee-shirt"], type: "T-shirt", modele: "haut_maille", famille: "haut_maille" },
  { mots: ["pull", "maille fine", "tricot"], type: "Pull", modele: "pull", famille: "haut_maille" },
  // Les vestes AVANT les chemises : « Blouson Woolness col chemise » contient le mot "chemise",
  // mais il y désigne une forme de COL, pas le vêtement. Sans cet ordre, le blouson était classé
  // en chemise — erreur détectée sur vos données réelles pendant la mise au point.
  { mots: ["teddy"], type: "Teddy", modele: "veste_blouson", famille: "veste" },
  { mots: ["bomber"], type: "Bomber", modele: "veste_blouson", famille: "veste" },
  { mots: ["blouson"], type: "Blouson", modele: "veste_blouson", famille: "veste" },
  { mots: ["surchemise"], type: "Surchemise", modele: "chemise", famille: "chemise" },
  { mots: ["chemise"], type: "Chemise", modele: "chemise", famille: "chemise" },
  { mots: ["doudoune sans manches", "gilet"], type: "Gilet", modele: "gilet_sans_manches", famille: "veste" },
  { mots: ["doudoune", "matelasse", "matelassee", "veste"], type: "Veste", modele: "veste_blouson", famille: "veste" },
  { mots: ["short de bain", "maillot"], type: "Short de bain", modele: "short_bain", famille: "bas" },
  { mots: ["bermuda", "pantacourt"], type: "Bermuda", modele: "bermuda", famille: "bas" },
  { mots: ["short"], type: "Short", modele: "short", famille: "bas" },
  { mots: ["jogging", "pantalon de survetement", "pantalon molleton", "pantalon en molleton", "pantalon sweat"], type: "Jogging", modele: "jogging", famille: "bas" },
  { mots: ["jean", "denim"], type: "Jean", modele: "pantalon", famille: "bas" },
  { mots: ["chino"], type: "Chino", modele: "pantalon", famille: "bas" },
  { mots: ["pantalon"], type: "Pantalon", modele: "pantalon", famille: "bas" },
];

// Cas volontairement NON reconnus : trop génériques pour trancher sans vous.
const AMBIGUS = ["survetement", "ensemble", "set", "accessoire", "divers", "autre"];

const LIBELLE_MODELE = {
  haut_maille: "Haut en maille (base)", polo: "Polo", pull: "Pull", sweat: "Sweat",
  hoodie: "Hoodie", debardeur: "Débardeur", chemise: "Chemise / Surchemise",
  veste_blouson: "Veste / Blouson", gilet_sans_manches: "Gilet / Doudoune sans manches",
  pantalon: "Pantalon", jogging: "Jogging / Pantalon en maille", short: "Short",
  short_bain: "Short de bain", bermuda: "Bermuda / Pantacourt",
};

// Renvoie la règle retenue, plus la liste des AUTRES règles qui correspondaient aussi. Quand
// plusieurs types différents sont possibles, la proposition est signalée comme incertaine :
// mieux vaut vous la soumettre que trancher seul.
function reconnaitre(nom) {
  const n = norm(nom);
  if (AMBIGUS.some((a) => n.includes(a))) return { regle: null, concurrents: [] };
  const correspondances = REGLES.filter((r) => r.mots.some((m) => n.includes(norm(m))));
  if (correspondances.length === 0) return { regle: null, concurrents: [] };
  const retenue = correspondances[0];
  const concurrents = correspondances.slice(1).filter((r) => r.type !== retenue.type).map((r) => r.type);
  return { regle: retenue, concurrents: concurrents };
}

// ------------------------------------------------------------------ données réelles
const produits = db.prepare(
  "SELECT id, nom, actif FROM listes_valeurs WHERE type = 'produit' ORDER BY nom COLLATE NOCASE"
).all();

const articles = db.prepare(
  "SELECT a.id, a.reference_principale, a.produit_id, a.categorie_id, " +
  "c.nom AS categorie, (SELECT COUNT(*) FROM fiches_techniques WHERE article_id = a.id) AS nb_fiches, " +
  "(SELECT COUNT(*) FROM commandes WHERE article_id = a.id AND deleted_at IS NULL) AS nb_commandes " +
  "FROM articles a LEFT JOIN listes_valeurs c ON c.id = a.categorie_id"
).all();

const grilles = db.prepare(
  "SELECT g.id, g.nom, (SELECT COUNT(*) FROM grilles_tailles_valeurs WHERE grille_id = g.id AND actif = 1) AS nb " +
  "FROM grilles_tailles g WHERE g.actif = 1 ORDER BY g.nom"
).all();

// Une grille n'est proposée que si UNE SEULE grille non ambiguë existe pour cette nature.
// « à vérifier » dans le nom = jamais proposée automatiquement, sur votre consigne explicite.
const grillesSures = grilles.filter((g) => !norm(g.nom).includes("verifier"));
const grilleLettres = grillesSures.filter((g) => !/^\d/.test(norm(g.nom)) && !norm(g.nom).includes("numerique"));

titre("1. GRILLES DE TAILLES DISPONIBLES");
if (grilles.length === 0) {
  console.log("  Aucune grille active.");
} else {
  grilles.forEach((g) => {
    const val = db.prepare("SELECT valeur FROM grilles_tailles_valeurs WHERE grille_id = ? AND actif = 1 ORDER BY ordre").all(g.id).map((v) => v.valeur);
    const drapeau = norm(g.nom).includes("verifier") ? "  [JAMAIS PROPOSEE AUTOMATIQUEMENT]" : "";
    console.log("  " + String(g.id).padEnd(4) + g.nom.padEnd(34) + val.join(" | ") + drapeau);
  });
}

titre("2. MAPPING PROPOSE — produit actuel -> type d'article");
console.log(
  "  " + "PRODUIT ACTUEL".padEnd(30) + "ART".padEnd(5) + "TYPE PROPOSE".padEnd(16) +
  "MODELE DE MESURES".padEnd(32) + "GRILLE".padEnd(16) + "CONFIANCE"
);
console.log("  " + "-".repeat(115));

const resultats = [];
produits.forEach((p) => {
  const arts = articles.filter((a) => a.produit_id === p.id);
  const rec = reconnaitre(p.nom);
  const r = rec.regle;
  let grille = "À VALIDER";
  if (r && r.famille !== "bas" && grilleLettres.length === 1) grille = grilleLettres[0].nom;
  else if (r && r.famille === "bas") grille = "À VALIDER (numérique)";

  const confiance = !r ? "À VALIDER"
    : rec.concurrents.length > 0 ? ("À VALIDER (ou " + rec.concurrents.join("/") + " ?)")
    : (arts.length === 0 ? "sûr (inutilisé)" : "sûr");
  resultats.push({ produit: p, arts, regle: r, grille, confiance, concurrents: rec.concurrents });

  console.log(
    "  " + (p.nom + (p.actif ? "" : " [inactif]")).slice(0, 29).padEnd(30) +
    String(arts.length).padEnd(5) +
    (r ? r.type : "?").padEnd(16) +
    (r ? LIBELLE_MODELE[r.modele] : "—").padEnd(32) +
    grille.slice(0, 15).padEnd(16) +
    confiance
  );
});

titre("3. CAS AMBIGUS — votre décision est nécessaire");
const ambigus = resultats.filter((x) => !x.regle || x.concurrents.length > 0);
if (ambigus.length === 0) {
  console.log("  Aucun. Toutes les valeurs ont une proposition.");
} else {
  console.log("  Ces valeurs ne sont PAS reconnues avec certitude. Rien ne sera migré sans votre choix.\n");
  ambigus.forEach((x) => {
    console.log("  « " + x.produit.nom + " »" + (x.regle
      ? "   proposition : " + x.regle.type + " — mais " + x.concurrents.join(" ou ") + " est aussi possible"
      : ""));
    if (x.arts.length === 0) console.log("      aucun article — la valeur peut probablement être désactivée");
    else x.arts.forEach((a) => console.log("      article " + (a.reference_principale || "sans réf.") +
      "  categorie=" + (a.categorie || "—") + "  fiches=" + a.nb_fiches + "  commandes=" + a.nb_commandes));
    console.log("      -> type d'article a definir : ______________\n");
  });
}

titre("4. LISTE FINALE DES TYPES D'ARTICLES PROPOSES");
const types = new Map();
resultats.filter((x) => x.regle).forEach((x) => {
  if (!types.has(x.regle.type)) types.set(x.regle.type, { modele: x.regle.modele, produits: [], articles: 0 });
  const t = types.get(x.regle.type);
  t.produits.push(x.produit.nom);
  t.articles += x.arts.length;
});
console.log("  " + types.size + " type(s) remplaceraient " + resultats.filter((x) => x.regle).length + " valeur(s) actuelle(s).\n");
[...types.entries()].sort().forEach(([type, t]) => {
  console.log("  " + type.padEnd(16) + "modele : " + LIBELLE_MODELE[t.modele].padEnd(32) + t.articles + " article(s)");
  t.produits.forEach((p) => console.log("      <- " + p));
});

titre("5. CE QUI DOIT ETRE PRESERVE DANS articles.designation");
console.log("  Le nom du produit actuel est aujourd'hui le SEUL libellé lisible d'un article :");
console.log("  commandes.js, ficheTechnique.js et bcPf.js affichent tous p.nom.");
console.log("  Repointer produit_id sans recopier ce nom rendrait vos articles indiscernables.\n");
articles.forEach((a) => {
  const p = produits.find((x) => x.id === a.produit_id);
  if (!p) return;
  console.log("  article " + String(a.id).padEnd(4) + (a.reference_principale || "sans réf.").padEnd(22) +
    "designation <- « " + p.nom + " »");
});
if (articles.length === 0) console.log("  Aucun article.");

titre("RESUME");
console.log("  Produits actuels          : " + produits.length);
console.log("  Reconnus avec confiance   : " + resultats.filter((x) => x.regle).length);
console.log("  A VALIDER par vous        : " + ambigus.length);
console.log("  Types d'articles proposes : " + types.size);
console.log("  Articles a preserver      : " + articles.filter((a) => a.produit_id).length);
console.log("\n  AUCUNE donnee n'a ete modifiee. Ce mapping est une PROPOSITION a valider.");
console.log("  Les grilles restent marquees A VALIDER : aucune association automatique,");
console.log("  conformement a la consigne sur « Tailles numeriques (a verifier) ».\n");

db.close();
