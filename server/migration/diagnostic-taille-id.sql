-- ===========================================================================
-- DIAGNOSTIC taille_id — LECTURE SEULE
-- A executer sur la base SQLite locale. Aucune ecriture, aucun ALTER.
--   sqlite3 "C:\...\belvie.db" ".read diagnostic-taille-id.sql"
-- ===========================================================================

-- --- A. La FK REELLE de la base, et non celle du fichier schema.sql ---------
-- CREATE TABLE IF NOT EXISTS ne reecrit jamais une table existante : la
-- definition ci-dessous peut differer de electron/db/schema.sql.
SELECT '--- A. Definition reelle de commande_lignes ---' AS section;
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'commande_lignes';

-- --- B. A quelle table appartient l'id 39 ? ---------------------------------
SELECT '--- B. Identification de l id 39 ---' AS section;
SELECT 'listes_valeurs' AS table_source, id, type, nom, actif
FROM listes_valeurs WHERE id = 39;

SELECT 'grilles_tailles_valeurs' AS table_source, gtv.id, gtv.valeur, gtv.ordre, g.nom AS grille
FROM grilles_tailles_valeurs gtv
LEFT JOIN grilles_tailles g ON g.id = gtv.grille_id
WHERE gtv.id = 39;

-- --- C. Volumetrie exacte de l incompatibilite -----------------------------
SELECT '--- C. Lignes concernees ---' AS section;
SELECT
  (SELECT COUNT(*) FROM commande_lignes)                                        AS lignes_total,
  (SELECT COUNT(*) FROM commande_lignes WHERE taille_id IS NULL)                AS taille_nulle,
  (SELECT COUNT(*) FROM commande_lignes cl
     JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id)                 AS deja_valides,
  (SELECT COUNT(*) FROM commande_lignes cl
     WHERE cl.taille_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id))
                                                                                AS orphelines_pg;

-- --- D. Detail des orphelines : id, libelle fige, commande, convertibilite --
-- taille_nom a ete fige AVANT tout remappage par migrate.js : c est la cle de
-- la conversion sans perte.
SELECT '--- D. Detail des orphelines ---' AS section;
SELECT
  cl.taille_id                                        AS ancien_id,
  cl.taille_nom                                       AS libelle_fige,
  lv.type                                             AS type_listes_valeurs,
  lv.nom                                              AS nom_listes_valeurs,
  COUNT(*)                                            AS nb_lignes,
  COUNT(DISTINCT cl.commande_id)                      AS nb_commandes,
  (SELECT COUNT(*) FROM grilles_tailles_valeurs gtv
     WHERE lower(gtv.valeur) = lower(cl.taille_nom))   AS correspondances_par_libelle
FROM commande_lignes cl
LEFT JOIN listes_valeurs lv ON lv.id = cl.taille_id
WHERE cl.taille_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)
GROUP BY cl.taille_id, cl.taille_nom, lv.type, lv.nom
ORDER BY nb_lignes DESC;

-- --- E. Les commandes touchees (reelles ou demo ?) --------------------------
SELECT '--- E. Commandes touchees ---' AS section;
SELECT DISTINCT c.id, c.numero, c.statut, c.est_demo, c.deleted_at
FROM commandes c
JOIN commande_lignes cl ON cl.commande_id = c.id
WHERE cl.taille_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)
ORDER BY c.id;

-- --- F. Cible de conversion disponible -------------------------------------
SELECT '--- F. Contenu de grilles_tailles_valeurs ---' AS section;
SELECT g.id AS grille_id, g.nom AS grille, COUNT(gtv.id) AS nb_valeurs,
       GROUP_CONCAT(gtv.valeur, ' / ') AS valeurs
FROM grilles_tailles g
LEFT JOIN grilles_tailles_valeurs gtv ON gtv.grille_id = g.id
GROUP BY g.id, g.nom ORDER BY g.id;

-- --- G. Verification croisee : le remappage a-t-il ete partiel ? -----------
-- Un ancien id present dans listes_valeurs type taille/pointure ET absent de
-- grilles_tailles_valeurs = ligne laissee en arriere par migrate.js.
SELECT '--- G. Anciens ids taille non remappes ---' AS section;
SELECT lv.id, lv.type, lv.nom, lv.actif,
       (SELECT COUNT(*) FROM commande_lignes cl WHERE cl.taille_id = lv.id) AS lignes_pointant_dessus
FROM listes_valeurs lv
WHERE lv.type IN ('taille', 'pointure')
ORDER BY lv.id;
