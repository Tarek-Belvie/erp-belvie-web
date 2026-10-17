-- ===========================================================================
-- DIAGNOSTIC PHOTOS — LECTURE SEULE. Aucune écriture, aucun upload.
-- Deux blocs : A sur SQLite local, B sur PostgreSQL/Supabase.
-- ===========================================================================

-- ###########################################################################
-- BLOC A — SQLite local
--   sqlite3 "C:\...\belvie.db" ".read diagnostic-photos.sql"
-- ###########################################################################

SELECT '--- A1. Structure réelle de article_photos ---' AS section;
-- Confirme l'absence de toute colonne blob/URL : seuls des chemins texte.
SELECT sql FROM sqlite_master WHERE type='table' AND name='article_photos';

SELECT '--- A2. Les 19 lignes, contenu intégral ---' AS section;
SELECT ap.id, ap.article_id, a.reference_principale,
       ap.photo_path, ap.photo_thumb_path, ap.est_principale, ap.ordre,
       length(ap.photo_path) AS longueur_chemin,
       CASE
         WHEN ap.photo_path LIKE '_:\%' ESCAPE '\' THEN 'ABSOLU Windows'
         WHEN ap.photo_path LIKE '/%'              THEN 'ABSOLU Unix'
         WHEN ap.photo_path LIKE 'http%'           THEN 'URL'
         WHEN ap.photo_path LIKE 'data:%'          THEN 'DATA URL'
         ELSE 'RELATIF'
       END AS nature_chemin
FROM article_photos ap
LEFT JOIN articles a ON a.id = ap.article_id
ORDER BY ap.id;

SELECT '--- A3. Synthèse par nature de chemin ---' AS section;
SELECT CASE
         WHEN photo_path LIKE '_:\%' ESCAPE '\' THEN 'ABSOLU Windows'
         WHEN photo_path LIKE '/%'              THEN 'ABSOLU Unix'
         WHEN photo_path LIKE 'http%'           THEN 'URL'
         ELSE 'RELATIF'
       END AS nature, COUNT(*) AS n
FROM article_photos GROUP BY nature;

SELECT '--- A4. Miniature distincte de l''original ? ---' AS section;
-- photo_thumb_path = photo_path signale un échec de génération sharp (repli).
SELECT COUNT(*) AS total,
       SUM(CASE WHEN photo_thumb_path = photo_path THEN 1 ELSE 0 END) AS sans_miniature_propre,
       SUM(CASE WHEN photo_thumb_path IS NULL THEN 1 ELSE 0 END)      AS thumb_null
FROM article_photos;

SELECT '--- A5. Autres colonnes portant des chemins de fichiers ---' AS section;
SELECT 'planning_articles' AS t, COUNT(*) AS n FROM planning_articles WHERE photo_path IS NOT NULL
UNION ALL SELECT 'entreprise.logo_path', COUNT(*) FROM entreprise WHERE logo_path IS NOT NULL
UNION ALL SELECT 'bc_pf.photo_snapshot_path', COUNT(*) FROM bc_pf WHERE photo_snapshot_path IS NOT NULL
UNION ALL SELECT 'bc_pf.entreprise_logo_snapshot_path', COUNT(*) FROM bc_pf WHERE entreprise_logo_snapshot_path IS NOT NULL;

-- ###########################################################################
-- BLOC B — PostgreSQL / Supabase (SQL Editor)
-- ###########################################################################

-- SELECT '--- B1. Les 19 lignes migrées ---' AS section;
-- SELECT ap.id, ap.article_id, a.reference_principale,
--        ap.photo_path, ap.photo_thumb_path, ap.est_principale, ap.ordre
-- FROM article_photos ap
-- LEFT JOIN articles a ON a.id = ap.article_id
-- ORDER BY ap.id;

-- SELECT '--- B2. Comptage et cohérence ---' AS section;
-- SELECT COUNT(*) AS total,
--        COUNT(*) FILTER (WHERE photo_path LIKE 'images/%')    AS chemins_relatifs,
--        COUNT(*) FILTER (WHERE photo_path ~ '^[A-Za-z]:\\')   AS absolus_windows,
--        COUNT(*) FILTER (WHERE photo_path LIKE 'http%')       AS urls,
--        COUNT(DISTINCT article_id)                            AS articles_concernes
-- FROM article_photos;

-- SELECT '--- B3. Comparaison ligne à ligne avec SQLite ---' AS section;
-- Exécuter A2 et B1, comparer id / photo_path : ils doivent être identiques,
-- la migration ayant conservé les identifiants et copié les colonnes telles quelles.
