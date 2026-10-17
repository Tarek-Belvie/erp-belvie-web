// Convention unique d'abréviation des mois, utilisée dans tout l'ERP — un seul endroit à modifier
// si la convention doit changer un jour. N'affecte jamais le format stocké en base ('AAAA-MM'),
// uniquement l'affichage.
export const MOIS_ABREGES = [
  "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin",
  "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc.",
] as const;

// Pour un mois donné (1-12), retourne son libellé abrégé.
export function moisAbrege(mois: number): string {
  return MOIS_ABREGES[mois - 1] ?? "";
}

// Pour une clé 'AAAA-MM', retourne "Févr. 2027".
export function labelMoisAnnee(cle: string): string {
  const [annee, mois] = cle.split("-").map(Number);
  return `${moisAbrege(mois)} ${annee}`;
}

// Pour une date ISO 'AAAA-MM-JJ', retourne "18 Août" — jour + mois abrégé, sans année (l'année
// n'apparaît que si elle diffère de l'année en cours, pour rester lisible sans être répétitif).
export function labelJour(dateIso: string): string {
  const [annee, mois, jour] = dateIso.split("-").map(Number);
  const anneeCourante = new Date().getFullYear();
  const base = `${String(jour).padStart(2, "0")} ${moisAbrege(mois)}`;
  return annee === anneeCourante ? base : `${base} ${annee}`;
}
