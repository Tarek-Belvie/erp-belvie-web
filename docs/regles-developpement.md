# Règles de développement — PROJET À VALIDER ENSEMBLE

> Statut : **proposition** (17/10/2026). Chaque règle porte un identifiant pour pouvoir en discuter (« on garde D7, on assouplit D12… »). Une fois validées, ces règles s'appliquent à tout le code, et la CI fait respecter celles qui peuvent l'être automatiquement (marquées 🤖).

Les **règles métier** (calculer jamais recopier, rien de silencieux, rien de rétroactif…) restent celles de [modules/00-principes-transverses.md](modules/00-principes-transverses.md) (R0.1 à R0.7). Ce document-ci porte sur **la façon de travailler sur le code**.

---

## 1. Organisation du travail

- **D1 — Une branche par sujet, une pull request par branche.** On ne pousse jamais directement sur `main`. Une PR fait une seule chose (une fonctionnalité, une correction) et reste petite : idéalement moins de 400 lignes modifiées hors fichiers générés.
- **D2 — `main` est toujours déployable.** 🤖 La CI (lint, fichiers générés à jour, migrations, tests, construction de l'interface) doit être verte pour fusionner.
- **D3 — Relecture obligatoire.** Toute PR est relue par une autre personne (ou, à défaut, relue le lendemain par son auteur avec la liste de contrôle du §8) avant fusion.
- **D4 — Messages de commit en français, à l'impératif, qui disent pourquoi** : `Valider un BC MP crée les engagements (MP3)`, pas `fix` ou `wip`.
- **D5 — Le besoin avant le code.** Une évolution métier commence par une note dans `docs/modules/<module>.md` (règle, statut 🟦/🟨, cas limites). Le code vient ensuite, et la PR met le statut de la règle à ✅.

## 2. Architecture

- **D6 — Trois couches, sans court-circuit.** Écran React → `window.api` (client généré) → route du registre → fonction de `src/modules`. Une route ne contient **aucune** règle métier. Un écran n'appelle jamais `fetch` directement (sauf dans `src/api/client.ts`).
- **D7 — Le registre est la source unique de l'API.** 🤖 Une nouvelle fonction exposée = une ligne dans `apps/api/src/routes/registre.js`, puis `npm run generer --workspace apps/api`. La CI refuse un registre et des fichiers générés désynchronisés.
- **D8 — Un fichier de module = un domaine.** Une fonction métier vit dans le module de son domaine. Si un module dépasse ~1 500 lignes (c'est déjà le cas de `ficheTechnique.js` et `finance.js`), on le découpe en sous-dossier `modules/<domaine>/` en même temps qu'on le modifie. On ne fait jamais de découpage « au passage » dans une PR fonctionnelle.
- **D9 — Une règle n'existe qu'à un endroit** (R0.2). Avant d'écrire un calcul, chercher s'il existe déjà (`calculerPourCommande`, `coutCommande`, `repartirParPoids`…).
- **D10 — Pas de code mort.** Un fichier, une fonction ou un composant inutilisé est supprimé (l'historique Git le garde). Aucun doublon de fichier « au cas où ».

## 3. Base de données

- **D11 — Accès uniquement par `src/db`.** Aucun module n'importe `pg`. Toutes les requêtes sont paramétrées (`?` ou `@nom`) : **jamais** de valeur concaténée dans le SQL (seuls des noms de colonnes issus d'une liste blanche peuvent l'être).
- **D12 — Migrations : jamais modifiées, toujours ajoutées.** 🤖 Un nouveau fichier `apps/api/migrations/NNN_description.sql` par changement de schéma. Le lanceur refuse de démarrer si une migration appliquée a été modifiée.
- **D13 — Migrations prudentes.** Une migration qui touche des données existantes (UPDATE, DELETE, changement de type) est présentée avant d'être écrite, accompagnée d'une requête de contrôle avant/après, et testée sur une copie de la base réelle.
- **D14 — Atomicité** (R0.6). Toute écriture multi-tables passe par `db.transaction(async () => …)`. Rappel PostgreSQL : dans une transaction, une requête en erreur annule toute la transaction. Un `try/catch` autour d'une requête qui peut échouer doit donc être placé dans un `db.transaction` imbriqué (SAVEPOINT).
- **D15 — Lectures en lecture seule.** Une fonction appelée par une route `lecture: true` ne doit jamais écrire (la connexion en lecture seule le refuserait de toute façon). Une fonction « get-or-create » est une écriture (`lecture: false`).
- **D16 — Tri déterministe.** Tout `ORDER BY` d'une liste affichée se termine par une clé unique (en général `id`), pour que l'ordre ne dépende jamais du moteur.

## 4. Code JavaScript / TypeScript

- **D17 — Asynchrone partout, sans oubli.** 🤖 Toute fonction qui touche la base est `async` et chaque appel est `await`. ESLint (`no-floating-promises`, `no-misused-promises`) bloque la CI. **Interdit** : `tableau.forEach(async …)` ; utiliser `for…of`, ou `mapSeq`/`filterSeq` (`src/lib/asyncArray.js`).
- **D18 — Erreurs métier = `throw new Error("message pour l'utilisateur")`.** Le message est en français, compréhensible par un utilisateur, et dit quoi faire. Il est renvoyé tel quel (HTTP 400). Une erreur technique ne doit jamais atteindre l'utilisateur avec ses détails : elle est journalisée et renvoie un 500 générique.
- **D19 — Nommage en français**, cohérent avec le métier et le schéma existants (`commande`, `fiche`, `besoin`, `engagement`). Identifiants techniques en anglais seulement s'ils viennent d'une bibliothèque.
- **D20 — Commentaires : le pourquoi, pas le quoi.** On commente une règle métier, une contrainte, un piège. On ne paraphrase pas le code.
- **D21 — Interface typée.** Les nouveaux écrans sont en TypeScript sans `any` nouveau. Dette existante : 34 erreurs `tsc` héritées (types `global.d.ts` non à jour) ; objectif : les résorber, puis rendre `tsc` bloquant en CI.

## 5. Tests

- **D22 — Pas de fonctionnalité sans test.** Toute nouvelle règle métier a au moins un test qui échouerait sans elle, cas limites et refus compris (`apps/api/test/`).
- **D23 — Non-régression ancien/nouveau.** Tant que la version Electron sert de référence, les scénarios `test/differentiel` doivent rester à **zéro écart**. Une évolution volontaire de comportement (par rapport à la 1.0.1) est retirée du différentiel et couverte par un test classique, avec une mention dans la PR.
- **D24 — Les données réelles ne quittent pas le serveur.** Aucune copie de la base réelle, aucune photo, aucun fichier `.env` dans Git ou dans un ticket. 🤖 (`.gitignore`). Les tests construisent leurs données eux-mêmes.

## 6. Sécurité

- **D25 — Secrets uniquement en variables d'environnement.** Jamais dans le code, la documentation ou une conversation. Un secret exposé est régénéré immédiatement.
- **D26 — Contrôle d'accès côté serveur.** Masquer un bouton ne protège rien : une action réservée (`admin`) est vérifiée dans la route.
- **D27 — Dépendances : versions figées** (`package-lock.json`), mises à jour par PR dédiée, une fois par mois, avec `npm audit`.

## 7. Déploiement et exploitation

- **D28 — Déploiement depuis `main` uniquement**, après CI verte. Tout est sur Vercel (automatique sur `main`) ; les migrations sont appliquées à la fin du build de production ([deploiement.md](deploiement.md)).
- **D29 — Sauvegarde avant toute opération risquée** (migration de données, reprise, restauration) : GitHub → Actions → « Sauvegarde de la base » → *Run workflow*, puis vérifier dans Paramètres → Sauvegardes.
- **D30 — Une restauration s'entraîne.** Une fois par trimestre, restaurer la dernière sauvegarde R2 dans une base de test et vérifier les comptages (procédure : [exploitation/sauvegarde-restauration.md](exploitation/sauvegarde-restauration.md)).
- **D31 — Une migration reste compatible avec la version précédente du code.** Pendant le build, puis en cas de retour arrière Vercel, l'ancienne version tourne sur le schéma déjà migré. On ajoute (table, colonne avec valeur par défaut) dans une version ; on ne supprime ni ne renomme qu'une version plus tard, quand plus aucun code ne s'en sert.

## 8. Liste de contrôle d'une pull request

- [ ] Le besoin est décrit dans `docs/modules/…` (règle + statut mis à jour).
- [ ] Le registre et les fichiers générés sont à jour (`npm run generer`).
- [ ] Toute écriture multi-tables est dans une transaction ; les erreurs attendues dans une transaction sont dans un SAVEPOINT.
- [ ] Les `ORDER BY` se terminent par une clé unique.
- [ ] Les tests couvrent le nominal, les refus et les cas limites ; `npm test` est vert.
- [ ] Les nouvelles migrations sont additives (sinon : présentées et testées sur une copie de la base réelle).
- [ ] Aucun secret, aucune donnée réelle dans le diff.
- [ ] Les messages d'erreur sont compréhensibles par un utilisateur.

---

### Points à trancher ensemble

1. **D3** : qui relit ? (Tarek / Zied / relecture croisée systématique ?)
2. **D8** : faut-il planifier tout de suite le découpage de `ficheTechnique.js` (1 800 lignes) et `finance.js` (1 150 lignes) ?
3. **D21** : délai pour résorber les erreurs TypeScript et rendre `tsc` bloquant ?
4. **D23** : à partir de quand abandonne-t-on la version Electron comme référence (fin de la recette web) ?
5. Faut-il un environnement de **préproduction** (copie de la base réelle anonymisée) avant chaque mise en production ?
