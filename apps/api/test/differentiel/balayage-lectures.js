// ================================================================================================
// Balayage : appelle TOUTES les routes de lecture avec des identifiants réels de la base, sur
// l'ancien et le nouveau code, et liste les écarts. Utilisé sur une copie de la vraie base
// (jamais versionnée) et par les tests sur les données construites par les scénarios.
// ================================================================================================
const registre = require("../../src/routes/registre");

// Valeurs candidates par nom de paramètre (et par espace quand « id » est ambigu).
const SOURCES = {
  "commandes.id": "SELECT id FROM commandes", "articles.id": "SELECT id FROM articles", "bcPf.id": "SELECT id FROM bc_pf",
  "bcMp.id": "SELECT id FROM bc_mp", "planning.id": "SELECT id FROM planning_articles", "declinaisons.id": "SELECT id FROM article_variantes",
  "finance.id": "SELECT id FROM fournisseurs", "modelesMesures.id": "SELECT id FROM modeles_mesures", "grillesTailles.id": "SELECT id FROM grilles_tailles",
  commandeId: "SELECT id FROM commandes", articleId: "SELECT id FROM articles", ficheId: "SELECT id FROM fiches_techniques",
  achatId: "SELECT id FROM achats", fournisseurId: "SELECT id FROM fournisseurs", grilleId: "SELECT id FROM grilles_tailles",
  estimationId: "SELECT id FROM estimations", revisionId: "SELECT id FROM fiches_techniques_revisions", produitId: "SELECT DISTINCT produit_id AS id FROM articles",
  modeleId: "SELECT id FROM modeles_mesures", matiereCatalogueId: "SELECT id FROM matieres_catalogue", ftTailleId: "SELECT id FROM ft_tailles",
  ftMatiereId: "SELECT id FROM ft_matieres", ftAccessoireId: "SELECT id FROM ft_accessoires", typeId: "SELECT id FROM declinaison_types",
  bonId: "SELECT id FROM bc_mp", affectationId: "SELECT id FROM achats_affectations",
};
const SANS_ARGUMENT_SPECIFIQUE = {
  "finance.getFacture": "SELECT id FROM achats_factures",
};

async function balayer(mondes, { maxParParam = 40 } = {}) {
  const { appeler, ancienDb } = mondes;
  const valeurs = (sql) => ancienDb.prepare(sql).all().map((r) => r.id).filter((v) => v !== null).slice(0, maxParParam);
  const appels = [];
  for (const r of registre.filter((x) => x.lecture)) {
    const canal = `${r.espace}:${r.methode}`;
    const cle = `${r.espace}.${r.methode}`;
    if (r.params.length === 0) { appels.push([canal]); continue; }
    const p0 = r.params[0];
    const sql = SANS_ARGUMENT_SPECIFIQUE[cle] || SOURCES[`${r.espace}.${p0}`] || SOURCES[p0];
    if (p0 === "commandeIds") { appels.push([canal, valeurs("SELECT id FROM commandes")]); continue; }
    if (["filtres", "options", "opts", "criteres"].includes(p0)) { appels.push([canal, undefined], [canal, {}]); continue; }
    if (p0 === "type") { for (const t of ["produit", "couleur", "taille", "atelier", "categorie"]) appels.push([canal, t, { includeInactive: true }]); continue; }
    if (["query", "requete"].includes(p0)) { for (const q of ["", "a", "zi", "dos"]) appels.push([canal, q, 20]); continue; }
    if (p0 === "cleBase") { appels.push([canal, "t-shirt"]); continue; }
    if (!sql) { appels.push({ ignore: canal }); continue; }
    for (const v of valeurs(sql)) appels.push([canal, v]);
  }
  const ignores = [];
  for (const a of appels) {
    if (a.ignore) { ignores.push(a.ignore); continue; }
    try { await appeler(...a); } catch (e) { if (!e.attendue) { /* l'écart est dans le journal */ } }
  }
  return { ignores };
}

module.exports = { balayer };
