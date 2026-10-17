-- ============================================================================
-- TABLE profils — authentification et rôle métier.
--
-- id lié à auth.users(id) (Supabase Auth), jamais dupliqué (pas d'email ici —
-- inutile à la logique métier, évite toute divergence avec auth.users.email).
--
-- Protection Data API : automatique — server/db/lockdown-data-api.sql a déjà
-- appliqué ALTER DEFAULT PRIVILEGES ... REVOKE ALL ... FROM anon, authenticated
-- avant la création de cette table. Vérifié réellement (pas supposé) : une
-- table créée après ce script hérite de la restriction sans script
-- supplémentaire. Elle n'est donc, par construction, jamais lisible via la
-- Data API — uniquement via DATABASE_URL (le rôle postgres, hors RLS).
-- ============================================================================

CREATE TABLE IF NOT EXISTS profils (
  id UUID PRIMARY KEY REFERENCES auth.users(id),
  role TEXT NOT NULL DEFAULT 'utilisateur' CHECK (role IN ('administrateur', 'utilisateur')),
  actif BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE profils ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON profils FROM anon, authenticated;
