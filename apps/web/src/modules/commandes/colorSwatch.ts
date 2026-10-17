// Devine une pastille de couleur à partir du nom (français). Purement visuel : aucune couleur
// n'est stockée en base, ce mapping ne fait que deviner un rendu plausible pour l'affichage.
// Les noms non reconnus (couleurs personnalisées) retombent sur un gris neutre.
const KEYWORD_SWATCHES: [RegExp, string][] = [
  [/blanc/i, "#FFFFFF"],
  [/noir/i, "#1F2937"],
  [/gris/i, "#9CA3AF"],
  [/beige/i, "#D9C4A3"],
  [/écru|ecru|crème|creme|ivoire/i, "#F0EAD6"],
  [/rouge/i, "#DC2626"],
  [/bordeaux/i, "#6B1F2A"],
  [/rose/i, "#EC93B5"],
  [/orange/i, "#EA7B2C"],
  [/jaune/i, "#F2C94C"],
  [/kaki/i, "#8A8C5A"],
  [/vert.*pastel|pastel.*vert/i, "#B7D9B1"],
  [/vert/i, "#2F9E52"],
  [/turquoise/i, "#14B8A6"],
  [/canard/i, "#0B5F6B"],
  [/bleu.*marine|marine/i, "#1E3A5F"],
  [/bleu/i, "#2563EB"],
  [/indigo/i, "#3B4CA0"],
  [/violet|mauve|lilas/i, "#8B5CF6"],
  [/marron|brun|chocolat/i, "#6B4226"],
  [/argent/i, "#C0C0C8"],
  [/or |doré|dore/i, "#D4AF37"],
  [/terracotta/i, "#C2603D"],
];

export function guessSwatch(nom: string): string {
  for (const [pattern, hex] of KEYWORD_SWATCHES) {
    if (pattern.test(nom)) return hex;
  }
  return "#D1D5DB";
}
