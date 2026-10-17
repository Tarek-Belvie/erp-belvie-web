// ============================================================================
// Client Supabase côté navigateur — clé PUBLISHABLE uniquement (par
// conception, sans risque à exposer dans le bundle). Jamais la clé secrète,
// qui ne doit exister que côté serveur — voir server/middleware/auth.js.
// ============================================================================

import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

// createClient() lance une exception SYNCHRONE si l'URL n'est pas une URL HTTP/HTTPS valide —
// pas seulement si elle est absente. Sans ce try/catch, une valeur mal formée cassait tout le
// chargement du module avant même que main.tsx ait pu afficher son message d'erreur explicite.
export let supabase: ReturnType<typeof createClient> | null = null;
try {
  if (url && key) supabase = createClient(url, key);
} catch (err) {
  console.error("Configuration Supabase invalide (VITE_SUPABASE_URL doit être une URL complète, ex: https://xxxxx.supabase.co) :", err);
  supabase = null;
}

export function supabaseConfigured() {
  return supabase !== null;
}
