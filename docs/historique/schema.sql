-- Schéma Belvie ERP - module Commandes de production
-- Chaque futur module (Stock, Qualité, Planning...) référencera une commande ou un article
-- via leur colonne "id" (clé technique interne), jamais via "numero" ou "reference_production".
--
-- Ce fichier ne contient QUE des définitions de table (idempotentes, sans risque sur une base
-- existante). Les index et le trigger, qui dépendent de colonnes potentiellement absentes sur une
-- ancienne base non encore migrée, sont dans indexes.sql et exécutés après la migration.

CREATE TABLE IF NOT EXISTS etapes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cle TEXT NOT NULL UNIQUE,          -- identifiant stable, ex: "coupe" (ne pas afficher)
  libelle TEXT NOT NULL,             -- texte affiché, modifiable librement
  pourcentage INTEGER NOT NULL DEFAULT 0,  -- avancement associé (non utilisé actuellement, réservé)
  ordre INTEGER NOT NULL,            -- position dans le flux de production
  optionnelle INTEGER NOT NULL DEFAULT 0,  -- 1 = peut être ignorée (ex: broderie/impression)
  actif INTEGER NOT NULL DEFAULT 1   -- 0 = masquée des nouvelles commandes, conservée pour l'historique
);

-- Listes administrables communes : produits, couleurs, responsables, ateliers, tailles,
-- saisons, rayons, opérateurs. Une seule table générique plutôt que huit tables identiques.
-- "ordre" n'est utilisé que par les types qui en ont besoin (tailles, saisons, rayons).
-- "code" n'est utilisé que par saisons et rayons (code court unique par type, ex: FW, SU, M, W).
CREATE TABLE IF NOT EXISTS listes_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier','taille','saison','rayon','operateur','coupe','pointure','categorie')),
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL,       -- nom en minuscules/espaces nettoyés, pour détecter les doublons
  code TEXT,                         -- toujours en MAJUSCULES ; NULL sauf pour saison/rayon
  ordre INTEGER,                     -- NULL = non pertinent pour ce type (tri alphabétique)
  responsable_nom TEXT,              -- texte libre, utilisé uniquement pour type='atelier' : le
                                      -- responsable par défaut de cet atelier, sans liste dédiée
  fournisseur_id INTEGER REFERENCES fournisseurs(id),  -- utilisé uniquement pour type='atelier',
                                      -- optionnel : renseigné seulement si cet atelier doit être
                                      -- payé (module Finance) — la notion opérationnelle d'atelier
                                      -- reste inchangée, aucun impact sur le reste de la production
  actif INTEGER NOT NULL DEFAULT 1,  -- 0 = n'apparaît plus dans les nouvelles commandes, historique conservé
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(type, nom_normalise)
);

CREATE TABLE IF NOT EXISTS compteurs (
  annee INTEGER PRIMARY KEY,
  dernier_numero INTEGER NOT NULL DEFAULT 0
);

-- Table clé/valeur générique. Utilisée notamment pour 'operateur_actif_id'
-- (l'opérateur actif sur ce poste, voir electron/ipc/parametres.js).
CREATE TABLE IF NOT EXISTS parametres (
  cle TEXT PRIMARY KEY,
  valeur TEXT
);

-- Informations de l'entreprise : une seule ligne (id=1 imposé par le CHECK), jamais une liste.
-- Réutilisées automatiquement par les futurs documents (BC PF, BC MP, factures, bons de
-- livraison, PDF). "Complet" n'est jamais stocké ici : c'est calculé à l'affichage, différemment
-- selon le document concerné (voir src/shared/entrepriseRequirements.ts), pour ne jamais avoir
-- deux sources de vérité qui pourraient diverger.
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Bon de Commande Produits Finis (BC PF) : un seul par commande (contrainte UNIQUE), créé
-- automatiquement à la validation. Volontairement "autonome" : les champs commande_numero,
-- article_nom, article_reference, type_production, atelier_nom et saison_nom sont des COPIES
-- figées au moment de la création, pas des jointures vivantes — le document reste identique même
-- si la fiche article ou les référentiels évoluent des années plus tard. Seules les quantités
-- (commande_lignes) restent lues en direct depuis la commande, car déjà verrouillées de façon
-- permanente dès la validation (règle déjà en place, jamais modifiée).
-- Bon de Commande Produits Finis (BC PF) : structure à deux niveaux.
-- "bc_pf" est le dossier logique (un par commande+atelier, jamais recréé). "bc_pf_versions" sont
-- les éditions successives, chacune avec son PROPRE statut (brouillon/valide/lance/annule) et son
-- propre snapshot complet (article, entreprise, prix) : une version validée ou lancée est figée
-- pour toujours, y compris si l'entreprise ou l'article changent ensuite. "statut_courant" sur la
-- table logique n'est qu'un raccourci d'affichage ; la source de vérité reste chaque version.
CREATE TABLE IF NOT EXISTS compteurs_bc_pf (
  annee INTEGER PRIMARY KEY,
  dernier_numero INTEGER NOT NULL DEFAULT 0
);

-- Bon de Commande Produits Finis (BC PF) : UN document = UNE ligne, entièrement figée dès sa
-- création (aucun concept de "version" : correspond à l'organisation réelle de l'atelier, qui
-- envoie un nouveau BC papier plutôt que de corriger l'existant). Statut : brouillon (modifiable,
-- se met à jour en place depuis la commande) | valide | lance | remplace | annule. Quand un
-- nouveau BC doit remplacer un ancien déjà lancé, "remplace_bc_pf_id" garde le lien vers
-- l'ancien, dont le statut passe alors à 'remplace' — jamais supprimé.
CREATE TABLE IF NOT EXISTS compteurs_bc_pf (
  annee INTEGER PRIMARY KEY,
  dernier_numero INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS bc_pf (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  validated_at TEXT,
  launched_at TEXT
);

-- Répartition propre à CE document (pas de notion de version : figée dès la création du BC).
CREATE TABLE IF NOT EXISTS bc_pf_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bc_pf_id INTEGER NOT NULL REFERENCES bc_pf(id) ON DELETE CASCADE,
  couleur_nom TEXT NOT NULL,
  couleur_reference TEXT,            -- capturée au même titre que couleur_nom : reflète la Réf de
                                      -- la couleur au moment de la création/synchronisation du BC,
                                      -- ne change pas rétroactivement si la Réf change ensuite
  taille_nom TEXT,
  quantite INTEGER NOT NULL
);

-- Déclinaisons génériques (Phase 1 : module autonome, n'affecte rien de l'existant — commandes,
-- BC PF et le wizard continuent d'utiliser couleur/taille exactement comme avant). Permet de
-- gérer n'importe quel type d'axe de variation (couleur, taille, pointure, tour de taille...)
-- sans jamais coder une logique spécifique à un type précis.
CREATE TABLE IF NOT EXISTS declinaison_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,           -- généré automatiquement, stable, jamais modifié après création
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  affichage_couleur INTEGER NOT NULL DEFAULT 0, -- propriété générique ("ce type peut afficher un sélecteur de couleur"), jamais liée au code 'couleur' en dur
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS declinaison_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  valeur TEXT NOT NULL,
  valeur_normalisee TEXT NOT NULL,
  couleur_hex TEXT,                    -- uniquement pertinent pour le type Couleur ; toujours nullable ailleurs
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(declinaison_type_id, valeur_normalisee)
);

-- Quels types de déclinaisons un article donné utilise, et dans quel ordre les afficher.
-- Jamais verrouillé : un article peut ajouter/retirer un type même après avoir des variantes
-- (l'avertissement éventuel est géré côté interface, pas par une contrainte ici).
CREATE TABLE IF NOT EXISTS article_declinaison_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  ordre INTEGER DEFAULT 0,
  UNIQUE(article_id, declinaison_type_id)
);

-- Valeurs autorisées pour CET article, pour chacun de ses types associés (ex : cet article n'a
-- que 3 des 8 couleurs du catalogue). Sert à préremplir l'assistant de génération et à calculer
-- l'impact précis d'un changement de configuration.
CREATE TABLE IF NOT EXISTS article_declinaison_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  declinaison_valeur_id INTEGER NOT NULL REFERENCES declinaison_valeurs(id),
  UNIQUE(article_id, declinaison_type_id, declinaison_valeur_id)
);

-- Une combinaison concrète pour un article ("Noir / M"), à 1, 2, 3 axes ou plus. Champs prévus
-- dès maintenant pour un usage futur (SKU, code-barres, référence interne), même non utilisés
-- pour l'instant.
CREATE TABLE IF NOT EXISTS article_variantes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id),
  sku TEXT,
  code_barres TEXT,
  reference_interne TEXT,
  actif INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Le détail d'une variante : une ligne par axe (une pour Couleur=Noir, une pour Taille=M...).
CREATE TABLE IF NOT EXISTS article_variante_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_variante_id INTEGER NOT NULL REFERENCES article_variantes(id) ON DELETE CASCADE,
  declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
  declinaison_valeur_id INTEGER NOT NULL REFERENCES declinaison_valeurs(id),
  UNIQUE(article_variante_id, declinaison_type_id)
);

-- Un article = un modèle de produit stable (référence principale, saison, rayon, année).
-- Plusieurs commandes de production peuvent porter sur le même article (réassorts inclus).
-- Les colonnes de référence sont NULLABLES : un article issu d'une migration n'a pas de
-- référence "fabriquée" tant que personne ne l'a renseignée manuellement (voir migrate.js).
CREATE TABLE IF NOT EXISTS articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  -- Nom commercial de CET article : « T-shirt oversize », « Pull Zip up uni ».
  -- Indispensable depuis que produit_id désigne un TYPE générique (T-shirt, Pull) : sans elle,
  -- deux articles du même type seraient indiscernables partout où p.nom était affiché
  -- (commandes.js, ficheTechnique.js, bcPf.js). Toutes les lectures font COALESCE(designation, p.nom).
  designation TEXT,
  abreviation TEXT,                            -- 2 à 5 lettres majuscules, ex: JEA
  numero_sequentiel INTEGER,                   -- calculé automatiquement à la génération
  reference_principale TEXT UNIQUE,            -- ex: FW26-M-JEA-01 ; générée une fois, jamais réécrite
  est_demo INTEGER NOT NULL DEFAULT 0,         -- 1 = article de démonstration, supprimable avec les commandes de démo
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (abreviation IS NULL OR (abreviation = UPPER(abreviation) AND LENGTH(abreviation) BETWEEN 2 AND 5))
);

-- Photos d'un article. Modèle prêt pour plusieurs photos ; en v1, une seule est utilisée par
-- l'interface (est_principale = 1). Chemins RELATIFS au dossier de données, comme pour tout
-- le reste (voir electron/ipc/photos.js).
CREATE TABLE IF NOT EXISTS article_photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  photo_path TEXT NOT NULL,
  photo_thumb_path TEXT NOT NULL,
  est_principale INTEGER NOT NULL DEFAULT 0,
  ordre INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS commandes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,       -- identifiant technique interne (usage futur inter-modules)
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- La date limite de production ne peut pas précéder la date de lancement.
  CHECK (date_fin_prevue >= date_lancement),
  -- Le motif du blocage est obligatoire uniquement lorsque l'indicateur "bloquée" est actif.
  CHECK (bloquee = 0 OR (blocage_motif IS NOT NULL AND TRIM(blocage_motif) <> ''))
);

-- Historique complet des transitions de cycle de vie : jamais écrasé, une ligne par événement.
-- Les colonnes *_le / *_par_id sur "commandes" ne gardent que le dernier événement de chaque type
-- (pratique pour l'affichage courant) ; cette table garde tout, y compris les cycles
-- bloquer/débloquer répétés.
CREATE TABLE IF NOT EXISTS historique_transitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  type_evenement TEXT NOT NULL CHECK (type_evenement IN (
    'validation', 'lancement', 'entree_controle_qualite', 'fin_production',
    'annulation', 'blocage', 'deblocage', 'archivage', 'desarchivage'
  )),
  operateur_id INTEGER REFERENCES listes_valeurs(id),
  motif TEXT,
  survenu_le TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une ligne = une combinaison couleur × taille réellement utilisée dans la commande.
-- Aucune ligne à quantité nulle n'est stockée : la grille de saisie ne persiste que le rempli.
-- taille_id est nullable : les commandes migrées depuis l'ancien modèle (une seule couleur,
-- pas de notion de taille) donnent une ligne avec taille_id = NULL.
-- ============================================================================
-- GRILLES DE TAILLES — architecture générique, aucune logique alphabétique/numérique codée en
-- dur. Une grille (Vêtements, Pantalons, Chaussures...) contient ses propres valeurs, dans un
-- ordre qui lui appartient. Remplace l'ancien listes_valeurs type='taille'/'pointure' pour tout
-- nouvel usage — l'ancien système reste en base pour l'historique, jamais supprimé silencieusement.
-- ============================================================================

CREATE TABLE IF NOT EXISTS grilles_tailles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS grilles_tailles_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grille_id INTEGER NOT NULL REFERENCES grilles_tailles(id) ON DELETE CASCADE,
  valeur TEXT NOT NULL,
  valeur_normalisee TEXT NOT NULL,
  ordre INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,
  UNIQUE(grille_id, valeur_normalisee)
);

-- Association explicite type de produit -> grille de tailles par défaut. Table dédiée et
-- clairement nommée, plutôt qu'une colonne ajoutée sur la table générique listes_valeurs sans
-- vérifier son rôle actuel. produit_id référence listes_valeurs(id) où type='produit'.
CREATE TABLE IF NOT EXISTS produit_grille_taille (
  produit_id INTEGER PRIMARY KEY REFERENCES listes_valeurs(id) ON DELETE CASCADE,
  grille_id INTEGER NOT NULL REFERENCES grilles_tailles(id)
);

CREATE TABLE IF NOT EXISTS commande_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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

-- ============================================================================
-- FICHE TECHNIQUE PRODUIT — outil de travail bureau d'études / production.
-- Un article = une fiche technique. Croquis annotés, tableau de mesures dynamique
-- (lignes ET colonnes non figées), accessoires. Deux catalogues (mesures, accessoires)
-- grandissent avec l'usage : chaque nouvel élément saisi enrichit les suggestions futures,
-- sans jamais rien imposer.
-- ============================================================================

CREATE TABLE IF NOT EXISTS fiches_techniques (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id),
  coupe_id INTEGER REFERENCES listes_valeurs(id),
  -- Cycle de vie simple pour l'instant (pas de révisions multiples) : le champ existe déjà pour
  -- ne pas bloquer une évolution future, mais UNIQUE(article_id) ci-dessus signifie qu'il n'y a
  -- pour l'instant qu'UNE fiche par article. Introduire de vraies révisions plus tard demandera
  -- de relâcher cette contrainte (même logique que le passage BC PF "un numéro = un document").
  statut TEXT NOT NULL DEFAULT 'brouillon' CHECK (statut IN ('brouillon', 'validee', 'archivee')),
  -- État explicite plutôt qu'un simple booléen : distingue une grille jamais touchée, générée
  -- depuis un modèle (traçable via modele_mesures_id), ou construite exceptionnellement à la main.
  mesures_etat TEXT NOT NULL DEFAULT 'non_genere' CHECK (mesures_etat IN ('non_genere', 'genere_depuis_modele', 'construit_manuellement')),
  tailles_confirmees INTEGER NOT NULL DEFAULT 0,
  modele_mesures_id INTEGER REFERENCES modeles_mesures(id),
  -- Grille de tailles retenue POUR CETTE FICHE. Nullable : les fiches créées avant l'existence de
  -- cette colonne gardent NULL et continuent d'afficher normalement leurs tailles.
  -- Volontairement au niveau de la fiche, et non dans produit_grille_taille : un article peut
  -- légitimement utiliser une grille différente de celle de son type (série spéciale, gamme
  -- enfant dans une ligne adulte). Quand la notion de Type de produit existera,
  -- produit_grille_taille servira à PROPOSER une grille par défaut ; ce choix-ci restera
  -- prioritaire, sans aucune reprise de données.
  grille_id INTEGER REFERENCES grilles_tailles(id),
  notes TEXT,
  -- Description technique rédigée par le bureau d'études : caractéristiques, détails de
  -- confection, finitions, instructions particulières. HTML volontairement pauvre (sept balises,
  -- aucun attribut) pour que la mise en forme reste homogène quelle que soit la provenance du
  -- texte — voir electron/ipc/descriptionTechnique.js, seule définition de ce qui est accepté,
  -- partagée entre l'enregistrement et la génération du PDF.
  -- Distincte de `notes`, qui reste le champ de remarques libres.
  description_technique TEXT,
  validated_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ft_croquis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  vue TEXT NOT NULL DEFAULT 'face' CHECK (vue IN ('face', 'dos', 'detail', 'autre')),
  vue_personnalisee TEXT,     -- libellé libre uniquement quand vue = 'autre' (ex : "Poche intérieure")
  image_path TEXT NOT NULL,
  legende TEXT,
  ordre INTEGER DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- L'annotation n'est jamais fusionnée dans l'image : elle reste modifiable, déplaçable et
-- supprimable sans jamais retoucher le croquis d'origine. Coordonnées NORMALISÉES entre 0 et 1
-- (pas des pixels, pas des pourcentages) : restent valides quel que soit le redimensionnement à
-- l'écran ou dans le PDF. Deux points distincts :
--   - (ancre_x, ancre_y)   : la FIN de la flèche, l'endroit précis désigné sur le croquis ;
--   - (label_x, label_y)   : le DÉBUT de la flèche, où le texte de l'annotation est positionné.
-- Style simple dans cette première version, mais déjà présent pour ne pas bloquer plus tard.
CREATE TABLE IF NOT EXISTS ft_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  croquis_id INTEGER NOT NULL REFERENCES ft_croquis(id) ON DELETE CASCADE,
  ancre_x REAL NOT NULL,
  ancre_y REAL NOT NULL,
  label_x REAL NOT NULL,
  label_y REAL NOT NULL,
  texte TEXT NOT NULL,
  style_fleche TEXT NOT NULL DEFAULT 'droite' CHECK (style_fleche IN ('droite', 'courbe', 'coudee')),
  couleur TEXT NOT NULL DEFAULT '#1A1A1A',
  epaisseur REAL NOT NULL DEFAULT 1.5,
  orientation_texte TEXT NOT NULL DEFAULT 'horizontal' CHECK (orientation_texte IN ('horizontal', 'vertical')),
  visible_impression INTEGER NOT NULL DEFAULT 1,
  ordre INTEGER DEFAULT 0
);

-- Catalogue des mesures : grandit avec l'usage, jamais figé en dur dans le code.
CREATE TABLE IF NOT EXISTS mesures_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Quelles lignes de mesure cette fiche utilise, dans quel ordre, et leurs réglages propres à
-- CETTE fiche (le repère, la tolérance ou l'unité d'une même mesure peuvent différer d'un
-- article à l'autre — ça n'a donc pas sa place dans le catalogue partagé).
CREATE TABLE IF NOT EXISTS ft_mesures_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  mesure_catalogue_id INTEGER NOT NULL REFERENCES mesures_catalogue(id),
  repere TEXT,              -- "A", "B", "C"... relie la ligne au schéma annoté. FACULTATIF, mais
                            -- unique dans une fiche : voir l'index partiel dans indexes.sql.
  -- Libellé propre à CETTE fiche, quand il doit différer du catalogue. NULL = suit le catalogue.
  -- L'affichage est toujours COALESCE(nom_local, mesures_catalogue.nom).
  -- Indispensable parce qu'une ligne de fiche n'avait aucun nom à elle : le libellé venait de
  -- mesures_catalogue, partagé par TOUTES les fiches — renommer sur une fiche renommait partout.
  -- Note : ft_mesures_valeurs reste identifiée par mesure_catalogue_id, donc renommer localement
  -- ne déplace aucune valeur saisie. Deux fiches peuvent afficher des noms différents pour la
  -- même mesure sous-jacente : c'est le comportement voulu.
  nom_local TEXT,
  unite TEXT,                -- cm, mm, pouces...
  tolerance_plus TEXT,       -- texte libre : "0,5", "1/4"...
  tolerance_moins TEXT,
  commentaire TEXT,
  -- 'principale' | 'detail' | NULL. NULL = non classee, AFFICHEE COMME PRINCIPALE : les lignes
  -- anterieures restent donc visibles sans aucune migration.
  -- Le groupe de la FICHE peut differer de celui du modele : modifier ici ne touche jamais le
  -- modele du type, exactement comme nom_local pour le libelle.
  groupe TEXT CHECK (groupe IS NULL OR groupe IN ('principale', 'detail')),
  ordre INTEGER DEFAULT 0,
  UNIQUE(fiche_id, mesure_catalogue_id)
);

-- Catalogue des tailles : grandit avec l'usage, comme les mesures et les accessoires. N'impose
-- aucune nomenclature (S/M/L, 38/40/42, "Taille unique", "Sur-mesure" coexistent librement) —
-- sert uniquement à faciliter la saisie et éviter les doublons de casse (S vs s).
CREATE TABLE IF NOT EXISTS tailles_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une colonne (taille) du tableau de mesures. Entièrement propre à la fiche : aucun lien vers les
-- Déclinaisons de l'article. "nom" est TOUJOURS présent (dénormalisé) ; taille_catalogue_id est le
-- lien optionnel vers le catalogue qui a servi à l'autocomplétion, pour le faire grandir.
-- L'ordre appartient à la fiche (ordre), jamais au catalogue.
CREATE TABLE IF NOT EXISTS ft_tailles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  nom TEXT NOT NULL,
  grille_valeur_id INTEGER REFERENCES grilles_tailles_valeurs(id),
  ordre INTEGER DEFAULT 0
);

-- Valeur de la cellule (mesure × taille). Référence ft_tailles (la colonne LOCALE à la fiche),
-- jamais directement declinaison_valeurs — fonctionne donc aussi bien pour une colonne liée au
-- catalogue que pour une colonne "propre à cette fiche". Texte libre : "38 ± 1", "voir
-- gradation"... Vide = case non renseignée, jamais une fausse valeur "0".
CREATE TABLE IF NOT EXISTS ft_mesures_valeurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  mesure_catalogue_id INTEGER NOT NULL REFERENCES mesures_catalogue(id),
  ft_taille_id INTEGER NOT NULL REFERENCES ft_tailles(id) ON DELETE CASCADE,
  valeur TEXT,
  UNIQUE(mesure_catalogue_id, ft_taille_id)
);

-- Catalogue des accessoires : grandit avec l'usage, comme les mesures.
CREATE TABLE IF NOT EXISTS accessoires_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  -- Famille par défaut proposée quand cette désignation est choisie dans l'autocomplétion.
  -- Sert de PRÉREMPLISSAGE, jamais de liste figée : chaque ligne reste modifiable, désactivable,
  -- et l'utilisateur peut en créer d'autres à la volée (même principe que postes_cout_predefinis).
  famille TEXT NOT NULL DEFAULT 'composant' CHECK (famille IN ('habillage', 'composant')),
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- ATTENTION : cette table est référencée par prix_fournisseurs.accessoire_catalogue_id (module
-- Finance). Elle ne doit JAMAIS être renommée, reconstruite ni vidée par une migration de la
-- fiche technique — au même titre que matieres_catalogue et mesures_catalogue.

-- FOURNITURES de la fiche technique. Le nom de table reste ft_accessoires : renommer coûterait
-- une reconstruction sans rien apporter, "Fournitures" étant uniquement le libellé d'interface.
-- Deux familles, portées par la colonne famille :
--   * 'habillage'  = Habillage & Branding (étiquette de marque, de composition, hang tag, fil
--                    d'attache...) — couleur, dimension et emplacement rarement pertinents ;
--   * 'composant'  = Composants de confection (zip, bouton, élastique, cordon, pression...).
-- "nom" est une copie figée (permet un nom saisi librement même sans lien vers le catalogue) ;
-- accessoire_catalogue_id est le lien optionnel vers le catalogue qui a servi à l'autocomplétion.
--
-- consommation_par_piece, et non "quantité" : la fiche décrit une recette PAR PIÈCE, comme
-- ft_matieres.consommation_technique. C'est ce qui permettra de calculer plus tard le besoin
-- total depuis une commande (600 pantalons x 0,85 m = 510 m) sans refonte.
--
-- unite est volontairement du TEXTE LIBRE, contrairement à ft_matieres.unite : une fourniture
-- peut se compter en pièce, m, cm, paire, jeu, bobine... L'interface propose des suggestions
-- (datalist) sans jamais contraindre.
--
-- Une seule "reference" : elle identifie la fourniture, point. Les anciennes reference_interne /
-- reference_fournisseur n'avaient aucun usage métier distinct dans le code, et "fournisseur" a
-- été retiré — chez qui on achète relève de Finance/Achats (prix_fournisseurs.fournisseur_id),
-- et une fourniture peut changer de fournisseur sans que la définition technique change.
-- couleur_declinaison_valeur_id a également été retirée : elle pointait declinaison_valeurs,
-- le référentiel qui ne peut pas se croiser avec les quantités réelles de production.
CREATE TABLE IF NOT EXISTS ft_accessoires (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  accessoire_catalogue_id INTEGER REFERENCES accessoires_catalogue(id),
  famille TEXT NOT NULL DEFAULT 'composant' CHECK (famille IN ('habillage', 'composant')),
  nom TEXT NOT NULL,
  emplacement TEXT,
  reference TEXT,
  couleur TEXT,
  taille_dimension TEXT,
  consommation_par_piece REAL,
  unite TEXT,
  photo_path TEXT,
  description TEXT,
  ordre INTEGER DEFAULT 0
);

-- ============================================================================
-- MODÈLES DE TABLEAUX DE MESURES — administrables dans Paramètres, un par type de
-- produit (T-shirt, Polo, Pantalon...). À l'ouverture d'une fiche technique, si un modèle existe
-- pour le type de produit de l'article, le tableau de mesures se génère automatiquement : axe de
-- gradation + lignes par défaut + colonnes depuis les tailles autorisées pour l'article. Reste
-- ensuite librement modifiable comme avant (ajout/suppression/réordre de lignes et colonnes) —
-- le modèle ne fait que fournir un point de départ, jamais une contrainte figée.
-- ============================================================================

CREATE TABLE IF NOT EXISTS modeles_mesures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS modeles_mesures_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  modele_id INTEGER NOT NULL REFERENCES modeles_mesures(id) ON DELETE CASCADE,
  mesure_catalogue_id INTEGER NOT NULL REFERENCES mesures_catalogue(id),
  repere TEXT,
  unite TEXT,
  tolerance_plus TEXT,
  tolerance_moins TEXT,
  commentaire TEXT,
  -- Groupe PAR DEFAUT du type d'article, repris a la creation d'un tableau.
  groupe TEXT CHECK (groupe IS NULL OR groupe IN ('principale', 'detail')),
  ordre INTEGER DEFAULT 0,
  UNIQUE(modele_id, mesure_catalogue_id)
);

-- Module Planification : préparation visuelle des futures collections. Peut exister AVANT que le
-- produit soit créé dans le catalogue (article_id nullable) — c'est le principe central du module.
-- Réutilise les référentiels existants (catégorie, saison, atelier) plutôt qu'une logique séparée.
-- La quantité et les coloris sont volontairement des données de planification pures : jamais liées
-- automatiquement au stock, à une commande fournisseur ou à un ordre de production.
CREATE TABLE IF NOT EXISTS planning_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
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
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================================
-- MODULE FINANCE — Phase 1 (coûts, achats fournisseurs, réceptions, paiements, échéances)
-- Architecture validée sur plusieurs échanges : voir résumé en tête de chaque table.
-- Principe directeur : aucune valeur "coût réel", "dette" ou "trésorerie" n'est jamais saisie
-- directement — toutes sont calculées à partir des tables ci-dessous, chacune saisie une seule
-- fois, à l'endroit qui lui correspond naturellement.
-- ============================================================================================

CREATE TABLE IF NOT EXISTS fournisseurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  activite TEXT,                     -- ex: "Tissu / Matière" — descriptif libre, affiché dans la liste
  contact TEXT,
  telephone TEXT,
  email TEXT,
  adresse TEXT,
  conditions_paiement_defaut TEXT,   -- ancien champ texte libre, conservé mais plus jamais rempli
                                      -- ni affiché depuis la structuration ci-dessous
  delai_paiement_jours INTEGER,      -- 0 = comptant ; NULL = non renseigné
  delai_fin_de_mois INTEGER NOT NULL DEFAULT 0,  -- le délai démarre en fin de mois de facturation
                                      -- (ex: "30 jours fin de mois" = delai_paiement_jours=30 + ce flag)
  mode_paiement_defaut TEXT,         -- virement / cheque / especes / traite / autre
  notes TEXT,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Catalogue structuré des matières (tissu...), même logique qu'accessoires_catalogue déjà
-- existant — évite les doublons de désignation entre plusieurs tarifs fournisseurs.
CREATE TABLE IF NOT EXISTS matieres_catalogue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL UNIQUE,
  unite_defaut TEXT NOT NULL DEFAULT 'kg' CHECK (unite_defaut IN ('kg', 'm', 'piece', 'lot')),
  ordre INTEGER DEFAULT 0,
  actif INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historique des tarifs fournisseurs : une nouvelle ligne à chaque changement de prix, jamais une
-- modification d'une ligne existante. Le tarif "actuel" est celui sans date_fin_validite (ou la
-- plus récente). Référence si possible matieres_catalogue ou accessoires_catalogue (jamais les
-- deux) ; "designation" reste toujours renseignée, comme repli d'affichage pour un composant non
-- encore catalogué.
CREATE TABLE IF NOT EXISTS prix_fournisseurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
  matiere_catalogue_id INTEGER REFERENCES matieres_catalogue(id),
  accessoire_catalogue_id INTEGER REFERENCES accessoires_catalogue(id),
  designation TEXT NOT NULL,
  unite TEXT NOT NULL CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
  prix_ht REAL NOT NULL,
  date_debut_validite TEXT NOT NULL DEFAULT (date('now')),
  date_fin_validite TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (matiere_catalogue_id IS NULL OR accessoire_catalogue_id IS NULL)
);

-- Un achat = un ENGAGEMENT (BC MP, prestation de confection, transport...). "commande_id" n'est
-- rempli QUE pour un achat directement lié à une seule production (confection, retouche,
-- transport spécifique) ; laissé NULL pour un achat partageable entre plusieurs productions
-- (matière achetée en lot) — dans ce cas, la répartition passe par achats_affectations.
CREATE TABLE IF NOT EXISTS achats (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uuid TEXT NOT NULL UNIQUE,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
  commande_id INTEGER REFERENCES commandes(id),
  categorie TEXT NOT NULL CHECK (categorie IN (
    'matiere', 'fourniture', 'confection', 'impression', 'transport', 'retouche', 'emballage', 'autre'
  )),
  designation TEXT NOT NULL,
  matiere_catalogue_id INTEGER REFERENCES matieres_catalogue(id),  -- identifie le composant pour le
                                                 -- suivi de stock (matière ET fourniture) ; NULL pour
                                                 -- les achats non catalogués ou les prestations
  couleur TEXT,                                 -- optionnelle, jamais obligatoire — NULL = pas de
                                                 -- déclinaison couleur pour ce composant (ex: aiguille)
  quantite REAL,                     -- nécessaire pour un achat partageable (base de la répartition)
  unite TEXT CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
  montant_engage REAL NOT NULL,      -- l'engagement/la prévision, JAMAIS utilisé seul comme coût réel
  date_engagement TEXT NOT NULL DEFAULT (date('now')),
  reference TEXT,                    -- n° BC fournisseur, etc.
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Réception physique de la marchandise/prestation — distincte de la facturation, avec sa propre
-- date. Plusieurs lignes possibles (réceptions partielles).
CREATE TABLE IF NOT EXISTS achats_receptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
  date_reception TEXT NOT NULL DEFAULT (date('now')),
  quantite_recue REAL,
  reference_bl TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Facturation — distincte de la réception. Plusieurs factures possibles pour un même achat
-- (facturation partielle). C'est la SEULE source du "coût réel" ; montant_tva est purement
-- informatif, jamais utilisé dans un calcul de coût ou de marge (tout reste HT).
CREATE TABLE IF NOT EXISTS achats_factures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
  date_facture TEXT NOT NULL DEFAULT (date('now')),
  montant_ht REAL NOT NULL,
  montant_tva REAL,
  reference_facture TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Répartition d'un achat partageable (matière en lot) vers une ou plusieurs productions.
-- "quantite_affectee" est la seule valeur saisie/figée ici (une décision d'usage physique
-- réelle) : la VALEUR de cette affectation n'est jamais stockée, toujours recalculée au prorata
-- (quantite_affectee / achats.quantite) × valeur réelle actuelle de l'achat (facturé, ou engagé
-- tant que non facturé) — ainsi, une facture différente de l'engagement se répercute
-- automatiquement sur chaque production qui a utilisé une part de cet achat, sans ressaisie.
CREATE TABLE IF NOT EXISTS achats_affectations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
  commande_id INTEGER NOT NULL REFERENCES commandes(id),
  quantite_affectee REAL NOT NULL,
  date_affectation TEXT NOT NULL DEFAULT (date('now')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Une ou plusieurs échéances par achat.
CREATE TABLE IF NOT EXISTS echeances (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
  achat_facture_id INTEGER REFERENCES achats_factures(id) ON DELETE CASCADE,  -- rempli quand
                                                 -- l'échéance est créée depuis une facture précise ;
                                                 -- reste NULL pour une échéance saisie au niveau achat
  date_echeance TEXT NOT NULL,
  montant REAL NOT NULL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un paiement est toujours rattaché à un fournisseur (jamais directement à un achat) : un
-- versement peut couvrir plusieurs factures à la fois, ou rester en crédit non affecté (acompte
-- reçu avant qu'une facture n'arrive). Voir paiement_affectations pour la répartition.
CREATE TABLE IF NOT EXISTS paiements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
  type TEXT NOT NULL DEFAULT 'reglement' CHECK (type IN ('reglement', 'avance')),  -- une avance
                                              -- reste un crédit non affecté jusqu'à affectation
                                              -- ultérieure à une facture, exactement comme un
                                              -- règlement classique non encore affecté
  date_paiement TEXT NOT NULL DEFAULT (date('now')),
  montant REAL NOT NULL,
  mode TEXT,                         -- virement / chèque / espèces / traite...
  reference TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Affecte un paiement à une FACTURE précise (pas seulement à un achat) : permet de savoir
-- exactement quelle facture est payée / partiellement payée / non payée. La part d'un paiement
-- non affectée ici (paiements.montant - SUM de ses affectations) reste un crédit fournisseur
-- visible, jamais forcé sur une facture arbitrairement.
CREATE TABLE IF NOT EXISTS paiement_affectations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  paiement_id INTEGER NOT NULL REFERENCES paiements(id) ON DELETE CASCADE,
  achat_facture_id INTEGER NOT NULL REFERENCES achats_factures(id),
  montant_affecte REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Contrôle qualité à la réception de production — plusieurs lignes possibles (réceptions
-- partielles). L'historique du besoin de retouche est conservé pour toujours (quantite_a_retoucher
-- n'est jamais modifiée après coup) ; seule quantite_retouchee_recuperee progresse au fil des
-- retouches réussies. Commercialisables = quantite_conforme + quantite_retouchee_recuperee.
CREATE TABLE IF NOT EXISTS receptions_production (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  date_reception TEXT NOT NULL DEFAULT (date('now')),
  quantite_recue INTEGER NOT NULL,
  quantite_conforme INTEGER NOT NULL DEFAULT 0,
  quantite_a_retoucher INTEGER NOT NULL DEFAULT 0,
  quantite_retouchee_recuperee INTEGER NOT NULL DEFAULT 0,
  quantite_rebut INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (quantite_conforme + quantite_a_retoucher + quantite_rebut <= quantite_recue)
);

-- Instantané figé du coût prévisionnel, capturé à la validation de la commande — jamais recalculé
-- après coup même si un prix fournisseur change ensuite. Complètement indépendant du coût réel
-- (qui, lui, se dérive toujours des achats — jamais stocké).
CREATE TABLE IF NOT EXISTS commande_cout_previsionnel_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
  categorie TEXT NOT NULL CHECK (categorie IN (
    'matiere', 'fourniture', 'confection', 'impression', 'transport', 'retouche', 'emballage', 'autre'
  )),
  designation TEXT NOT NULL,
  quantite REAL,
  unite TEXT CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
  prix_unitaire_ht REAL,
  montant_ht REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================================================
-- ESTIMATIONS DE COÛT — le point de départ réel du workflow Finance : AVANT tout achat, AVANT
-- tout fournisseur choisi, AVANT le BC. Une estimation par article, entièrement modifiable tant
-- qu'aucune commande n'a été lancée. Au lancement du BC, ses lignes sont COPIÉES (jamais
-- référencées) vers commande_cout_previsionnel_lignes, qui reste alors figée pour toujours.
-- ============================================================================================
CREATE TABLE IF NOT EXISTS estimations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
  quantite_prevue INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS estimation_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estimation_id INTEGER NOT NULL REFERENCES estimations(id) ON DELETE CASCADE,
  categorie TEXT NOT NULL CHECK (categorie IN (
    'matiere', 'fourniture', 'habillage', 'emballage', 'transport', 'confection', 'impression', 'retouche', 'autre'
  )),
  designation TEXT NOT NULL,
  mode_calcul TEXT NOT NULL CHECK (mode_calcul IN ('consommation_prix', 'unitaire_direct', 'montant_global')),
  quantite REAL,               -- consommation par pièce (mode consommation_prix)
  unite TEXT CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
  prix_unitaire_ht REAL,       -- prix/unité (consommation_prix) OU coût direct par pièce (unitaire_direct)
  montant_global_ht REAL,      -- montant total production HT (mode montant_global)
  taux_tva REAL,                -- % ; NULL = pas de TVA sur cette ligne
  ordre INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Postes de coût prédéfinis : les habitudes de calcul PROPRES à l'utilisateur (étiquette marque,
-- sachet transparent, transport, façon...) — jamais un catalogue fournisseur. Sert uniquement à
-- préremplir une nouvelle ligne d'estimation ; aucune référence n'est conservée après sélection,
-- la ligne créée est une copie indépendante, modifiable librement ensuite.
CREATE TABLE IF NOT EXISTS postes_cout_predefinis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  categorie TEXT NOT NULL CHECK (categorie IN (
    'matiere', 'fourniture', 'habillage', 'emballage', 'transport', 'confection', 'impression', 'retouche', 'autre'
  )),
  designation TEXT NOT NULL,
  unite_defaut TEXT CHECK (unite_defaut IN ('kg', 'm', 'piece', 'lot')),
  mode_calcul_defaut TEXT NOT NULL CHECK (mode_calcul_defaut IN ('consommation_prix', 'unitaire_direct', 'montant_global')),
  quantite_defaut REAL,
  ajouter_automatiquement INTEGER NOT NULL DEFAULT 0,  -- coché : ce poste génère automatiquement
                                                        -- sa ligne dans chaque NOUVELLE estimation,
                                                        -- jamais rétroactivement sur les existantes
  ordre INTEGER NOT NULL DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ==================================================================================================
-- FICHE TECHNIQUE — MATIÈRES
-- ==================================================================================================
-- Séparation stricte des trois responsabilités, à ne jamais mélanger :
--   * Fiche technique  = la RECETTE par pièce (consommation technique + perte %) ;
--   * Commande de prod = la quantité à fabriquer, donc le BESOIN total (chantier suivant) ;
--   * Achats/Finance   = la quantité réellement achetée, le prix réel, les affectations.
-- Aucun prix n'apparaît donc ici : il varie par fournisseur, par achat et dans le temps
-- (cf. prix_fournisseurs), et une seconde vérité financière dans la FT serait fausse dès le
-- premier écart de facturation.
--
-- Bloc placé volontairement en FIN de fichier : matiere_couleurs dépend de matieres_catalogue
-- (module Finance, plus haut) et ft_matieres de fiches_techniques — aucune référence en avant.
--
-- Matières (jersey, piqué, molleton, interlock, bord-côte, doublure...) ≠ Accessoires (zip,
-- bouton, cordon, élastique, étiquette), qui restent entièrement dans ft_accessoires, inchangé.

-- Référentiel des coloris D'UNE MATIÈRE : "Noir 001" / "MOL-320-N01" décrivent le molleton
-- lui-même, pas telle fiche technique — les stocker dans la FT imposerait de les ressaisir sur
-- chaque modèle et laisserait diverger les orthographes. C'est aussi ce qui permettra à Finance
-- de passer un jour de achats.couleur TEXT à une vraie clé étrangère, sans jamais rapprocher
-- "Noir" de "NOIR" ou de "Noir 001" par comparaison de chaînes.
-- NOTE : la référence de coloris PRODUIT reste, elle, commande_lignes.reference_libre
-- (ex. "NOIR-01", visible sur les BC atelier) — deux notions distinctes, jamais confondues.
CREATE TABLE IF NOT EXISTS matiere_couleurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  matiere_catalogue_id INTEGER NOT NULL REFERENCES matieres_catalogue(id),
  code TEXT,                        -- "N01" — court, propre au fournisseur/à la matière
  libelle TEXT NOT NULL,            -- "Noir 001"
  libelle_normalise TEXT NOT NULL,  -- anti-doublon de casse/espaces, même principe que nom_normalise
  reference TEXT,                   -- "MOL-320-N01" — référence matière/fournisseur
  ordre INTEGER DEFAULT 0,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  -- Unicité PAR MATIÈRE, jamais globale : "Noir 001" peut exister pour le molleton ET pour le
  -- jersey. Les NULL étant distincts pour SQLite, plusieurs coloris sans code restent possibles.
  UNIQUE (matiere_catalogue_id, libelle_normalise),
  UNIQUE (matiere_catalogue_id, code)
);

-- Une matière de la recette. "nom" est une copie figée (permet un nom libre même sans lien vers
-- le catalogue), exactement comme ft_accessoires.nom ; matiere_catalogue_id est le lien optionnel
-- vers le catalogue qui a servi à l'autocomplétion, pour le faire grandir.
-- composition et grammage décrivent la spécification retenue POUR CETTE FICHE : matieres_catalogue
-- ne les porte pas aujourd'hui, et une même matière peut être spécifiée différemment d'un modèle
-- à l'autre. Les remonter au catalogue reste possible plus tard si l'usage le justifie.
-- IMPORTANT : la consommation BUDGÉTÉE n'a volontairement PAS de colonne. Elle vaut toujours
-- consommation_technique × (1 + perte_pourcent / 100) et reste calculée à l'affichage — la
-- stocker créerait une seconde vérité qui divergerait au premier changement de perte.
CREATE TABLE IF NOT EXISTS ft_matieres (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  matiere_catalogue_id INTEGER REFERENCES matieres_catalogue(id),
  nom TEXT NOT NULL,
  utilisation TEXT,                 -- "Corps du pantalon", "Doublure de poche"...
  composition TEXT,                 -- "80% coton / 20% polyester"
  grammage TEXT,                    -- TEXT et non REAL : "320", "320-340", "320 g/m²" — même
                                    -- souplesse que ft_mesures_lignes.tolerance_plus
  unite TEXT NOT NULL DEFAULT 'kg' CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
  consommation_technique REAL CHECK (consommation_technique IS NULL OR consommation_technique > 0),
  perte_pourcent REAL NOT NULL DEFAULT 0 CHECK (perte_pourcent >= 0),
  -- 'par_taille' n'est pas exposé dans l'interface de cette V1 : la colonne et la table
  -- ft_matiere_consommations_taille existent pour que le passage ultérieur au calcul
  -- Σ (qté couleur/taille × conso taille) × (1 + perte%) ne demande aucune refonte.
  mode_consommation TEXT NOT NULL DEFAULT 'moyenne' CHECK (mode_consommation IN ('moyenne', 'par_taille')),
  ordre INTEGER DEFAULT 0
);

-- Correspondance couleur PRODUIT -> coloris MATIÈRE. Deux informations différentes :
--   produit Noir  -> matière "Noir 001"  (réf. MOL-320-N01)
--   produit Gris  -> matière "Gris 014"  (réf. MOL-320-G14)
-- couleur_produit_id pointe listes_valeurs, et NON declinaison_valeurs : c'est le référentiel
-- qu'utilisent les quantités réelles de commande_lignes.couleur_id, donc le seul qui permettra
-- de croiser un besoin matière avec une quantité produite. (ft_accessoires utilise l'autre
-- système via couleur_declinaison_valeur_id ; cette incohérence historique est connue et reste
-- volontairement hors du périmètre de ce chantier.)
-- SQLite ne sait pas contraindre une FK à type = 'couleur' : le contrôle est applicatif
-- (assertCouleurProduit), exactement comme pour commande_lignes.couleur_id aujourd'hui.
-- matiere_couleur_id est nullable : on peut déclarer qu'une couleur produit utilise cette matière
-- avant d'avoir arrêté le coloris exact chez le fournisseur.
CREATE TABLE IF NOT EXISTS ft_matiere_couleurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ft_matiere_id INTEGER NOT NULL REFERENCES ft_matieres(id) ON DELETE CASCADE,
  couleur_produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
  matiere_couleur_id INTEGER REFERENCES matiere_couleurs(id),
  UNIQUE (ft_matiere_id, couleur_produit_id)
);

-- Consommation par taille (S 0,560 / M 0,590 / L 0,620...). PRÉPARÉE en base, non exposée dans
-- l'interface V1 qui reste en consommation moyenne.
-- Le parent est ft_tailles — les colonnes de tailles LOCALES à la fiche — et non
-- grilles_tailles_valeurs : c'est le rattachement qu'utilise déjà ft_mesures_valeurs, il garantit
-- que la consommation par taille porte exactement sur les mêmes tailles que le tableau de
-- mesures, et il fournit le libellé figé (ft_tailles.nom) sans colonne supplémentaire.
CREATE TABLE IF NOT EXISTS ft_matiere_consommations_taille (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ft_matiere_id INTEGER NOT NULL REFERENCES ft_matieres(id) ON DELETE CASCADE,
  ft_taille_id INTEGER NOT NULL REFERENCES ft_tailles(id) ON DELETE CASCADE,
  consommation_technique REAL CHECK (consommation_technique > 0),
  UNIQUE (ft_matiere_id, ft_taille_id)
);

-- ==================================================================================================
-- FICHE TECHNIQUE — VARIANTES DE FOURNITURES (préparées, non exposées dans l'interface V1)
-- ==================================================================================================
-- Certaines fournitures varient selon la couleur ou la taille du produit :
--   pantalon Noir  -> cordon Noir      |  taille S  -> zip 60 cm
--   pantalon Beige -> cordon Beige     |  taille XL -> zip 64 cm
-- Ces deux tables existent dès maintenant pour que ce cas n'impose aucune refonte plus tard.
-- Elles suivent EXACTEMENT le modèle validé pour les matières (ft_matiere_couleurs et
-- ft_matiere_consommations_taille) — mêmes référentiels, mêmes cascades, mêmes contraintes.

-- couleur_produit_id pointe listes_valeurs, et JAMAIS declinaison_valeurs : c'est le référentiel
-- qu'utilisent les quantités réelles de commande_lignes.couleur_id, donc le seul qui permettra de
-- croiser un besoin de fourniture avec une quantité produite. L'ancienne colonne
-- ft_accessoires.couleur_declinaison_valeur_id, qui pointait l'autre système, a été retirée
-- précisément pour ne pas reconduire cette incohérence.
-- SQLite ne sait pas contraindre une FK à type = 'couleur' : contrôle applicatif, comme partout.
CREATE TABLE IF NOT EXISTS ft_fourniture_couleurs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ft_accessoire_id INTEGER NOT NULL REFERENCES ft_accessoires(id) ON DELETE CASCADE,
  couleur_produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
  couleur_fourniture TEXT,   -- "Noir", "Beige" — la couleur DE LA FOURNITURE pour cette couleur produit
  reference TEXT,            -- référence spécifique à cette déclinaison, si elle diffère
  UNIQUE (ft_accessoire_id, couleur_produit_id)
);

-- Le parent est ft_tailles — les colonnes de tailles LOCALES à la fiche — et non
-- grilles_tailles_valeurs : c'est le rattachement qu'utilisent déjà ft_mesures_valeurs et
-- ft_matiere_consommations_taille. Il garantit que la variante porte sur les mêmes tailles que le
-- tableau de mesures, et fournit le libellé figé (ft_tailles.nom) sans colonne supplémentaire.
CREATE TABLE IF NOT EXISTS ft_fourniture_tailles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ft_accessoire_id INTEGER NOT NULL REFERENCES ft_accessoires(id) ON DELETE CASCADE,
  ft_taille_id INTEGER NOT NULL REFERENCES ft_tailles(id) ON DELETE CASCADE,
  taille_dimension TEXT,              -- "60 cm" pour le S, "64 cm" pour le XL
  consommation_par_piece REAL CHECK (consommation_par_piece IS NULL OR consommation_par_piece > 0),
  UNIQUE (ft_accessoire_id, ft_taille_id)
);

-- ==================================================================================================
-- FICHE TECHNIQUE — GRADATION PAR INTERVALLE
-- ==================================================================================================
-- Une gradation est l'écart entre DEUX tailles consécutives, pour UNE mesure.
--
-- Les deux extrémités sont stockées EXPLICITEMENT, et ce n'est pas un excès de prudence : avec la
-- seule taille d'arrivée, supprimer une taille intermédiaire faisait silencieusement changer un
-- intervalle de sens. Vérifié : sur S/M/L/XL avec S→M=+1 et M→L=+1, supprimer M laissait le +1
-- attaché à L, qui se lisait dès lors « S→L = +1 » — un intervalle deux fois plus large, à la même
-- valeur, sans le moindre signal.
-- Avec les deux extrémités, la double cascade emporte S→M ET M→L. Le trou S→L devient une ABSENCE
-- de ligne, donc détectable, et l'interface peut demander la valeur au lieu d'en inventer une.
--
-- valeur en REAL : la conversion virgule -> point se fait UNE FOIS à la saisie. Additionner du
-- texte serait la vraie source d'erreurs. 0,5 est conservé exactement et 54 + 0,5 × 4 = 56 sans
-- dérive à cette échelle.
--
-- Aucun lien avec les modèles de mesures : la gradation appartient à la fiche seule, et un modèle
-- ne connaît aucune taille — il ne pourrait stocker que des rangs, dont le rattachement se
-- décalerait dès qu'une fiche n'utilise pas le même jeu de tailles.
CREATE TABLE IF NOT EXISTS ft_mesures_gradations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id) ON DELETE CASCADE,
  mesure_catalogue_id INTEGER NOT NULL REFERENCES mesures_catalogue(id),
  taille_depart_id INTEGER NOT NULL REFERENCES ft_tailles(id) ON DELETE CASCADE,
  taille_arrivee_id INTEGER NOT NULL REFERENCES ft_tailles(id) ON DELETE CASCADE,
  valeur REAL NOT NULL,
  CHECK (taille_depart_id <> taille_arrivee_id),
  UNIQUE (fiche_id, mesure_catalogue_id, taille_depart_id, taille_arrivee_id)
);

-- Ratios de repartition reutilisables : un jeu de poids par taille (ex. S=1, M=2, L=3, XL=2,
-- 2XL=1), enregistre une fois et reapplicable sur les commandes suivantes. Un ratio appartient
-- toujours a une grille, et ses lignes referencent grilles_tailles_valeurs(id) par cle
-- etrangere : aucune correspondance par libelle, donc aucune confusion possible entre deux
-- referentiels de tailles. Un ratio ne decrit que des proportions : il n'est jamais lie a une
-- commande, et sa suppression ne peut donc rendre aucune commande incoherente.
CREATE TABLE IF NOT EXISTS repartition_ratios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nom TEXT NOT NULL,
  nom_normalise TEXT NOT NULL,
  grille_id INTEGER NOT NULL REFERENCES grilles_tailles(id) ON DELETE CASCADE,
  actif INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (grille_id, nom_normalise)
);

CREATE TABLE IF NOT EXISTS repartition_ratios_lignes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ratio_id INTEGER NOT NULL REFERENCES repartition_ratios(id) ON DELETE CASCADE,
  taille_id INTEGER NOT NULL REFERENCES grilles_tailles_valeurs(id) ON DELETE CASCADE,
  poids REAL NOT NULL,
  UNIQUE (ratio_id, taille_id)
);

