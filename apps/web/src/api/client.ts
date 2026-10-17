// ================================================================================================
// CLIENT DE L'API — reconstruit `window.api` dans le navigateur.
//
// Les écrans appellent toujours window.api.<espace>.<methode>(…args) comme dans l'application
// Electron : ce fichier traduit chaque appel en requête HTTP selon la table générée
// routes.generated.ts (elle-même tirée du registre de l'API). Aucun écran n'a donc à connaître
// les URL, et un appel inconnu de l'API n'existe tout simplement pas côté interface.
//
// Les quelques fonctions qui ne sont pas de simples appels (choix d'un fichier, téléchargement
// d'un PDF ou d'un export, protection de la saisie à la fermeture) sont définies plus bas.
// ================================================================================================
import { ROUTES } from "./routes.generated";

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) || "";

export class SessionExpireeError extends Error {
  constructor(message = "Votre session a expiré. Veuillez vous reconnecter.") { super(message); this.name = "SessionExpireeError"; }
}

// Prévenu quand le serveur répond 401 (session expirée, compte désactivé) : l'écran de
// connexion réapparaît au lieu d'une erreur incompréhensible.
let surSessionExpiree: () => void = () => {};
export function quandSessionExpire(fn: () => void) { surSessionExpiree = fn; }

async function lireReponse(res: Response) {
  let json: any = null;
  try { json = await res.json(); } catch { /* corps vide */ }
  if (res.status === 401) { surSessionExpiree(); throw new SessionExpireeError(json?.erreur); }
  if (!res.ok) throw new Error(json?.erreur || `Erreur serveur (${res.status}).`);
  return json ? json.resultat : undefined;
}

function queryString(params: string[], args: unknown[]) {
  const usp = new URLSearchParams();
  params.forEach((p, i) => { if (args[i] !== undefined) usp.append(p, JSON.stringify(args[i])); });
  const s = usp.toString();
  return s ? `?${s}` : "";
}

export async function get(chemin: string, params: string[] = [], args: unknown[] = []) {
  const res = await fetch(`${BASE}/api${chemin}${queryString(params, args)}`, { credentials: "include" });
  return lireReponse(res);
}

export async function post(chemin: string, corps: Record<string, unknown> = {}) {
  const res = await fetch(`${BASE}/api${chemin}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "X-Belvie": "1" },
    body: JSON.stringify(corps),
  });
  return lireReponse(res);
}

function appelRoute(r: { espace: string; methode: string; lecture: boolean; params: string[] }) {
  const chemin = `/${r.espace}/${r.methode}`;
  return (...args: unknown[]) => {
    if (r.lecture) return get(chemin, r.params, args);
    const corps: Record<string, unknown> = {};
    r.params.forEach((p, i) => { if (args[i] !== undefined) corps[p] = args[i]; });
    return post(chemin, corps);
  };
}

// ------------------------------------------------------------------------------------------------
// Fichiers : choix d'une image (remplace le sélecteur natif d'Electron) et téléchargements.
// ------------------------------------------------------------------------------------------------
function choisirFichier(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    let fini = false;
    const terminer = (f: File | null) => { if (fini) return; fini = true; input.remove(); resolve(f); };
    input.addEventListener("change", () => terminer(input.files && input.files[0] ? input.files[0] : null));
    input.addEventListener("cancel", () => terminer(null));
    // Repli pour les navigateurs sans évènement « cancel » : retour du focus sans fichier choisi.
    window.addEventListener("focus", () => setTimeout(() => { if (!input.files || !input.files.length) terminer(null); }, 800), { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

// Même forme de résultat que l'ancien photos:pick : { canceled, filePath, fileName, sizeBytes, dataUrl } | { canceled:false, error }
async function choisirImage() {
  const fichier = await choisirFichier("image/jpeg,image/png,image/webp");
  if (!fichier) return { canceled: true };
  const formulaire = new FormData();
  formulaire.append("fichier", fichier, fichier.name);
  const res = await fetch(`${BASE}/api/fichiers`, { method: "POST", credentials: "include", headers: { "X-Belvie": "1" }, body: formulaire });
  try { return await lireReponse(res); } catch (err: any) { return { canceled: false, error: err.message }; }
}

async function telecharger(chemin: string, params: string[], args: unknown[], nomParDefaut: string) {
  const res = await fetch(`${BASE}/api${chemin}${queryString(params, args)}`, { credentials: "include" });
  if (!res.ok) { await lireReponse(res); return { canceled: true }; }
  const blob = await res.blob();
  const dispo = res.headers.get("content-disposition") || "";
  const m = /filename\*=UTF-8''([^;]+)/.exec(dispo);
  const nom = m ? decodeURIComponent(m[1]) : nomParDefaut;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nom; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { canceled: false, filePath: nom };
}

// ------------------------------------------------------------------------------------------------
// Saisie non enregistrée : dans Electron, la fermeture de la fenêtre déclenchait un dernier
// enregistrement. Dans un navigateur, on prévient l'utilisateur avant de quitter la page.
// ------------------------------------------------------------------------------------------------
let modificationsEnAttente = 0;
window.addEventListener("beforeunload", (e) => {
  if (modificationsEnAttente > 0) { e.preventDefault(); e.returnValue = ""; }
});

export function construireApi() {
  const api: Record<string, Record<string, unknown>> = {};
  for (const r of ROUTES) {
    if (!api[r.espace]) api[r.espace] = {};
    api[r.espace][r.methode] = appelRoute(r);
  }
  const espace = (nom: string) => (api[nom] = api[nom] || {});
  espace("photos").pick = choisirImage;
  espace("entreprise").pickLogo = choisirImage;
  espace("ficheTechnique").pickCroquis = choisirImage;
  espace("ficheTechnique").pickAccessoirePhoto = choisirImage;
  espace("bcPf").telechargerPdf = (id: number, suggestedName?: string) => telecharger("/bcPf/telechargerPdf", ["id", "suggestedName"], [id, suggestedName], "bon-de-commande.pdf");
  espace("ficheTechnique").telechargerPdf = (ficheId: number, suggestedName?: string) => telecharger("/ficheTechnique/telechargerPdf", ["ficheId", "suggestedName"], [ficheId, suggestedName], "fiche-technique.pdf");
  espace("bcPf").lancer = (id: number) => post("/bcPf/lancer", { id });
  const system = espace("system");
  system.exportFile = (format: string) => telecharger("/system/exportFile", ["format"], [format], `belvie-commandes.${format === "csv" ? "csv" : "xlsx"}`);
  system.backup = (options?: unknown) => post("/system/backup", { options });
  system.backupAvantOperation = (motif?: string) => post("/system/backupAvantOperation", { motif });
  system.listerSauvegardes = () => get("/system/listerSauvegardes");
  system.verifierSauvegarde = (dossier?: string) => get("/system/verifierSauvegarde", ["dossier"], [dossier]);
  system.telechargerSauvegarde = (nom: string, fichier: string) => telecharger("/system/telechargerSauvegarde", ["nom", "fichier"], [nom, fichier], `${nom}-${fichier}`);
  system.dossierExterne = () => get("/system/dossierExterne");
  system.loadDemoData = () => post("/system/loadDemoData");
  system.clearDemoData = () => post("/system/clearDemoData");
  for (const m of ["restore", "essaiRestauration", "choisirDossierExterne", "oublierDossierExterne"]) system[m] = () => post(`/system/${m}`);
  api.app = {
    setModificationsEnAttente: (n: number) => { modificationsEnAttente = Number(n) || 0; },
    onEnregistrerAvantFermeture: () => () => {},
    pretAFermer: () => {},
  };
  return api;
}

export const auth = {
  moi: () => get("/auth/moi"),
  connexion: (email: string, motDePasse: string) => post("/auth/connexion", { email, motDePasse }),
  deconnexion: () => post("/auth/deconnexion"),
};
