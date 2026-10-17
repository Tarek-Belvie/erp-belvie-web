# 0. Principes transverses

## 1. Rôle

Ces règles s'appliquent à **tous** les modules et priment sur toute règle locale (document
fonctionnel §0). Cette fiche les rappelle et indique comment la version web (PostgreSQL) les
respecte.

## 2. Règles métier

### R0.1 — Calculer, jamais recopier
Une valeur dérivée (besoin, coût réel, dette, trésorerie, montant d'une ligne, statut « soldé »)
**n'est jamais saisie ni stockée comme vérité indépendante** : elle est recalculée à partir des
données sources, chacune saisie une seule fois. **Seule exception admise : l'instantané figé**,
daté et motivé (BC PF, BC MP validé, recette figée d'une production, révision archivée d'une fiche).

### R0.2 — Une seule définition par règle
Une règle métier n'existe qu'à un seul endroit du code :
- le contrôle avant validation de fiche **appelle le moteur de besoins** (🟦, voir RV1) ;
- la préparation des BC MP **appelle le même moteur** que l'écran des besoins
  (`preparationBcMp.regrouper` → `besoins.calculerPourCommande`) ;
- la répartition d'une quantité entre productions est faite **uniquement côté serveur**
  (`bcMp.repartirParPoids`).

### R0.3 — Rien de silencieux
Une donnée manquante produit une **anomalie nommée**, jamais une valeur par défaut, une moyenne
ou un zéro ; une ligne en anomalie reste **visible** ; un chiffre partiel est **présenté comme partiel**.

### R0.4 — Rien de rétroactif sans geste explicite
Aucune modification d'une fiche, d'un tarif ou d'un fournisseur ne réécrit un document émis, un
engagement ou la référence technique d'une production décidée. Toute mise à jour passe par une
action explicite, tracée (motif, date, opérateur), précédée de l'affichage de ses conséquences.

### R0.5 — Migrations strictement additives
Seuls `CREATE TABLE IF NOT EXISTS` et `ALTER TABLE … ADD COLUMN` étaient autorisés dans la version
Electron (contrôle automatique refusant `DROP`, `DELETE`, `UPDATE`, `INSERT`, `RENAME`) ; pas de
contrainte `CHECK` ajoutée sur une colonne existante (SQLite imposait une reconstruction).

### R0.6 — Atomicité
Toute opération multi-tables (validation, révision, gel, préparation d'un lot de bons) s'exécute
dans **une seule transaction** : tout ou rien.

### R0.7 — Aucune modification des données existantes sans accord explicite
Ni migration qui écrit au démarrage, ni reprise automatique.

## 3. Traduction dans la version web

| Principe | Où il est garanti maintenant |
|---|---|
| R0.3 | Inchangé dans le code métier. La couche d'accès (`src/db/index.js`) refuse en plus toute valeur `undefined` passée à une requête et tout nombre de paramètres incorrect, au lieu de les laisser passer. |
| R0.5 | Migrations PostgreSQL versionnées `apps/api/migrations/NNN_*.sql`, appliquées par `src/db/migrer.js`. Une migration appliquée n'est **jamais** modifiée : son empreinte SHA-256 est enregistrée dans `schema_migrations` et un fichier modifié après coup bloque le démarrage. PostgreSQL sait ajouter une contrainte sans reconstruire la table : la restriction « pas de `CHECK` sur colonne existante » propre à SQLite n'a plus de raison technique (à rediscuter dans les règles de développement). |
| R0.6 | `db.transaction(fn)` (même forme que better-sqlite3) ouvre une transaction PostgreSQL sur **une seule connexion** ; toutes les requêtes de `fn`, y compris celles écrites avec la variable `db` capturée, passent par cette connexion (AsyncLocalStorage). Les transactions imbriquées deviennent des `SAVEPOINT`. |
| R0.7 | Les migrations 001 à 003 créent le schéma et les données de référence d'une installation neuve. La reprise des données d'un poste Electron est une opération **manuelle et explicite** (`tools/reprise-donnees/reprise.js`, contrôle seul par défaut, `--executer` pour copier). |
| Lectures | Les routes `GET` utilisent une connexion PostgreSQL en **lecture seule** (`default_transaction_read_only=on`) : une lecture ne peut rien écrire, même par erreur. |

### Équivalences SQLite → PostgreSQL garanties par la couche d'accès
- paramètres `?` et nommés (`@nom`, `:nom`, `$nom`) traduits en `$1, $2…` ;
- `lastInsertRowid` fourni par un `RETURNING id` ajouté automatiquement aux `INSERT` des tables
  ayant une colonne `id` ;
- **tri des `NULL` identique à SQLite** : chaque terme d'`ORDER BY` sans précision reçoit
  `NULLS FIRST` (ASC) ou `NULLS LAST` (DESC) ;
- `BIGINT` et `NUMERIC` lus comme nombres JavaScript ;
- `datetime('now')` / `date('now')` remplacés par les fonctions SQL `maintenant()` / `aujourdhui()`
  (texte UTC au format SQLite) ;
- `COLLATE NOCASE` remplacé par `LOWER(x) COLLATE ucs_basic` dans les tris.

## 4. Points ouverts / dette technique

- Dates stockées en `TEXT` (format SQLite) et booléens en entiers 0/1 : choix de fidélité de la
  phase 1, à convertir en `TIMESTAMPTZ` / `BOOLEAN` dans une migration dédiée.
- Ex æquo de tri : SQLite les départage par ordre de lecture (souvent `id` croissant), PostgreSQL
  non. Les requêtes où un écart a été constaté ont reçu un départage explicite ; toute nouvelle
  requête affichée à l'utilisateur doit en prévoir un.
- *Constat* : dans `001_schema_initial.sql`, la conversion automatique a transformé en colonnes
  `IDENTITY` des clés primaires qui ne sont pas des compteurs (`commandes_recette_figee.commande_id`,
  `compteurs.annee`, `compteurs_bc_mp.annee`, `compteurs_bc_pf.annee`). C'est sans effet sur le
  fonctionnement (`GENERATED BY DEFAULT` accepte les valeurs fournies), mais trompeur à la lecture.
