import { ESTELECTRON } from "../../api/platform";

export const todayISO = () => new Date().toISOString().slice(0, 10);

// Formate un horodatage SQLite ("YYYY-MM-DD HH:MM:SS") en "JJ/MM/AAAA HH:MM" sans conversion
// de fuseau horaire (affichage simple, cohérent avec le reste de l'application).
export function fmtDateTime(sqliteDateTime: string): string {
  const [datePart, timePart] = sqliteDateTime.split(" ");
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}${timePart ? " " + timePart.slice(0, 5) : ""}`;
}

// Construit l'URL d'affichage d'un média à partir du chemin RELATIF stocké en
// base (ex. "images/commandes/<uuid>.jpg"). Le chemin est identique dans les
// deux environnements : seul le préfixe change, d'où l'absence totale de
// réécriture en base lors du passage au web.
//
//   Electron : protocole interne enregistré dans electron/main.js, qui résout
//              le chemin depuis app.getPath("userData") et sert le fichier local.
//   Web      : objet Supabase Storage, dont la clé EST ce même chemin relatif.
//
// ESTELECTRON provient de src/api/platform.ts, capturé avant tout import
// susceptible d'installer un window.api de remplacement. On ne redétecte rien ici.
export function mediaUrl(relPath: string | null | undefined): string | null {
  if (!relPath) return null;
  if (ESTELECTRON) return `belvie-media://local/${relPath}`;

  const base = import.meta.env.VITE_SUPABASE_URL;
  const bucket = import.meta.env.VITE_SUPABASE_MEDIA_BUCKET || "belvie-media";
  // Sans configuration, renvoyer null plutôt qu'une URL invalide : le composant
  // affiche alors son état "pas de photo" au lieu d'une image cassée.
  if (!base) return null;

  // Chaque segment est encodé séparément : encodeURIComponent transformerait
  // les "/" en %2F et casserait l'arborescence des clés d'objet.
  const cle = relPath.split("/").map(encodeURIComponent).join("/");
  return `${String(base).replace(/\/+$/, "")}/storage/v1/object/public/${bucket}/${cle}`;
}
