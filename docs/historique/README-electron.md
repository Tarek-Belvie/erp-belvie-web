# Belvie ERP — Module Commandes de production

**Mise à jour "multi-couleurs / multi-tailles"** : une commande peut désormais couvrir plusieurs couleurs et plusieurs tailles, avec une quantité par combinaison (grille de saisie couleur × taille dans le formulaire). La quantité totale n'est plus saisie manuellement, elle est calculée automatiquement. Nouvelle liste administrable "Tailles" dans Paramètres (ordre personnalisable). Le tableau principal affiche un résumé ("3 couleurs • 5 tailles • 420 pièces") plutôt que le détail complet ; le détail apparaît en cliquant sur la commande. Migration automatique et sans perte depuis l'ancien modèle (1 couleur + 1 quantité) — voir section 10.

**Correctif critique (version précédente)** : l'initialisation de la base plantait au démarrage sur une base créée par une version antérieure (`SqliteError: no such column: atelier_id`). L'ordre d'initialisation est strict : tables → migrations (chacune dans sa propre transaction) → vérification explicite des colonnes → index/trigger → données de démonstration → démarrage de l'interface.

Application **desktop locale** (Windows), hors ligne, sans abonnement. Vous êtes propriétaire à 100 % du code.
Les données sont stockées dans un unique fichier SQLite sur votre ordinateur — aucune donnée ne quitte votre machine.

## Ce que contient cette v1

- Module **Commandes de production** complet : création, modification, mise à jour rapide (étape/statut), archivage, suppression avec confirmation.
- **Grille couleur × taille** par commande, avec totaux automatiques (par couleur, par taille, total général).
- **Étapes personnalisables** (Paramètres) : nom, ordre, activation/désactivation — sans pourcentage, saisie volontairement simple.
- **Listes administrables** : produits, couleurs, responsables, ateliers, tailles — ajout depuis le formulaire (sauf tailles, gérées uniquement dans Paramètres), gestion complète dans Paramètres.
- **Photo de l'article** par commande, avec miniature dans le tableau et aperçu au clic.
- **Sauvegarde manuelle et sauvegarde automatique** (5 dernières conservées, base + images) — voir section 6.
- **Export Excel (.xlsx, avec détail couleur/taille sur une 2ᵉ feuille) et CSV**.
- **Données de démonstration** supprimables en un clic, sans toucher aux listes ni aux vraies commandes.
- Architecture pensée pour ajouter facilement d'autres modules plus tard (voir plus bas).

> ⚠️ **Important — usage mono-poste.** Cette v1 stocke toutes les données dans un fichier SQLite **local à l'ordinateur sur lequel l'application est installée**. Si vous installez l'application sur plusieurs postes de l'entreprise, **chaque installation aura sa propre base de données indépendante** — il n'y a **aucune synchronisation automatique** entre les postes. Deux personnes travaillant sur deux ordinateurs différents ne verront pas les mêmes commandes tant que vous n'aurez pas transféré une sauvegarde de l'une vers l'autre manuellement (voir section 6). Pour un usage multi-postes en temps réel, une évolution vers une base de données réseau ou hébergée sera nécessaire — l'architecture actuelle a été conçue pour permettre cette évolution plus tard sans réécrire l'application, mais elle n'est pas incluse dans cette v1.

## 1. Prérequis (une seule fois)

Installez **Node.js LTS** (version 18 ou supérieure) : https://nodejs.org — choisissez la version "LTS" pour Windows.
Vérifiez l'installation dans une invite de commandes (`cmd` ou PowerShell) :

```
node -v
npm -v
```

## 2. Installation du projet

Dans le dossier `belvie-erp`, ouvrez une invite de commandes puis :

```
npm install
```

Cette commande télécharge les dépendances (React, Electron, SQLite, etc.) — elle nécessite une connexion Internet **une seule fois**. Une fois installées, l'application fonctionne entièrement hors ligne.

> `better-sqlite3` contient du code natif compilé automatiquement lors de `npm install`. Si Windows demande "Build Tools for Visual Studio", installez le paquet proposé par l'invite `npm install --global windows-build-tools` (rare avec les versions récentes de Node, mais possible).

## 3. Lancer l'application en mode développement

```
npm run dev
```

Cela ouvre l'application dans une fenêtre Electron avec rechargement automatique à chaque modification du code — pratique pour tester des ajustements.

## 4. Générer l'installateur Windows (.exe)

Quand vous êtes prêt à distribuer l'application sur d'autres postes :

```
npm run build:win
```

Le fichier d'installation se trouve ensuite dans `release/Belvie ERP Setup <version>.exe`. Double-cliquez dessus sur n'importe quel PC Windows de l'entreprise pour l'installer — aucune connexion Internet requise, aucun compte à créer.

> **Icône de l'application** : le projet référence `build/icon.ico`. Ajoutez votre propre icône (256×256, format `.ico`) à cet emplacement, ou supprimez la ligne `"icon": "build/icon.ico"` dans `package.json` pour utiliser l'icône par défaut d'Electron.

## 5. Où sont stockées les données ?

Le fichier `belvie.db` est créé automatiquement dans le dossier de données de l'utilisateur Windows, typiquement :

```
C:\Users\<votre nom>\AppData\Roaming\belvie-erp\belvie.db
```

C'est un fichier unique : le sauvegarder revient à copier ce fichier.

## 6. Sauvegarde et restauration (dans l'application, onglet Paramètres)

**Sauvegarde manuelle** : cliquez sur "Sauvegarder maintenant" pour créer une copie complète et cohérente de la base à l'endroit de votre choix (clé USB, dossier partagé, etc.), même pendant que l'application est utilisée.

**Sauvegarde automatique** : à chaque fermeture de l'application, une copie de sécurité est créée automatiquement, sans action de votre part, dans :

```
C:\Users\<votre nom>\AppData\Roaming\belvie-erp\backups\auto\
```

Seules les **5 sauvegardes automatiques les plus récentes** sont conservées — les plus anciennes sont supprimées automatiquement. Cette sauvegarde automatique s'ajoute à la sauvegarde manuelle, elle ne la remplace pas.

**Restauration** : "Restaurer depuis un fichier" remplace les données actuelles par celles d'un fichier `.db` choisi — vous pouvez pointer aussi bien vers une sauvegarde manuelle que vers un fichier du dossier `backups\auto\`. Par sécurité, une copie de la base actuelle est automatiquement conservée (suffixe `.avant-restauration-<date>.bak`) à côté de `belvie.db` avant tout remplacement, au cas où.

Recommandation simple : en plus des sauvegardes automatiques locales, copiez de temps en temps une sauvegarde manuelle sur un support externe ou un cloud de stockage de fichiers (Google Drive, OneDrive...) — l'application elle-même ne dépend d'aucun service en ligne, cette copie externe est une protection contre la panne ou le vol de l'ordinateur.

## 7. Architecture du projet (pour la suite)

```
belvie-erp/
├── electron/              → processus principal (accès disque, base de données, fenêtre)
│   ├── main.js             → point d'entrée Electron, déclare tous les canaux IPC
│   ├── preload.js          → pont sécurisé exposé au renderer (window.api)
│   ├── db/                 → schéma SQL, connexion, données de démonstration
│   └── ipc/                → logique métier par domaine (commandes, étapes, système)
├── src/                    → interface (React + TypeScript)
│   ├── modules/
│   │   ├── commandes/      → module Commandes de production (v1)
│   │   └── settings/       → paramètres de l'application
│   └── shared/             → types partagés, listes déroulantes
└── package.json
```

**Pour ajouter un futur module (Stock, Qualité, Planning...)** :
1. Créer une table dans `electron/db/schema.sql`, en référençant `commandes.id` (jamais `numero`) si un lien avec une commande est nécessaire.
2. Créer `electron/ipc/<module>.js` avec les mêmes conventions que `commandes.js`.
3. Déclarer les nouveaux canaux dans `electron/main.js` et les exposer dans `electron/preload.js`.
4. Créer `src/modules/<module>/` côté interface, et ajouter une entrée dans `NAV_ITEMS` (`src/App.tsx`).

Chaque module reste ainsi indépendant tout en partageant la même base de données et le même identifiant technique (`id`) pour se relier aux commandes.

## 8. Identifiants d'une commande — pourquoi deux ?

- `id` (entier interne) et `uuid` : jamais affichés, utilisés uniquement par le code pour relier les données entre modules. Stables, jamais modifiés.
- `numero` (ex. `CMD-2026-001`) : généré automatiquement à la création (compteur remis à zéro chaque année), c'est le seul identifiant que votre équipe voit et utilise.

## 9. Listes déroulantes (produits, couleurs, responsables, ateliers, tailles)

Ces cinq listes sont gérées **en base de données**, pas dans le code :
- Produit, responsable et atelier : bouton "+" dans le formulaire pour ajouter une valeur à la volée. Couleur : même principe, mais directement dans le panneau de sélection de la grille (voir section 11).
- Tailles : gérées uniquement depuis Paramètres (pas d'ajout à la volée depuis le formulaire), avec un ordre d'affichage personnalisable (flèches ▲▼) — S, M, L... doivent s'afficher dans cet ordre, pas alphabétiquement.
- Depuis Paramètres, chaque liste peut être gérée en détail : renommer une valeur, la désactiver (elle disparaît des nouvelles commandes mais reste visible sur l'historique), ou la réactiver.
- Un doublon est automatiquement détecté à la casse et aux espaces près (« Sami », « sami », « SAMI  » sont considérés comme la même valeur) et refusé avec un message clair.

## 10. Migration automatique depuis une version antérieure

Chaque mise à jour convertit automatiquement vos données existantes au premier lancement, sans action de votre part et sans perte :
- Ancien modèle texte (Produit/Couleur/Responsable en texte libre) → listes administrables + Atelier par défaut.
- Ancien modèle "une couleur, une quantité" par commande → converti en une ligne dans la nouvelle grille couleur × taille (couleur d'origine, taille non renseignée, quantité d'origine). Vous pouvez ensuite éditer ces commandes pour leur ajouter de vraies tailles si besoin.
- Chaque migration qui reconstruit une table se déroule dans une transaction unique (tout ou rien) ; aucune commande existante n'est jamais perdue.

**Sécurité supplémentaire** : avant chaque migration qui reconstruit une table (celles qui touchent aux listes administrables, aux tailles ou aux articles), l'application crée automatiquement une copie de sécurité du fichier de base dans :

```
C:\Users\<votre nom>\AppData\Roaming\belvie-erp\backups\pre-migration\
```

Après la reconstruction, l'application vérifie explicitement (`PRAGMA foreign_key_check`) qu'aucune incohérence n'a été introduite. Si un problème est détecté, la copie de sécurité est restaurée automatiquement à la place du fichier modifié, et un message clair est affiché — vos données ne sont jamais laissées dans un état à moitié migré. Ces sauvegardes automatiques de migration s'ajoutent aux sauvegardes manuelles et automatiques déjà décrites en section 6 ; vous pouvez les supprimer manuellement une fois une mise à jour confirmée stable.

Pour suivre en détail le déroulement des migrations (utile en cas de problème), consultez la console du processus principal (le terminal où vous avez lancé `npm run dev`, ou les journaux de l'application une fois installée) : chaque étape est nommée et journalisée individuellement (`[migration] -> Debut : ...` / `[migration] OK Termine avec succes : ...`).

## 11. Grille couleur × taille

- Dans le formulaire, cochez uniquement les couleurs et tailles concernées par la commande — le tableau de saisie ne fait apparaître que ces lignes/colonnes.
- Les totaux (par couleur, par taille, total général) se calculent automatiquement à chaque saisie ; la quantité totale de la commande n'est jamais saisie directement.
- Navigation clavier : flèches pour se déplacer entre les cases, Entrée pour descendre à la ligne suivante.
- Décocher une couleur ou une taille qui contient déjà des quantités déclenche une confirmation avant d'effacer ces valeurs.
- Une nouvelle couleur peut être ajoutée directement depuis le panneau "Couleurs" du formulaire (bouton "+ Ajouter une couleur").
- Le tableau principal des commandes n'affiche qu'un résumé ("3 couleurs • 5 tailles • 420 pièces") ; cliquez sur une commande pour voir le détail complet de la répartition.
