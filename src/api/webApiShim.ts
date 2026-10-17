// ============================================================================
// SHIM window.api POUR LE NAVIGATEUR — installé uniquement quand window.api
// n'existe pas déjà (voir platform.ts). Reproduit EXACTEMENT les signatures
// de electron/preload.js pour les 7 namespaces déjà migrés, afin qu'aucun
// composant .tsx existant n'ait besoin d'être modifié.
//
// Les namespaces non migrés (finance, ficheTechnique, parametres, photos,
// entreprise, grillesTailles, modelesMesures, system) lèvent une erreur
// claire s'ils sont appelés — sauf deux lectures d'état précises,
// nécessaires au démarrage même de App.tsx (voir commentaire ci-dessous).
// ============================================================================

import { http } from "./httpClient";

// ----------------------------------------------------------------------------
// Sérialisation des paramètres de requête — POINT UNIQUE.
//
// new URLSearchParams({ statut: undefined }) produit littéralement
// "statut=undefined" : la valeur est convertie en CHAÎNE, pas omise. Côté
// serveur, req.query.statut vaut alors la chaîne "undefined", non vide donc
// truthy, et une clause WHERE parasite s'ajoute — d'où zéro résultat.
//
// Les appelants passent couramment des filtres optionnels sous la forme
// `{ statut: filtre || undefined }` : il est donc normal que des propriétés
// undefined arrivent ici, et c'est à la sérialisation de les ignorer.
//
// Electron n'est pas concerné : preload.js transmet l'objet tel quel via IPC,
// où undefined reste undefined et donc falsy. Ce correctif ne modifie en rien
// son comportement.
//
// null et undefined sont omis. La chaîne vide est CONSERVÉE : elle peut être
// un filtre légitime, et c'est à l'appelant de ne pas l'envoyer s'il n'en veut pas.
function queryString(params?: unknown): string {
  if (!params || typeof params !== "object") return "";
  const usp = new URLSearchParams();
  for (const [cle, valeur] of Object.entries(params as Record<string, unknown>)) {
    if (valeur === undefined || valeur === null) continue;
    if (Array.isArray(valeur)) {
      for (const v of valeur) if (v !== undefined && v !== null) usp.append(cle, String(v));
      continue;
    }
    usp.append(cle, String(valeur));
  }
  const s = usp.toString();
  return s ? `?${s}` : "";
}

function indisponible(nom: string) {
  return () => { throw new Error(`${nom} n'est pas encore disponible dans la version web. Utilisez l'application Electron pour cette fonctionnalité.`); };
}

const commandes = {
  list: () => http.get("/commandes"),
  get: (id: number) => http.get(`/commandes/${id}`),
  create: (payload: unknown) => http.post("/commandes", payload),
  update: (id: number, payload: unknown) => http.patch(`/commandes/${id}`, payload),
  remove: (id: number) => http.delete(`/commandes/${id}`),
  valider: (id: number) => http.post(`/commandes/${id}/valider`),
  lancerProduction: (id: number) => http.post(`/commandes/${id}/lancer-production`),
  entrerEnControleQualite: (id: number) => http.post(`/commandes/${id}/controle-qualite`),
  terminerProduction: (id: number) => http.post(`/commandes/${id}/terminer`),
  annuler: (id: number, motif: string) => http.post(`/commandes/${id}/annuler`, { motif }),
  bloquer: (id: number, motif: string) => http.post(`/commandes/${id}/bloquer`, { motif }),
  debloquer: (id: number) => http.post(`/commandes/${id}/debloquer`),
  archiver: (id: number) => http.post(`/commandes/${id}/archiver`),
  desarchiver: (id: number) => http.post(`/commandes/${id}/desarchiver`),
};

const articles = {
  list: (opts?: unknown) => http.get(`/articles${queryString(opts)}`),
  get: (id: number) => http.get(`/articles/${id}`),
  create: (payload: unknown) => http.post("/articles", payload),
  completerReference: (id: number, payload: unknown) => http.patch(`/articles/${id}/reference`, payload),
  ajouterPhoto: indisponible("L'ajout de photo"),
  definirPhotoPrincipale: (photoId: number) => http.patch(`/articles/photos/${photoId}/principale`),
  retirerPhoto: (photoId: number) => http.delete(`/articles/photos/${photoId}`),
};

const etapes = {
  list: (opts?: unknown) => http.get(`/etapes${queryString(opts)}`),
  update: (id: number, payload: unknown) => http.patch(`/etapes/${id}`, payload),
  create: (payload: unknown) => http.post("/etapes", payload),
};

const listes = {
  list: (type: string, opts?: unknown) => http.get(`/listes/${type}${queryString(opts)}`),
  create: (type: string, nom: string, opts?: unknown) => http.post(`/listes/${type}`, { nom, ...(opts as object) }),
  update: (id: number, patch: unknown) => http.patch(`/listes/${id}`, patch),
};

const bcPf = {
  getByCommandeId: (commandeId: number) => http.get(`/bc-pf/commande/${commandeId}`),
  listForCommande: (commandeId: number) => http.get(`/bc-pf/commande/${commandeId}/historique`),
  get: (id: number) => http.get(`/bc-pf/${id}`),
  creer: (commandeId: number) => http.post(`/bc-pf/commande/${commandeId}`),
  update: (id: number, patch: unknown) => http.patch(`/bc-pf/${id}`, patch),
  mettreAJourDepuisCommande: (id: number) => http.post(`/bc-pf/${id}/synchroniser`),
  valider: (id: number) => http.post(`/bc-pf/${id}/valider`),
  lancer: (id: number) => http.post(`/bc-pf/${id}/lancer`),
  remplacer: (id: number, motif: string) => http.post(`/bc-pf/${id}/remplacer`, { motif }),
  telechargerPdf: indisponible("Le téléchargement du PDF"),
};

const declinaisons = {
  listTypes: (options?: unknown) => http.get(`/declinaisons/types${queryString(options)}`),
  createType: (nom: string, options?: unknown) => http.post("/declinaisons/types", { nom, ...(options as object) }),
  updateType: (id: number, patch: unknown) => http.patch(`/declinaisons/types/${id}`, patch),
  reorderTypes: (orderedIds: number[]) => http.post("/declinaisons/types/reordonner", { orderedIds }),
  listValeurs: (typeId: number, options?: unknown) => http.get(`/declinaisons/types/${typeId}/valeurs${queryString(options)}`),
  createValeur: (typeId: number, valeur: string, options?: unknown) => http.post(`/declinaisons/types/${typeId}/valeurs`, { valeur, ...(options as object) }),
  updateValeur: (id: number, patch: unknown) => http.patch(`/declinaisons/valeurs/${id}`, patch),
  reorderValeurs: (typeId: number, orderedIds: number[]) => http.post(`/declinaisons/types/${typeId}/valeurs/reordonner`, { orderedIds }),
  getArticleTypes: (articleId: number) => http.get(`/declinaisons/articles/${articleId}/types`),
  getArticleValeurs: (articleId: number) => http.get(`/declinaisons/articles/${articleId}/valeurs`),
  setArticleTypes: (articleId: number, typeIds: number[]) => http.put(`/declinaisons/articles/${articleId}/types`, { typeIds }),
  articleHasVariantes: async (articleId: number) => (await http.get(`/declinaisons/articles/${articleId}/variantes`)).length > 0,
  previsualiserImpact: (articleId: number, selections: unknown) => http.post(`/declinaisons/articles/${articleId}/previsualiser-impact`, { selections }),
  appliquerConfiguration: (articleId: number, typeIds: number[], selections: unknown) => http.post(`/declinaisons/articles/${articleId}/appliquer-configuration`, { typeIds, selections }),
  listVariantes: (articleId: number, options?: unknown) => http.get(`/declinaisons/articles/${articleId}/variantes${queryString(options)}`),
  getVariante: (id: number) => http.get(`/declinaisons/variantes/${id}`),
  genererVariantes: (articleId: number, selections: unknown) => http.post(`/declinaisons/articles/${articleId}/generer-variantes`, { selections }),
  updateVariante: (id: number, patch: unknown) => http.patch(`/declinaisons/variantes/${id}`, patch),
  deleteVariante: (id: number) => http.delete(`/declinaisons/variantes/${id}`),
};

const planning = {
  list: (filtres?: unknown) => http.get(`/planning${queryString(filtres)}`),
  get: (id: number) => http.get(`/planning/${id}`),
  kpis: () => http.get("/planning/kpis"),
  creer: (payload: unknown) => http.post("/planning", payload),
  mettreAJour: (id: number, patch: unknown) => http.patch(`/planning/${id}`, patch),
  deplacer: (id: number, champ: string, nouveauMois: string, orderedIds: number[], forcer?: boolean) =>
    http.post(`/planning/${id}/deplacer`, { champ, nouveauMois, orderedIds, forcer }),
  reordonner: (mois: string, orderedIds: number[]) => http.post("/planning/reordonner", { mois, orderedIds }),
  ajouterPhoto: indisponible("L'ajout de photo"),
  retirerPhoto: (id: number, forcer?: boolean) => http.delete(`/planning/${id}/photo`, { forcer }),
  retirerDuPlanning: (id: number) => http.post(`/planning/${id}/retirer`),
  supprimerProvisoire: (id: number) => http.delete(`/planning/${id}/provisoire`),
  convertirEnProduit: (id: number, payloadArticle: unknown) => http.post(`/planning/${id}/convertir`, payloadArticle),
};

// --- Namespaces non migrés : erreur claire, sauf deux lectures d'état ------
// nécessaires au démarrage même de App.tsx (opérateur actif, état de
// l'assistant de première configuration). Aucune LOGIQUE métier ici — juste
// des valeurs neutres permettant à App.tsx de s'afficher normalement sans
// modification, la vraie fonctionnalité Paramètres/Entreprise restant
// indisponible sur le web comme prévu.
const parametres = {
  getOperateurActif: async () => null,
};
const entreprise = {
  getEtatWizard: async () => "already_shown",
};

function moduleIndisponible(nom: string) {
  return new Proxy({}, { get: () => indisponible(nom) });
}

const photos = moduleIndisponible("Cette fonctionnalité");
const grillesTailles = moduleIndisponible("La gestion des grilles de tailles");
const ficheTechnique = moduleIndisponible("Les fiches techniques");
const modelesMesures = moduleIndisponible("Les modèles de mesures");
const finance = moduleIndisponible("Finance");
const system = moduleIndisponible("Cette fonction système");

export const webApi = {
  commandes, articles, etapes, listes, bcPf, declinaisons, planning,
  parametres, entreprise, photos, grillesTailles, ficheTechnique, modelesMesures, finance, system,
};

export function installerShimWebSiNecessaire() {
  if (typeof (window as any).api === "undefined") {
    (window as any).api = webApi;
  }
}
