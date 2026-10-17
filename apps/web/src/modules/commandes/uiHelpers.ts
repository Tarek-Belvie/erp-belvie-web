
export const todayISO = () => new Date().toISOString().slice(0, 10);

// Formate un horodatage SQLite ("YYYY-MM-DD HH:MM:SS") en "JJ/MM/AAAA HH:MM" sans conversion
// de fuseau horaire (affichage simple, cohérent avec le reste de l'application).
export function fmtDateTime(sqliteDateTime: string): string {
  const [datePart, timePart] = sqliteDateTime.split(" ");
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}${timePart ? " " + timePart.slice(0, 5) : ""}`;
}

// Construit l'URL d'affichage d'un média à partir du chemin RELATIF stocké en
// base (ex. "images/commandes/<uuid>.jpg"). Le chemin est celui de l'ancienne
// application Electron, inchangé : la reprise des fichiers n'a rien réécrit en base.
export function mediaUrl(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  // Fichiers servis par l'API (route /media, session obligatoire). Chaque segment est encodé
  // séparément pour conserver les « / » de l'arborescence.
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";
  return `${base}/media/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}
