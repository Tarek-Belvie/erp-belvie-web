-- ============================================================================
-- SCHEMA POSTGRESQL DE TEST — Phase 0 uniquement.
--
-- Perimetre : UNIQUEMENT les tables necessaires aux modules valides pour la
-- migration web (Articles, Planification, Commandes en production,
-- Fabrication), plus deux tables minimales de dependance technique
-- temporaire vers Parametres (entreprise, parametres) — voir
-- shared/parametres-bridge.js.
--
-- EXCLUS explicitement de ce schema (modules non encore valides pour la
-- migration) : Finance, Fiche technique, le reste de Parametres.
--
-- Deux ajustements par rapport a electron/db/schema.sql, valides
-- explicitement avant execution :
--   1. listes_valeurs.fournisseur_id retiree (dependance vers la table
--      fournisseurs, module Finance, exclu de ce perimetre).
--
--      IMPORTANT — a ne pas oublier quand Finance rejoindra la migration :
--      ce schema est VOLONTAIREMENT PARTIEL, pas le schema complet de l'ERP.
--      Quand Finance sera integre, listes_valeurs.fournisseur_id devra etre
--      reintroduite via une VRAIE MIGRATION PostgreSQL (ALTER TABLE ... ADD
--      COLUMN ... REFERENCES fournisseurs(id)), sur la base existante avec
--      ses donnees — jamais en recreant la base depuis ce fichier.
--   2. grilles_tailles / grilles_tailles_valeurs ajoutees (necessaires a
--      commande_lignes.taille_id, omises par erreur dans le premier
--      perimetre propose, corrigees avant execution).
--
-- Traduction MECANIQUE de la syntaxe SQLite -> PostgreSQL uniquement
-- (SERIAL, casts de types). Aucune logique metier modifiee. L'adaptation
-- fonctionnelle complete (Phase 1) n'est pas commencee ici.
--
-- Base vide, aucune donnee reelle. Cree et execute contre une base de test
-- locale pour verifier que le schema s'installe reellement sans erreur.
-- ============================================================================

CREATE TABLE IF NOT EXISTS listes_valeurs (
  id SERIAL PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier','taille','saison','rayon','operateur','coupe','pointure','categorie')),
  nom TEXT COLLATE "C" NOT NULL,     -- COLLATE "C" (comparaison brute par valeur de caractère,
                                      -- sans intelligence linguistique) — nécessaire pour que
                                      -- ORDER BY LOWER(nom) donne EXACTEMENT le même ordre qu'en
                                      -- SQLite (dont la collation par défaut est également une
                                      -- comparaison brute). Sans ce réglage, PostgreSQL utilise sa
                                      -- collation par défaut (souvent locale-consciente), qui trie
                                      -- les caractères accentués différemment — divergence
                                      -- confirmée et testée précisément avant cette correction.
  nom_normalise TEXT NOT NULL,       -- nom en minuscules/espaces nettoyés, pour détecter les doublons
  code TEXT,                         -- toujours en MAJUSCULES ; NULL sauf pour saison/rayon
  ordre INTEGER,                     -- NULL = non pertinent pour ce type (tri alphabétique)
  responsable_nom TEXT,              -- texte libre, utilisé uniquement pour type='atelier' : le
                                      -- responsable par défaut de cet atelier, sans liste dédiée
  actif INTEGER NOT NULL DEFAULT 1,  -- 0 = n'apparaît plus dans les nouvelles commandes, historique conservé
  created_at TEXT NOT NULL DEFAULT (NOW())::text,
  UNIQUE(type, nom_normalise)
);

CREATE TABLE IF NOT EXISTS entreprise (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  nom_commercial TEXT,
  raison_sociale TEXT,
  matricule_fiscal TEXT,
  registre_commerce TEXT,
  identifiant_tva TEXT,
  adresse TEXT,
  ville TEXT,
  code_postal TEXT,
  pays TEXT,
  telephone TEXT,
  email TEXT,
  site_web TEXT,
  banque TEXT,
  agence_bancaire TEXT,
  rib TEXT,
  swift_bic TEXT,
  taux_tva_defaut REAL,         -- Paramètres fiscaux : préremplit automatiquement les nouvelles
                                 -- lignes Finance (jamais imposé, jamais rétroactif — chaque ligne
                                 -- déjà créée conserve le taux qui était en vigueur à sa création)
  logo_path TEXT,               -- copie interne gérée par l'application (jamais le chemin d'origine)
  created_at TEXT NOT NULL DEFAULT (NOW())::text,
  updated_at TEXT NOT NULL DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS parametres (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);

CREATE TABLE IF NOT EXISTS grilles_tailles (
  id SERIAL PRIMARY KEY,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS grilles_tailles_valeurs (
  id SERIAL PRIMARY KEY,
  grille_id INTEGER NOT NULL REFERENCES grilles_tailles(id) ON DELETE CASCADE,
  valeur TEXT NOT NULL,
  valeur_normalisee TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,
  UNIQUE(grille_id, valeur_normalisee)
);

CREATE TABLE IF NOT EXISTS declinaison_types (
  id SERIAL PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,           -- généré automatiquement, stable, jamais modifié après création
  nom TEXT COLLATE "C" NOT NULL,       -- COLLATE "C" : ORDER BY ordre, nom (listTypes) sans LOWER()
                                        -- ni COLLATE explicite dans shared/declinaisons.js est
                                        -- casse-sensible par défaut sur SQLite (référence) — sans
                                        -- ce réglage, PostgreSQL trierait différemment (confirmé
                                        -- avec collation type Supabase avant cette correction).
  nom_normalise TEXT NOT NULL UNIQUE,
  affichage_couleur INTEGER NOT NULL DEFAULT 0, -- propriété générique ("ce type peut afficher un sélecteur de couleur"), jamais liée au code 'couleur' en dur
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS declinaison_valeurs (
  id SERIAL PRIMARY KEY,
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  valeur TEXT COLLATE "C" NOT NULL,    -- même raison que declinaison_types.nom ci-dessus, pour
                                        -- ORDER BY ordre, valeur (listValeurs).
  valeur_normalisee TEXT NOT NULL,
  couleur_hex TEXT,                    -- uniquement pertinent pour le type Couleur ; toujours nullable ailleurs
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW())::text,
  UNIQUE(declinaison_type_id, valeur_normalisee)
);

CREATE TABLE IF NOT EXISTS articles (
  id SERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  produit_id INTEGER REFERENCES listes_valeurs(id),  -- nullable : un article peut exister sans
                                                          -- type de produit assigné (ex: converti
                                                          -- depuis Planification sans cette info),
                                                          -- à compléter plus tard si besoin
  saison_id INTEGER REFERENCES listes_valeurs(id),
  annee_collection INTEGER,                    -- entier 4 chiffres, ex: 2026
  rayon_id INTEGER REFERENCES listes_valeurs(id),
  categorie_id INTEGER REFERENCES listes_valeurs(id),  -- ajoutée progressivement ; référentiel déjà
                                                          -- existant (Paramètres → Catalogue produit),
                                                          -- jamais utilisé sur l'article jusqu'ici
  prix_vente_envisage REAL,                    -- simulation Finance : marge/taux/prix plancher se
                                                -- calculent à partir de ce prix et du coût (prévi/réel),
                                                -- jamais stockés eux-mêmes
  abreviation TEXT,                            -- 2 à 5 lettres majuscules, ex: JEA
  numero_sequentiel INTEGER,                   -- calculé automatiquement à la génération
  reference_principale TEXT UNIQUE,            -- ex: FW26-M-JEA-01 ; générée une fois, jamais réécrite
  est_demo INTEGER NOT NULL DEFAULT 0,         -- 1 = article de démonstration, supprimable avec les commandes de démo
  created_at TEXT NOT NULL DEFAULT (NOW())::text,
  updated_at TEXT NOT NULL DEFAULT (NOW())::text,
  CHECK (abreviation IS NULL OR (abreviation = UPPER(abreviation) AND LENGTH(abreviation) BETWEEN 2 AND 5))
);

CREATE TABLE IF NOT EXISTS article_photos (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  photo_thumb_path TEXT NOT NULL,
  est_principale INTEGER NOT NULL DEFAULT 0,
  ordre INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS article_declinaison_types (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  ordre INTEGER DEFAULT 0,
  UNIQUE(article_id, declinaison_type_id)
);

CREATE TABLE IF NOT EXISTS article_declinaison_valeurs (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  declinaison_valeur_id INTEGER NOT NULL REFERENCES declinaison_valeurs(id),
  UNIQUE(article_id, declinaison_type_id, declinaison_valeur_id)
);

CREATE TABLE IF NOT EXISTS article_variantes (
  id SERIAL PRIMARY KEY,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  sku TEXT,
  code_barres TEXT,
  reference_interne TEXT,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW())::text,
  updated_at TEXT DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS article_variante_valeurs (
  id SERIAL PRIMARY KEY,
  article_variante_id INTEGER NOT NULL REFERENCES article_variantes(id) ON DELETE CASCADE,
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  declinaison_valeur_id INTEGER NOT NULL REFERENCES declinaison_valeurs(id),
  UNIQUE(article_variante_id, declinaison_type_id)
);

CREATE TABLE IF NOT EXISTS planning_articles (
  id SERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  article_id INTEGER REFERENCES articles(id),   -- NULL tant que l'article n'existe qu'à l'état d'idée
  nom_provisoire TEXT,                          -- utilisé si article_id est NULL
  reference_provisoire TEXT,                    -- abréviation provisoire (2-5 lettres majuscules) —
                                                 -- sert à générer automatiquement la vraie référence
                                                 -- lors de la conversion en produit, sans ressaisie
  produit_id INTEGER REFERENCES listes_valeurs(id),  -- type de produit envisagé, capturé dès la
                                                 -- planification pour rendre la conversion automatique
  rayon_id INTEGER REFERENCES listes_valeurs(id),
  photo_path TEXT,
  photo_thumb_path TEXT,
  categorie_id INTEGER REFERENCES listes_valeurs(id),
  saison_id INTEGER REFERENCES listes_valeurs(id),
  annee_collection INTEGER,                     -- même logique que articles.annee_collection
  mois_prevu TEXT,                              -- ancien champ unique, conservé pour compatibilité
                                                 -- mais plus jamais lu par l'application depuis la
                                                 -- séparation ci-dessous ; toujours écrit en miroir
                                                 -- de la production, pour ne rien casser côté anciennes
                                                 -- bases où la colonne était NOT NULL
  mois_prevu_production TEXT NOT NULL,          -- format 'AAAA-MM' — quand l'article doit être produit
  mois_prevu_reception TEXT,                    -- format 'AAAA-MM', nullable — quand il doit être
                                                 -- reçu ; indépendant de la production, jamais déduit
  quantite_previsionnelle INTEGER,
  coloris_previsionnels TEXT,                   -- noms séparés par virgule, ex: "Noir,Marine,Beige" —
                                                 -- volontairement indépendant des déclinaisons produit
  statut TEXT NOT NULL DEFAULT 'idee' CHECK (statut IN (
    'idee', 'a_etudier', 'prototype', 'echantillon', 'a_modifier', 'valide',
    'a_produire', 'en_production', 'production_terminee', 'shooting_a_preparer',
    'pret_au_lancement', 'lance', 'annule'
  )),
  atelier_id INTEGER REFERENCES listes_valeurs(id),
  notes TEXT,
  ordre INTEGER NOT NULL DEFAULT 0,             -- ordre manuel à l'intérieur d'un même mois
  produit_cree_le TEXT,                         -- horodatage de la conversion en produit ERP réel
  archived INTEGER NOT NULL DEFAULT 0,          -- "Retirer du planning" sans supprimer si lié à un vrai produit
  created_at TEXT NOT NULL DEFAULT (NOW())::text,
  updated_at TEXT NOT NULL DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS etapes (
  id SERIAL PRIMARY KEY,
  cle TEXT NOT NULL UNIQUE,          -- identifiant stable, ex: "coupe" (ne pas afficher)
  libelle TEXT NOT NULL,             -- texte affiché, modifiable librement
  pourcentage INTEGER NOT NULL DEFAULT 0,  -- avancement associé (non utilisé actuellement, réservé)
  ordre INTEGER NOT NULL,            -- position dans le flux de production
  optionnelle INTEGER NOT NULL DEFAULT 0,  -- 1 = peut être ignorée (ex: broderie/impression)
  actif INTEGER NOT NULL DEFAULT 1   -- 0 = masquée des nouvelles commandes, conservée pour l'historique
);

CREATE TABLE IF NOT EXISTS commandes (
  id SERIAL PRIMARY KEY,       -- identifiant technique interne (usage futur inter-modules)
  uuid TEXT NOT NULL UNIQUE,                  -- identifiant global stable (sauvegardes, exports, futur réseau)
  numero TEXT UNIQUE,                         -- numéro OFFICIEL, attribué à la validation seulement (NULL en brouillon)
  article_id INTEGER NOT NULL REFERENCES articles(id),
  type_production TEXT NOT NULL DEFAULT 'nouveau' CHECK (type_production IN ('nouveau','reassort')),
  numero_reassort INTEGER,                    -- NULL sauf si type_production = 'reassort'
  reference_production TEXT,                  -- référence article, ou article-R01/-R02... pour un réassort
  responsable_nom TEXT NOT NULL,               -- texte libre — pas de liste dédiée des responsables ;
                                                -- suggéré depuis le responsable de l'atelier choisi,
                                                -- mais librement modifiable par commande
  atelier_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
  quantite_totale INTEGER NOT NULL DEFAULT 0, -- somme des lignes (commande_lignes) ; jamais saisie directement
  date_lancement TEXT NOT NULL,               -- ISO 8601 (YYYY-MM-DD)
  date_fin_prevue TEXT NOT NULL,
  etape_id INTEGER NOT NULL REFERENCES etapes(id),
  statut TEXT NOT NULL DEFAULT 'brouillon'
    CHECK (statut IN ('brouillon','validee','en_production','controle_qualite','terminee','annulee')),
  priorite TEXT NOT NULL DEFAULT 'normale'
    CHECK (priorite IN ('haute','normale','faible')),
  -- Bloquée est un indicateur séparé du statut (une commande En production peut être bloquée).
  bloquee INTEGER NOT NULL DEFAULT 0,
  blocage_motif TEXT,
  bloquee_le TEXT, bloquee_par_id INTEGER REFERENCES listes_valeurs(id),
  debloquee_le TEXT, debloquee_par_id INTEGER REFERENCES listes_valeurs(id),
  -- Horodatage + opérateur de chaque transition officielle (doublé par historique_transitions,
  -- qui conserve tout l'historique ; ces colonnes ne gardent que le DERNIER événement de chaque type).
  valide_le TEXT, valide_par_id INTEGER REFERENCES listes_valeurs(id),
  lance_le TEXT, lance_par_id INTEGER REFERENCES listes_valeurs(id),
  controle_qualite_le TEXT, controle_qualite_par_id INTEGER REFERENCES listes_valeurs(id),
  terminee_le TEXT, terminee_par_id INTEGER REFERENCES listes_valeurs(id),
  annulee_le TEXT, annulee_par_id INTEGER REFERENCES listes_valeurs(id), annulation_motif TEXT,
  archived_le TEXT, archived_par_id INTEGER REFERENCES listes_valeurs(id),
  desarchive_le TEXT, desarchive_par_id INTEGER REFERENCES listes_valeurs(id),
  commentaires TEXT,
  archived INTEGER NOT NULL DEFAULT 0,        -- 1 = archivée (conservée, hors vues actives)
  est_demo INTEGER NOT NULL DEFAULT 0,        -- 1 = donnée de démonstration, supprimable en un clic
  deleted_at TEXT,                            -- suppression douce, réservée aux brouillons (voir commandes.js)
  created_at TEXT NOT NULL DEFAULT (NOW())::text,
  updated_at TEXT NOT NULL DEFAULT (NOW())::text,
  -- La date limite de production ne peut pas précéder la date de lancement.
  CHECK (date_fin_prevue >= date_lancement),
  -- Le motif du blocage est obligatoire uniquement lorsque l'indicateur "bloquée" est actif.
  CHECK (bloquee = 0 OR (blocage_motif IS NOT NULL AND TRIM(blocage_motif) <> ''))
);

CREATE TABLE IF NOT EXISTS commande_lignes (
  id SERIAL PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  couleur_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
  reference_libre TEXT,     -- saisie librement à la création de la commande, propre à cette
                             -- couleur POUR cette commande (pas une propriété globale de la
                             -- couleur elle-même) — aucun choix prédéfini, aucune liste déroulante
  taille_id INTEGER REFERENCES grilles_tailles_valeurs(id),
  taille_nom TEXT,          -- copie figée du libellé au moment de la saisie : reste correct à
                             -- l'affichage même si la valeur de taille est ensuite désactivée,
                             -- renommée ou retirée de sa grille.
  quantite INTEGER NOT NULL CHECK (quantite > 0)
);

CREATE TABLE IF NOT EXISTS historique_transitions (
  id SERIAL PRIMARY KEY,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  type_evenement TEXT NOT NULL CHECK (type_evenement IN (
    'validation', 'lancement', 'entree_controle_qualite', 'fin_production',
    'annulation', 'blocage', 'deblocage', 'archivage', 'desarchivage'
  )),
  operateur_id INTEGER REFERENCES listes_valeurs(id),
  motif TEXT,
  survenu_le TEXT NOT NULL DEFAULT (NOW())::text
);

CREATE TABLE IF NOT EXISTS compteurs (
  annee INTEGER PRIMARY KEY,
  dernier_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS compteurs_bc_pf (
  annee INTEGER PRIMARY KEY,
  dernier_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bc_pf (
  id SERIAL PRIMARY KEY,
  uuid TEXT NOT NULL UNIQUE,
  numero TEXT NOT NULL UNIQUE,                 -- PF-AAAA-XXXX, un numéro par document, jamais réutilisé
  commande_id INTEGER NOT NULL REFERENCES commandes(id),
  atelier_id INTEGER REFERENCES listes_valeurs(id),

  statut TEXT NOT NULL DEFAULT 'brouillon',    -- brouillon | valide | lance | remplace | annule
  remplace_bc_pf_id INTEGER REFERENCES bc_pf(id),  -- l'ancien document que celui-ci remplace, le cas échéant
  motif_remplacement TEXT,

  commande_numero TEXT, article_nom TEXT, article_reference TEXT, type_production TEXT,
  atelier_nom TEXT, saison_nom TEXT, responsable_nom TEXT, date_limite_production TEXT, priorite TEXT,
  photo_snapshot_path TEXT,

  entreprise_nom_commercial TEXT, entreprise_raison_sociale TEXT, entreprise_matricule_fiscal TEXT,
  entreprise_registre_commerce TEXT, entreprise_adresse TEXT, entreprise_telephone TEXT,
  entreprise_email TEXT, entreprise_banque TEXT, entreprise_agence_bancaire TEXT, entreprise_rib TEXT,
  entreprise_logo_snapshot_path TEXT,

  notes_atelier TEXT,
  observations_internes TEXT,

  commande_synced_at TEXT,                     -- dernière synchronisation réelle depuis la commande (distinct de updated_at, qui bouge aussi sur une simple note)
  created_at TEXT NOT NULL DEFAULT (NOW())::text,
  updated_at TEXT NOT NULL DEFAULT (NOW())::text,
  validated_at TEXT,
  launched_at TEXT
);

CREATE TABLE IF NOT EXISTS bc_pf_lignes (
  id SERIAL PRIMARY KEY,
  bc_pf_id INTEGER NOT NULL REFERENCES bc_pf(id) ON DELETE CASCADE,
  couleur_nom TEXT NOT NULL,
  couleur_reference TEXT,            -- capturée au même titre que couleur_nom : reflète la Réf de
                                      -- la couleur au moment de la création/synchronisation du BC,
                                      -- ne change pas rétroactivement si la Réf change ensuite
  taille_nom TEXT,
  quantite INTEGER NOT NULL
);

