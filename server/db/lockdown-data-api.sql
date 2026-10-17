-- ============================================================================
-- VERROUILLAGE DE LA DATA API — defense en profondeur (RLS + revocation de droits).
-- Cible EXCLUSIVEMENT les 22 tables creees par server/db/schema.sql (verifie avant
-- generation de ce script). N'affecte jamais auth.*, storage.*, ni le role postgres
-- utilise par DATABASE_URL (connexion directe, hors PostgREST, RLS sans effet dessus).
-- ============================================================================
-- --- 1. RLS active, zero policy : verrouillage total via PostgREST ---
ALTER TABLE public.listes_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entreprise ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.parametres ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grilles_tailles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.grilles_tailles_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.declinaison_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.declinaison_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_declinaison_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_declinaison_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_variantes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.article_variante_valeurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planning_articles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.etapes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commandes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commande_lignes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.historique_transitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compteurs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.compteurs_bc_pf ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_pf ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bc_pf_lignes ENABLE ROW LEVEL SECURITY;
-- --- 2. Revocation explicite des droits deja accordes (defense en profondeur) ---
REVOKE ALL ON public.listes_valeurs FROM anon, authenticated;
REVOKE ALL ON public.entreprise FROM anon, authenticated;
REVOKE ALL ON public.parametres FROM anon, authenticated;
REVOKE ALL ON public.grilles_tailles FROM anon, authenticated;
REVOKE ALL ON public.grilles_tailles_valeurs FROM anon, authenticated;
REVOKE ALL ON public.declinaison_types FROM anon, authenticated;
REVOKE ALL ON public.declinaison_valeurs FROM anon, authenticated;
REVOKE ALL ON public.articles FROM anon, authenticated;
REVOKE ALL ON public.article_photos FROM anon, authenticated;
REVOKE ALL ON public.article_declinaison_types FROM anon, authenticated;
REVOKE ALL ON public.article_declinaison_valeurs FROM anon, authenticated;
REVOKE ALL ON public.article_variantes FROM anon, authenticated;
REVOKE ALL ON public.article_variante_valeurs FROM anon, authenticated;
REVOKE ALL ON public.planning_articles FROM anon, authenticated;
REVOKE ALL ON public.etapes FROM anon, authenticated;
REVOKE ALL ON public.commandes FROM anon, authenticated;
REVOKE ALL ON public.commande_lignes FROM anon, authenticated;
REVOKE ALL ON public.historique_transitions FROM anon, authenticated;
REVOKE ALL ON public.compteurs FROM anon, authenticated;
REVOKE ALL ON public.compteurs_bc_pf FROM anon, authenticated;
REVOKE ALL ON public.bc_pf FROM anon, authenticated;
REVOKE ALL ON public.bc_pf_lignes FROM anon, authenticated;
-- --- 3. Sequences associees (cohérence, meme si les REVOKE ci-dessus suffisent deja) ---
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- --- 4. Protection des futures tables (profils, et modules ulterieurs) ---
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;

-- --- 5. Verification apres execution : doit retourner 0 ligne ---
SELECT table_name, grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated');