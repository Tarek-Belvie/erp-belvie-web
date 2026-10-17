SELECT 'bc_pf.atelier_id' AS emplacement, atelier_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM bc_pf WHERE atelier_id IN (13,14,15,16,17,18) GROUP BY atelier_id
UNION ALL
SELECT 'articles.produit_id' AS emplacement, produit_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM articles WHERE produit_id IN (13,14,15,16,17,18) GROUP BY produit_id
UNION ALL
SELECT 'articles.saison_id' AS emplacement, saison_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM articles WHERE saison_id IN (13,14,15,16,17,18) GROUP BY saison_id
UNION ALL
SELECT 'articles.rayon_id' AS emplacement, rayon_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM articles WHERE rayon_id IN (13,14,15,16,17,18) GROUP BY rayon_id
UNION ALL
SELECT 'articles.categorie_id' AS emplacement, categorie_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM articles WHERE categorie_id IN (13,14,15,16,17,18) GROUP BY categorie_id
UNION ALL
SELECT 'commandes.atelier_id' AS emplacement, atelier_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE atelier_id IN (13,14,15,16,17,18) GROUP BY atelier_id
UNION ALL
SELECT 'commandes.bloquee_par_id' AS emplacement, bloquee_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE bloquee_par_id IN (13,14,15,16,17,18) GROUP BY bloquee_par_id
UNION ALL
SELECT 'commandes.debloquee_par_id' AS emplacement, debloquee_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE debloquee_par_id IN (13,14,15,16,17,18) GROUP BY debloquee_par_id
UNION ALL
SELECT 'commandes.valide_par_id' AS emplacement, valide_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE valide_par_id IN (13,14,15,16,17,18) GROUP BY valide_par_id
UNION ALL
SELECT 'commandes.lance_par_id' AS emplacement, lance_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE lance_par_id IN (13,14,15,16,17,18) GROUP BY lance_par_id
UNION ALL
SELECT 'commandes.controle_qualite_par_id' AS emplacement, controle_qualite_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE controle_qualite_par_id IN (13,14,15,16,17,18) GROUP BY controle_qualite_par_id
UNION ALL
SELECT 'commandes.terminee_par_id' AS emplacement, terminee_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE terminee_par_id IN (13,14,15,16,17,18) GROUP BY terminee_par_id
UNION ALL
SELECT 'commandes.annulee_par_id' AS emplacement, annulee_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE annulee_par_id IN (13,14,15,16,17,18) GROUP BY annulee_par_id
UNION ALL
SELECT 'commandes.archived_par_id' AS emplacement, archived_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE archived_par_id IN (13,14,15,16,17,18) GROUP BY archived_par_id
UNION ALL
SELECT 'commandes.desarchive_par_id' AS emplacement, desarchive_par_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commandes WHERE desarchive_par_id IN (13,14,15,16,17,18) GROUP BY desarchive_par_id
UNION ALL
SELECT 'historique_transitions.operateur_id' AS emplacement, operateur_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM historique_transitions WHERE operateur_id IN (13,14,15,16,17,18) GROUP BY operateur_id
UNION ALL
SELECT 'produit_grille_taille.produit_id' AS emplacement, produit_id AS id_utilise, COUNT(*) AS n, 'HORS WEB' AS perimetre FROM produit_grille_taille WHERE produit_id IN (13,14,15,16,17,18) GROUP BY produit_id
UNION ALL
SELECT 'commande_lignes.couleur_id' AS emplacement, couleur_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM commande_lignes WHERE couleur_id IN (13,14,15,16,17,18) GROUP BY couleur_id
UNION ALL
SELECT 'fiches_techniques.coupe_id' AS emplacement, coupe_id AS id_utilise, COUNT(*) AS n, 'HORS WEB' AS perimetre FROM fiches_techniques WHERE coupe_id IN (13,14,15,16,17,18) GROUP BY coupe_id
UNION ALL
SELECT 'modeles_mesures.produit_id' AS emplacement, produit_id AS id_utilise, COUNT(*) AS n, 'HORS WEB' AS perimetre FROM modeles_mesures WHERE produit_id IN (13,14,15,16,17,18) GROUP BY produit_id
UNION ALL
SELECT 'planning_articles.produit_id' AS emplacement, produit_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM planning_articles WHERE produit_id IN (13,14,15,16,17,18) GROUP BY produit_id
UNION ALL
SELECT 'planning_articles.rayon_id' AS emplacement, rayon_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM planning_articles WHERE rayon_id IN (13,14,15,16,17,18) GROUP BY rayon_id
UNION ALL
SELECT 'planning_articles.categorie_id' AS emplacement, categorie_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM planning_articles WHERE categorie_id IN (13,14,15,16,17,18) GROUP BY categorie_id
UNION ALL
SELECT 'planning_articles.saison_id' AS emplacement, saison_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM planning_articles WHERE saison_id IN (13,14,15,16,17,18) GROUP BY saison_id
UNION ALL
SELECT 'planning_articles.atelier_id' AS emplacement, atelier_id AS id_utilise, COUNT(*) AS n, 'web' AS perimetre FROM planning_articles WHERE atelier_id IN (13,14,15,16,17,18) GROUP BY atelier_id
ORDER BY id_utilise, emplacement;
