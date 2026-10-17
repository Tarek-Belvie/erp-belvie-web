// ============================================================================
// CLIENT HTTP CENTRALISÉ — un seul point pour joindre le jeton Supabase à
// chaque requête, jamais répété ailleurs. Utilisé exclusivement par
// webApiShim.ts.
// ============================================================================

import { supabase } from "./supabaseClient";

const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

export class SessionExpireeError extends Error {
  constructor() {
    super("Votre session a expiré. Veuillez vous reconnecter.");
    this.name = "SessionExpireeError";
  }
}

async function recupererJeton(): Promise<string> {
  if (!supabase) throw new Error("Supabase non configuré (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY manquants).");
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new SessionExpireeError();
  return data.session.access_token;
}

async function appel(methode: string, chemin: string, body?: unknown) {
  const token = await recupererJeton();
  const res = await fetch(`${API_BASE}${chemin}`, {
    method: methode,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Session invalide/expirée détectée par le SERVEUR (pas seulement l'absence locale de jeton
  // ci-dessus) : jeton révoqué, compte désactivé entre-temps, etc. — refus propre, jamais une
  // erreur générique masquant la vraie cause.
  if (res.status === 401) throw new SessionExpireeError();

  let json: any = null;
  try { json = await res.json(); } catch { /* réponse vide (204), rien à faire */ }

  if (!res.ok) {
    throw new Error((json && json.error) || `Erreur serveur (${res.status}).`);
  }
  return json;
}

export const http = {
  get: (chemin: string) => appel("GET", chemin),
  post: (chemin: string, body?: unknown) => appel("POST", chemin, body),
  patch: (chemin: string, body?: unknown) => appel("PATCH", chemin, body),
  put: (chemin: string, body?: unknown) => appel("PUT", chemin, body),
  delete: (chemin: string, body?: unknown) => appel("DELETE", chemin, body),
};
