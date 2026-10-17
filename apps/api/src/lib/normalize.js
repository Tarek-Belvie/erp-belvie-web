// Utilisé pour comparer deux noms "au sens humain" : casse et espaces ignorés.
function normalizeNom(s) {
  return String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

// Retire les accents (é, è, ê...) — utilisé uniquement pour la recherche/autocomplétion, jamais
// pour la déduplication exacte du catalogue : "café" et "cafe" doivent rester deux entrées
// distinctes si l'utilisateur les a saisies ainsi, mais chercher "cafe" doit quand même trouver
// "Café".
function stripAccents(s) {
  return String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

// Les codes (saison, rayon) sont toujours stockés et comparés en MAJUSCULES, sans espaces.
function normalizeCode(s) {
  return String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

module.exports = { normalizeNom, normalizeCode, stripAccents };
