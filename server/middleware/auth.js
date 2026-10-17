// ============================================================================
// MIDDLEWARE D'AUTHENTIFICATION — une seule implémentation, jamais dupliquée
// dans chaque route (voir server/routes/*.js : toutes l'utilisent).
//
// Séquence exacte validée avant implémentation :
//   1. Vérifie le JWT Supabase (supabase.auth.getUser) — clé PUBLISHABLE
//      uniquement, jamais SECRET : cette vérification n'exige aucun privilège
//      élevé (confirmé avant implémentation).
//   2. Lit le profil correspondant dans `profils`, via DATABASE_URL (connexion
//      PostgreSQL directe, hors Data API — aucune clé Supabase nécessaire ici).
//   3. Vérifie `actif = true`.
//   4. Attache { id, email, role, actif } à req.user.
//   5. 401 si le JWT est invalide/absent ; 403 si le compte Auth existe mais
//      qu'aucun profil n'existe, ou que le profil est désactivé.
//
// verifierToken est injectable (paramètre optionnel) précisément pour pouvoir
// tester tout le reste de cette logique (lecture profils, contrôle actif,
// codes 401/403) sans dépendre d'un vrai jeton Supabase à chaque test.
// ============================================================================

const { createClient } = require("@supabase/supabase-js");
const { getAdapter } = require("../lib/db");

function creerClientSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY absentes des variables d'environnement.");
  }
  // Clé PUBLISHABLE uniquement — jamais SECRET ici, voir en-tête de fichier.
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
}

async function verifierTokenParDefaut(token) {
  const supabase = creerClientSupabase();
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return { id: data.user.id, email: data.user.email };
}

// Fabrique du middleware — permet d'injecter verifierToken et adapter pour les
// tests, tout en utilisant les implémentations réelles par défaut en production.
function creerMiddlewareAuth({ verifierToken = verifierTokenParDefaut, adapter } = {}) {
  return async function requireAuth(req, res, next) {
    try {
      const authHeader = req.headers.authorization || "";
      const match = authHeader.match(/^Bearer\s+(.+)$/i);
      if (!match) {
        return res.status(401).json({ error: "Authentification requise." });
      }
      const token = match[1];

      const utilisateur = await verifierToken(token);
      if (!utilisateur) {
        return res.status(401).json({ error: "Session invalide ou expirée." });
      }

      const db = adapter || getAdapter();
      const profil = await db.get("SELECT role, actif FROM profils WHERE id = ?", [utilisateur.id]);
      if (!profil) {
        return res.status(403).json({ error: "Aucun profil associé à ce compte. Contactez un administrateur." });
      }
      if (!profil.actif) {
        return res.status(403).json({ error: "Ce compte est désactivé." });
      }

      req.user = { id: utilisateur.id, email: utilisateur.email, role: profil.role, actif: profil.actif };
      next();
    } catch (err) {
      console.error("Erreur middleware auth :", err.message);
      res.status(500).json({ error: "Erreur d'authentification." });
    }
  };
}

// Réservé aux routes d'administration — utilise EXCLUSIVEMENT le rôle lu dans
// `profils` (req.user.role), jamais une métadonnée Supabase directe.
function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentification requise." });
  if (req.user.role !== "administrateur") {
    return res.status(403).json({ error: "Accès réservé aux administrateurs." });
  }
  next();
}

module.exports = { creerMiddlewareAuth, requireAdmin, verifierTokenParDefaut };
