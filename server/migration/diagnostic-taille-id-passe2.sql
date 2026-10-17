-- ===========================================================================
-- DIAGNOSTIC taille_id — PASSE 2, CORRIGEE. LECTURE SEULE.
--
-- La passe 1 comparait cl.taille_nom a grilles_tailles_valeurs.valeur. Comme
-- taille_nom est NULL sur les 289 lignes, toute comparaison rendait NULL et le
-- compteur valait 0 par construction. Ce 0 mesurait la nullite de taille_nom,
-- pas l'absence du libelle dans les grilles.
--
-- Le libelle historique n'est PAS perdu : il est toujours dans listes_valeurs,
-- accessible via cl.taille_id (39 = 'S', etc.). C'est cette jointure qui doit
-- servir de source, et non taille_nom.
--
--   sqlite3 "C:\...\belvie.db" ".read diagnostic-taille-id-passe2.sql"
-- ===========================================================================

-- --- H. Convertibilite REELLE, libelle resolu via listes_valeurs ------------
SELECT '--- H. Convertibilite par libelle resolu ---' AS section;
SELECT
  cl.taille_id                                   AS ancien_id,
  lv.nom                                         AS libelle_historique,
  lv.type                                        AS type_source,
  COUNT(*)                                       AS nb_lignes,
  COUNT(DISTINCT cl.commande_id)                 AS nb_commandes,
  (SELECT COUNT(*) FROM grilles_tailles_valeurs gtv
     WHERE lower(trim(gtv.valeur)) = lower(trim(lv.nom)))          AS nb_correspondances,
  (SELECT group_concat(gtv.id || '=' || gtv.valeur || ' (grille ' || gtv.grille_id || ')', ' | ')
     FROM grilles_tailles_valeurs gtv
     WHERE lower(trim(gtv.valeur)) = lower(trim(lv.nom)))          AS cibles_possibles
FROM commande_lignes cl
JOIN listes_valeurs lv ON lv.id = cl.taille_id
WHERE cl.taille_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)
GROUP BY cl.taille_id, lv.nom, lv.type
ORDER BY nb_lignes DESC;

-- --- I. Synthese de convertibilite ------------------------------------------
-- Objectif : verifier que orphelines_convertibles + orphelines_sans_cible = 289
SELECT '--- I. Synthese ---' AS section;
SELECT
  SUM(CASE WHEN c.n = 1 THEN c.lignes ELSE 0 END) AS convertibles_cible_unique,
  SUM(CASE WHEN c.n > 1 THEN c.lignes ELSE 0 END) AS ambigues_plusieurs_cibles,
  SUM(CASE WHEN c.n = 0 THEN c.lignes ELSE 0 END) AS sans_cible_a_creer,
  SUM(c.lignes)                                   AS total_orphelines
FROM (
  SELECT cl.taille_id, COUNT(*) AS lignes,
         (SELECT COUNT(*) FROM grilles_tailles_valeurs gtv
            WHERE lower(trim(gtv.valeur)) = lower(trim(lv.nom))) AS n
  FROM commande_lignes cl
  JOIN listes_valeurs lv ON lv.id = cl.taille_id
  WHERE cl.taille_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)
  GROUP BY cl.taille_id, lv.nom
) c;

-- --- J. Les 114 lignes deja valides : vers quelle grille pointent-elles ? ---
-- Determine s'il existe deja une grille "Vetements" utilisable comme cible.
SELECT '--- J. Grilles utilisees par les 114 lignes valides ---' AS section;
SELECT g.id AS grille_id, g.nom AS grille, COUNT(*) AS nb_lignes,
       group_concat(DISTINCT gtv.valeur) AS valeurs_utilisees
FROM commande_lignes cl
JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id
JOIN grilles_tailles g ON g.id = gtv.grille_id
GROUP BY g.id, g.nom;

-- --- K. Aucune ligne ne doit tomber hors des trois categories --------------
SELECT '--- K. Controle de couverture ---' AS section;
SELECT
  (SELECT COUNT(*) FROM commande_lignes)                                   AS total,
  (SELECT COUNT(*) FROM commande_lignes WHERE taille_id IS NULL)           AS sans_taille,
  (SELECT COUNT(*) FROM commande_lignes cl
     JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id)            AS deja_valides,
  (SELECT COUNT(*) FROM commande_lignes cl
     JOIN listes_valeurs lv ON lv.id = cl.taille_id
     WHERE NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id))
                                                                           AS orphelines_resolvables,
  (SELECT COUNT(*) FROM commande_lignes cl
     WHERE cl.taille_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)
       AND NOT EXISTS (SELECT 1 FROM listes_valeurs l WHERE l.id = cl.taille_id))
                                                                           AS orphelines_IRRECUPERABLES;

-- --- L. Collision d'identifiants : un ancien id peut viser une autre taille -
-- Verifie si un ancien id listes_valeurs existe AUSSI dans grilles_tailles_valeurs
-- avec un libelle DIFFERENT : ce serait une ligne actuellement mal affichee.
SELECT '--- L. Collisions d identifiants ---' AS section;
SELECT lv.id, lv.nom AS nom_ancien, gtv.valeur AS valeur_nouvelle,
       (SELECT COUNT(*) FROM commande_lignes cl WHERE cl.taille_id = lv.id) AS lignes
FROM listes_valeurs lv
JOIN grilles_tailles_valeurs gtv ON gtv.id = lv.id
WHERE lv.type IN ('taille','pointure')
  AND lower(trim(lv.nom)) <> lower(trim(gtv.valeur));

-- --- M. BC PF : les lignes figees dependent-elles de taille_id ? ------------
SELECT '--- M. bc_pf_lignes ---' AS section;
SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bc_pf_lignes';
