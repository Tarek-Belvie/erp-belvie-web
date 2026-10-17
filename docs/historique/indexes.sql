-- Index et trigger dépendant de colonnes qui peuvent ne pas exister sur une base ancienne
-- pas encore migrée. Ce fichier n'est exécuté qu'après la migration et la vérification des
-- colonnes (voir electron/db/index.js). Tout est IF NOT EXISTS : sans risque à ré-exécuter
-- à chaque démarrage.

CREATE INDEX IF NOT EXISTS idx_commandes_statut ON commandes(statut);
CREATE INDEX IF NOT EXISTS idx_commandes_bloquee ON commandes(bloquee);
CREATE INDEX IF NOT EXISTS idx_commandes_archived ON commandes(archived);
CREATE INDEX IF NOT EXISTS idx_commandes_deleted ON commandes(deleted_at);
CREATE INDEX IF NOT EXISTS idx_commandes_etape ON commandes(etape_id);
CREATE INDEX IF NOT EXISTS idx_commandes_article ON commandes(article_id);
CREATE INDEX IF NOT EXISTS idx_commandes_responsable ON commandes(responsable_nom);
CREATE INDEX IF NOT EXISTS idx_commandes_atelier ON commandes(atelier_id);
CREATE INDEX IF NOT EXISTS idx_listes_valeurs_type ON listes_valeurs(type, actif);
CREATE UNIQUE INDEX IF NOT EXISTS idx_listes_valeurs_code ON listes_valeurs(type, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_commande_lignes_commande ON commande_lignes(commande_id);
CREATE INDEX IF NOT EXISTS idx_commande_lignes_couleur ON commande_lignes(couleur_id);
CREATE INDEX IF NOT EXISTS idx_commande_lignes_taille ON commande_lignes(taille_id);
CREATE INDEX IF NOT EXISTS idx_articles_produit ON articles(produit_id);
CREATE INDEX IF NOT EXISTS idx_articles_saison ON articles(saison_id);
CREATE INDEX IF NOT EXISTS idx_articles_rayon ON articles(rayon_id);
CREATE INDEX IF NOT EXISTS idx_article_photos_article ON article_photos(article_id);
CREATE INDEX IF NOT EXISTS idx_historique_commande ON historique_transitions(commande_id, survenu_le);
-- Une même référence de production ne peut jamais être utilisée par deux commandes (que ce soit
-- la référence "nouveau" d'un article ou une référence de réassort déjà suffixée -R01, -R02...).
CREATE UNIQUE INDEX IF NOT EXISTS idx_commandes_reference_production ON commandes(reference_production) WHERE reference_production IS NOT NULL;
-- Deux réassorts du même article ne peuvent jamais porter le même numéro.
CREATE UNIQUE INDEX IF NOT EXISTS idx_commandes_reassort ON commandes(article_id, numero_reassort) WHERE type_production = 'reassort';

-- Historique minimal : updated_at se met à jour automatiquement à chaque modification.
-- (recursive_triggers est désactivé par défaut dans SQLite, pas de boucle infinie)
CREATE TRIGGER IF NOT EXISTS trg_commandes_updated_at
AFTER UPDATE ON commandes
FOR EACH ROW
BEGIN
  UPDATE commandes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_articles_updated_at
AFTER UPDATE ON articles
FOR EACH ROW
BEGIN
  UPDATE articles SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_entreprise_updated_at
AFTER UPDATE ON entreprise
FOR EACH ROW
BEGIN
  UPDATE entreprise SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_bc_pf_updated_at
AFTER UPDATE ON bc_pf
FOR EACH ROW
BEGIN
  UPDATE bc_pf SET updated_at = datetime('now') WHERE id = NEW.id;
END;

-- Un seul BC "actif" (ni remplacé, ni annulé) par commande + atelier. Les documents remplacés ou
-- annulés n'entrent pas dans ce calcul, ce qui permet à un remplacement de coexister avec
-- l'ancien document sans jamais le supprimer.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bc_pf_actif_unique
ON bc_pf(commande_id, atelier_id)
WHERE statut NOT IN ('remplace', 'annule');

CREATE TRIGGER IF NOT EXISTS trg_article_variantes_updated_at
AFTER UPDATE ON article_variantes
FOR EACH ROW
BEGIN
  UPDATE article_variantes SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE TRIGGER IF NOT EXISTS trg_fiches_techniques_updated_at
AFTER UPDATE ON fiches_techniques
FOR EACH ROW
BEGIN
  UPDATE fiches_techniques SET updated_at = datetime('now') WHERE id = NEW.id;
END;

CREATE INDEX IF NOT EXISTS idx_ft_croquis_fiche ON ft_croquis(fiche_id);
CREATE INDEX IF NOT EXISTS idx_ft_annotations_croquis ON ft_annotations(croquis_id);
CREATE INDEX IF NOT EXISTS idx_ft_mesures_valeurs_fiche ON ft_mesures_valeurs(fiche_id);
CREATE INDEX IF NOT EXISTS idx_ft_accessoires_fiche ON ft_accessoires(fiche_id);
CREATE INDEX IF NOT EXISTS idx_ft_tailles_fiche ON ft_tailles(fiche_id);
CREATE INDEX IF NOT EXISTS idx_modeles_mesures_lignes_modele ON modeles_mesures_lignes(modele_id);

-- Fiche technique / Matières. Les contraintes UNIQUE des tables filles
-- (ft_matiere_id, couleur_produit_id) et (ft_matiere_id, ft_taille_id) créent déjà leur propre
-- index, utilisable pour les recherches par ft_matiere_id ; il ne manque donc que l'accès par
-- fiche, celui qu'utilise get() à chaque ouverture d'une fiche technique.
CREATE INDEX IF NOT EXISTS idx_ft_matieres_fiche ON ft_matieres(fiche_id);
CREATE INDEX IF NOT EXISTS idx_matiere_couleurs_matiere ON matiere_couleurs(matiere_catalogue_id, actif);

-- Fiche technique / Fournitures. Les contraintes UNIQUE des deux tables de variantes créent déjà
-- leur index sur (ft_accessoire_id, ...) ; l'index par fiche existe déjà plus haut
-- (idx_ft_accessoires_fiche). Il ne manque que l'accès par famille, utilisé pour séparer
-- Habillage & Branding des Composants de confection à l'ouverture de l'onglet.
CREATE INDEX IF NOT EXISTS idx_ft_accessoires_famille ON ft_accessoires(fiche_id, famille, ordre);
CREATE INDEX IF NOT EXISTS idx_accessoires_catalogue_famille ON accessoires_catalogue(famille, actif);

-- Gradations : la clé étrangère garantit que la taille EXISTE, jamais qu'elle appartient à CETTE
-- fiche. Vérifié en test : sans ce trigger, une taille d'une autre fiche technique est acceptée.
-- Le contrôle est aussi fait côté applicatif (message lisible) ; ceci est le filet de sécurité,
-- actif même sur une écriture directe en base.
CREATE TRIGGER IF NOT EXISTS trg_ft_gradations_meme_fiche_insert
BEFORE INSERT ON ft_mesures_gradations
FOR EACH ROW
WHEN (SELECT fiche_id FROM ft_tailles WHERE id = NEW.taille_depart_id) <> NEW.fiche_id
  OR (SELECT fiche_id FROM ft_tailles WHERE id = NEW.taille_arrivee_id) <> NEW.fiche_id
BEGIN
  SELECT RAISE(ABORT, 'Gradation : les deux tailles doivent appartenir a cette fiche technique.');
END;

CREATE TRIGGER IF NOT EXISTS trg_ft_gradations_meme_fiche_update
BEFORE UPDATE ON ft_mesures_gradations
FOR EACH ROW
WHEN (SELECT fiche_id FROM ft_tailles WHERE id = NEW.taille_depart_id) <> NEW.fiche_id
  OR (SELECT fiche_id FROM ft_tailles WHERE id = NEW.taille_arrivee_id) <> NEW.fiche_id
BEGIN
  SELECT RAISE(ABORT, 'Gradation : les deux tailles doivent appartenir a cette fiche technique.');
END;

CREATE INDEX IF NOT EXISTS idx_ft_gradations_ligne ON ft_mesures_gradations(fiche_id, mesure_catalogue_id);

-- Un repère ne peut pas être utilisé deux fois DANS LA MÊME FICHE. Index PARTIEL : la clause
-- WHERE laisse coexister autant de lignes sans repère que nécessaire — le repère reste facultatif.
-- UPPER(TRIM(...)) rend le contrôle insensible à la casse et aux espaces : "A", "a" et " A " sont
-- le même repère. Un contrôle applicatif produit le message lisible ; ceci est le filet, actif
-- même sur une écriture directe en base.
-- Vérifié avant livraison par diagnostic-reperes.js : 0 conflit en fiches, 0 en modèles.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ft_mesures_repere_unique
ON ft_mesures_lignes(fiche_id, UPPER(TRIM(repere)))
WHERE repere IS NOT NULL AND TRIM(repere) <> '';
