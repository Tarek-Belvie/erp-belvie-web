# Migration Electron 1.0.1 → web : ce qui a changé

## Ce qui ne change pas

- **Le comportement métier.** Les 25 modules (`apps/api/src/modules`) sont le code de la 1.0.1, converti en asynchrone. Les tests différentiels prouvent que les résultats sont identiques. Sur une copie de la base réelle : 954 lectures, 0 écart. Les écritures sont couvertes par les scénarios `scenario-*.test.js`.
- **Les écrans.** L'interface React est celle de la 1.0.1. Les écrans appellent toujours `window.api.*`.
- **Les données.** Le schéma PostgreSQL est la traduction directe du schéma SQLite final, et les chemins de fichiers en base n'ont pas changé.

## Ce qui change pour les utilisateurs

| Avant (Electron) | Maintenant (web) |
|---|---|
| Installation sur un PC Windows | Navigateur, de n'importe où, plusieurs personnes en même temps |
| Pas de compte | Connexion par e-mail + mot de passe (comptes créés par un administrateur) |
| Sélecteur de fichier Windows | Sélecteur de fichier du navigateur (même formats, 10 Mo max) |
| « Enregistrer le PDF sous… » | Le PDF se télécharge directement |
| Sauvegarde manuelle vers un dossier choisi, restauration depuis l'écran | Sauvegarde automatique chaque nuit (R2, e-mail) + sauvegarde complète à la demande ; restauration par l'administrateur sur le serveur |
| Enregistrement automatique des mesures en attente à la fermeture | Le navigateur avertit avant de quitter la page s'il reste des saisies non enregistrées |

## Ce qui a été supprimé, et pourquoi

| Supprimé | Raison |
|---|---|
| `electron/` (fenêtre, preload, IPC, verrou d'instance, dossier `%APPDATA%`) | Remplacé par l'API HTTP ; plusieurs utilisateurs peuvent maintenant travailler en même temps |
| Installateur Windows, icône, `CONSTRUIRE-INSTALLATEUR` | Plus d'installation |
| `electron/db/migrate.js` (2 500 lignes de migrations SQLite) | Remplacé par `migrations/001_schema_initial.sql` (état final) et le lanceur de migrations |
| `sauvegarde.js` (copie de fichiers SQLite) | Remplacé par `pg_dump` (`system.js`, `scripts/sauvegarde-r2.js`) |
| `server/`, `shared/`, `api/`, `vercel.json`, client Supabase, `webApiShim.ts` | Premier essai de version web, partiel (7 routes sur 277) et en double avec Electron |
| Scripts `diagnostic-*.js`, `verif*.js`, `mapping-types-articles.js`… | Outils ponctuels sur la base SQLite locale |
| Doublons : `commandes.js` et `bcPf.js` à la racine, `electron/ipc/*.tsx`, `settings/CommandeWizard.tsx`, deux `ModelesMesuresPanel.tsx`, copie de `ficheTechniquePdf.js` dans `src/` | Code mort ou copies périmées |

Tout reste consultable dans l'historique Git (tag `electron-1.0.1`). Les notes de livraison de la 1.0.1 sont dans [`historique/`](historique/).

## Différences techniques à connaître

- **Tri des NULL** : SQLite les place en tête en ordre croissant, PostgreSQL en fin. La couche `src/db` impose le comportement SQLite à chaque `ORDER BY`.
- **Ordre sans `ORDER BY`** : PostgreSQL ne garantit aucun ordre, et une modification peut déplacer une ligne. Les requêtes qui alimentent des listes ont reçu un tri explicite (règle D16).
- **Erreur dans une transaction** : PostgreSQL annule toute la transaction. Les réessais après conflit (numérotation des réassorts, références articles, enrichissement d'un modèle de mesures) sont désormais isolés dans un SAVEPOINT.
- **Identifiants** : une insertion annulée consomme un identifiant, ce qui laisse des trous dans les `id`. C'est sans effet fonctionnel : les numéros métier (CMD, BC, MP) viennent de tables compteurs transactionnelles.
- **`LIKE`** est devenu `ILIKE` : la recherche reste insensible à la casse, et l'est maintenant aussi pour les lettres accentuées.
- **Tri alphabétique** : `LOWER(x) COLLATE ucs_basic` reproduit le `COLLATE NOCASE` de SQLite (ordre binaire). Un tri « à la française » (é près de e) est une amélioration possible, à décider.

## Points ouverts (à décider)

1. **Opérateur actif** : il est enregistré **pour toute l'application** (`parametres.operateur_actif_id`), comme dans la version mono-poste. À plusieurs utilisateurs, chacun écrase celui des autres. Proposition : lier l'opérateur au compte connecté. C'est la première évolution à faire avant une utilisation à plusieurs.
2. **Types de colonnes** : passer les dates en `timestamptz` / `date` et les indicateurs en `boolean` (une migration par table, avec tests).
3. **Sauvegarde des fichiers sur R2** (photos, croquis, logo) : à ajouter à la sauvegarde quotidienne ou en hebdomadaire.
4. **Gestion des comptes depuis l'interface** (aujourd'hui en ligne de commande).
5. **Bug hérité** : `system:loadDemoData` échoue sur une installation neuve (« Aucune catégorie n'est rattachée… ») dans l'ancien code comme dans le nouveau. À corriger dans `lib/demoData.js`.
6. **Bug hérité** : créer un BC PF sans avoir configuré l'entreprise produit une erreur technique. Il faudrait un message clair.
7. **Typage** : 34 erreurs TypeScript héritées (`global.d.ts` n'est plus à jour par rapport aux écrans).
