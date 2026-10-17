// Génère la référence principale d'un article : {codeSaison}{2 derniers chiffres de l'année}-
// {codeRayon}-{abreviation}-{numéro séquentiel sur 2 chiffres}. Ex: FW26-M-JEA-01.
// Le numero est desormais sur 3 chiffres (series 101, 201, 301...). Les anciennes references
// gardent leurs 2 chiffres : elles ne sont jamais regenerees, donc jamais reformatees.
// padStart(3) laisse d'ailleurs « 01 » intact s'il etait recalcule, mais ce cas n'existe pas.
function genererReferencePrincipale({ saisonCode, annee, rayonCode, abreviation, sequentiel }) {
  const anneeCourte = String(annee).slice(-2).padStart(2, "0");
  const seq = String(sequentiel).padStart(sequentiel >= 100 ? 3 : 2, "0");
  return `${saisonCode}${anneeCourte}-${rayonCode}-${abreviation}-${seq}`;
}

// Calcule le prochain numéro séquentiel pour une combinaison saison/année/rayon/abréviation donnée.
// SERIES PAR GRANDE FAMILLE. La famille se deduit de la CATEGORIE du type d'article
// (listes_valeurs.parent_id), donc sans aucun referentiel supplementaire.
// Le compteur est GLOBAL et durable a la famille : il ignore l'annee, la saison, le rayon, le
// type et l'abreviation. Si 104 est pris, le suivant est 105, meme sur une autre saison.
const SERIES_PAR_CATEGORIE = {
  "t-shirts et polos": 100,
  "pulls et sweats": 100,
  "chemises": 100,
  "vestes et blousons": 200,
  "pantalons / jeans / shorts": 300,
  "ensembles": 400,
  "accessoires": 500,
};
const TAILLE_SERIE = 99;   // 101 -> 199, 201 -> 299, etc.

function normaliserCategorie(nom) {
  return String(nom == null ? "" : nom)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().toLowerCase().replace(/\s+/g, " ");
}

// Renvoie la base de serie d'un type d'article, ou null si sa categorie n'en a pas.
async function serieDuProduit(db, produitId) {
  if (!produitId) return null;
  const aParent = (await db.colonnes("listes_valeurs")).some((c) => c.name === "parent_id");
  if (!aParent) return null;
  const row = await db.prepare(
    "SELECT c.nom AS categorie FROM listes_valeurs t LEFT JOIN listes_valeurs c ON c.id = t.parent_id WHERE t.id = ?"
  ).get(produitId);
  if (!row || !row.categorie) return { base: null, categorie: null };
  return { base: SERIES_PAR_CATEGORIE[normaliserCategorie(row.categorie)] || null, categorie: row.categorie };
}

// Prochain numero dans la serie de la famille. Ne consulte QUE les numeros deja pris a
// l'interieur de la plage [base+1, base+TAILLE_SERIE] : les anciens articles, numerotes de 1 a
// 99, sont hors de toute plage et ne sont donc jamais relus ni renumerotes.
async function prochainSequentiel(db, { saisonId, annee, rayonId, abreviation, produitId }) {
  const serie = await serieDuProduit(db, produitId);

  // Aucune serie configuree : on BLOQUE plutot que d'attribuer un numero incorrect.
  if (!serie || !serie.base) {
    if (serie && serie.categorie) {
      throw new Error(`Aucune série de référence n'est configurée pour la catégorie « ${serie.categorie} ».`);
    }
    throw new Error("Aucune catégorie n'est rattachée à ce type d'article : impossible de déterminer la série de référence.");
  }

  const min = serie.base + 1;
  const max = serie.base + TAILLE_SERIE;
  const row = await db.prepare(
    "SELECT MAX(numero_sequentiel) AS m FROM articles WHERE numero_sequentiel BETWEEN ? AND ?"
  ).get(min, max);
  const suivant = (row.m || serie.base) + 1;

  // Plage epuisee : on bloque, sans deborder sur la serie voisine.
  if (suivant > max) {
    throw new Error(`La série ${serie.base} de la famille « ${serie.categorie} » est épuisée (${min} à ${max}). Attribuez-lui une nouvelle plage.`);
  }
  return suivant;
}

// Règle de validité d'une abréviation d'article : 2 à 5 lettres majuscules, sans accent/espace.
const ABREVIATION_REGEX = /^[A-Z]{2,5}$/;

module.exports = {
  SERIES_PAR_CATEGORIE,
  serieDuProduit, genererReferencePrincipale, prochainSequentiel, ABREVIATION_REGEX };
