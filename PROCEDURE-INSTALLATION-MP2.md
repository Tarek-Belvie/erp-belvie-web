# Installation de MP2 — procédure et retour arrière

Vous venez d'installer la version cumulative **MP1 + B3**. MP2 se pose par-dessus, et c'est
l'installation la plus simple de la série : **elle ne touche pas à la base.**

---

## 1. Ce que cette installation change

`Belvie-ERP-MP2.zip` est **cumulatif** : le projet complet, lot A + MP1 + B3 + MP2, sans dossier
racine.

**Aucune migration.** MP2 n'ajoute ni table ni colonne. Tout ce qu'il écrit — `bc_mp`,
`bc_mp_lignes`, `bc_mp_ligne_productions`, `compteurs_bc_mp` — existe depuis MP1.

```
Au premier démarrage : AUCUNE ligne [migration]
```

Si vous en voyez, c'est que votre base n'avait pas reçu une migration antérieure ; elle
s'appliquera alors, et c'est sans danger — elles sont toutes purement additives.

### Les fichiers qui changent par rapport à MP1 + B3

```
nouveaux   electron/ipc/preparationBcMp.js                        le regroupement, en LECTURE SEULE
           src/modules/approvisionnement/PreparationBons.tsx      l'écran de préparation
           src/modules/approvisionnement/BonsListe.tsx            le suivi des bons
           src/modules/approvisionnement/BonDetail.tsx            un bon, modifiable

modifiés   electron/ipc/bcMp.js                   création groupée, répartition par poids, correctif
           electron/main.js                       3 canaux de plus
           electron/preload.js                    3 passerelles de plus
           src/global.d.ts                        déclaration de l'API
           src/modules/approvisionnement/ApprovisionnementPage.tsx   les deux onglets
           src/modules/approvisionnement/approvisionnementTypes.ts   types et styles MP2
```

Aucun autre fichier du projet ne bouge.

---

## 2. Installation

### Étape A — relever les besoins, avant de toucher à quoi que ce soit

```cmd
cd /d C:\Users\User\Documents\GitHub\VOTRE-DOSSIER
set ELECTRON_RUN_AS_NODE=1
npx electron verifier-besoins.js besoins-avant-mp2.txt
```

Application fermée (`Ctrl + C`). Le script **lit seulement**.

### Étape B — la sauvegarde

```cmd
xcopy "%APPDATA%\belvie-erp" "%USERPROFILE%\Desktop\belvie-sauvegarde-donnees-mp2" /E /I /H /Y
```

Et copiez votre dossier de projet sur le Bureau sous le nom `belvie-sauvegarde-code-mp1-b3`
(vous pouvez exclure `node_modules`, il se réinstalle avec `npm install`).

**Ne sautez pas la sauvegarde du code :** c'est elle qui rend le retour arrière immédiat, et comme
MP2 ne touche pas la base, c'est la seule dont vous aurez besoin en pratique.

> Rappel du défaut connu : la sauvegarde **automatique** de l'application ne copie que la base et
> `images\commandes`. Vos croquis techniques, photos de fournitures et logo n'y sont pas. La
> sauvegarde manuelle ci-dessus, elle, copie tout.

### Étape C — extraire

1. Clic droit sur `Belvie-ERP-MP2.zip` → **Extraire tout…**
2. Destination : **votre dossier de projet**, celui qui contient `package.json`.
3. Acceptez le remplacement.

**Contrôle avant de lancer quoi que ce soit :**

| Fichier | Doit |
|---|---|
| `electron\ipc\preparationBcMp.js` | **exister** (nouveau) |
| `src\modules\approvisionnement\PreparationBons.tsx` | **exister** (nouveau) |
| `electron\db\migrationsBonsMp.js` | **exister** (déjà là depuis MP1) |

Si l'un des trois manque, l'extraction ne s'est pas faite au bon endroit. Recommencez l'étape C,
**ne lancez pas l'application**.

### Étape D — démarrer

`electron\preload.js` est modifié, et **il n'est jamais rechargé à chaud**. Si l'application
tourne encore, arrêtez-la complètement.

```cmd
npm run dev
```

Attendu : **aucune ligne de migration**.

**Si les nouveaux écrans affichent un message d'erreur parlant de `preload.js`**, c'est que
l'application n'a pas été arrêtée complètement. Ctrl + C, puis relancez. Le message le dit
lui-même, c'est pour cela qu'il est écrit ainsi.

### Étape E — relever les besoins APRÈS, et comparer

```cmd
set ELECTRON_RUN_AS_NODE=1
npx electron verifier-besoins.js besoins-apres-mp2.txt

findstr /B "BESOIN COMMANDE TOTAL" besoins-avant-mp2.txt > avant-chiffres.txt
findstr /B "BESOIN COMMANDE TOTAL" besoins-apres-mp2.txt > apres-chiffres.txt
fc avant-chiffres.txt apres-chiffres.txt
```

**Résultat attendu : `FC: aucune différence trouvée`.**

MP2 ne change aucun calcul de besoin. **Tant que vous n'avez créé aucun brouillon**, les chiffres
doivent être rigoureusement identiques. Après avoir créé un brouillon, « en préparation » et
« reste à préparer » bougeront — c'est voulu — mais **« nécessaire » et « commandé » ne doivent
jamais bouger**.

### Étape F — les tests fonctionnels

Les groupes M, C, B et R sont dans `LIVRAISON-MP2.md`, livré à la racine du projet. Le groupe M
est celui qui compte.

---

## 3. Retour arrière

### Le code seul suffit — et ici c'est certain

MP2 **n'a modifié ni table ni colonne**. Il n'y a donc rien à défaire dans la base : revenir au
code de MP1 + B3 suffit, et vos données sont exactement dans l'état où elles étaient.

1. `Ctrl + C` pour arrêter l'application.
2. Supprimez le contenu du dossier de projet, **sauf `node_modules`**.
3. Recopiez-y `belvie-sauvegarde-code-mp1-b3`.
4. `npm run dev`.

### Et les brouillons déjà créés ?

Ils restent en base, dans les tables `bc_mp`. Le code de MP1 + B3 ne les affiche pas — il n'a pas
d'écran pour cela — mais **il les compte** : le moteur de besoins lit les brouillons depuis MP1,
donc les colonnes « En préparation » et « Reste à préparer » continueront de les refléter dans
l'écran des besoins.

C'est cohérent, et c'est voulu. Si vous préférez repartir d'une table vide, application fermée et
après sauvegarde :

```sql
DELETE FROM bc_mp_ligne_productions;
DELETE FROM bc_mp_lignes;
DELETE FROM bc_mp;
DELETE FROM compteurs_bc_mp;
```

Ces quatre tables ne sont lues par rien d'autre, et **aucune table financière n'y fait référence** —
c'est précisément ce que vérifient les contrôles d'empreinte. Les vider ne peut donc pas altérer
un coût, une dette ni un stock.

### Restaurer aussi les données, si vous le souhaitez malgré tout

1. Fermez complètement l'application — **impératif** : Windows verrouille le fichier de base tant
   qu'une connexion SQLite est ouverte.
2. Renommez `%APPDATA%\belvie-erp` en `belvie-erp-ancien` — **ne supprimez rien**.
3. Recopiez `belvie-sauvegarde-donnees-mp2` sous le nom `%APPDATA%\belvie-erp`.
4. Relancez.

---

## 4. Récapitulatif des commandes

```cmd
:: --- AVANT ----------------------------------------------------------------
cd /d C:\Users\User\Documents\GitHub\VOTRE-DOSSIER
set ELECTRON_RUN_AS_NODE=1
npx electron verifier-besoins.js besoins-avant-mp2.txt
xcopy "%APPDATA%\belvie-erp" "%USERPROFILE%\Desktop\belvie-sauvegarde-donnees-mp2" /E /I /H /Y
:: + copier le dossier du projet : belvie-sauvegarde-code-mp1-b3

:: --- EXTRAIRE Belvie-ERP-MP2.zip DANS LE DOSSIER DU PROJET -----------------
:: contrôle : preparationBcMp.js et PreparationBons.tsx existent

:: --- APRÈS ----------------------------------------------------------------
npm run dev
:: AUCUNE ligne de migration attendue, puis Ctrl + C

set ELECTRON_RUN_AS_NODE=1
npx electron verifier-besoins.js besoins-apres-mp2.txt
findstr /B "BESOIN COMMANDE TOTAL" besoins-avant-mp2.txt > avant-chiffres.txt
findstr /B "BESOIN COMMANDE TOTAL" besoins-apres-mp2.txt > apres-chiffres.txt
fc avant-chiffres.txt apres-chiffres.txt
```

Résultat attendu : **FC: aucune différence trouvée**.

---

## 5. Ce que cette installation ne fait pas

- **Aucune écriture financière.** Ni `achats`, ni `achats_factures`, ni `achats_receptions`, ni
  `paiements`, ni `prix_fournisseurs`, ni `estimations`. Vérifié par trois contrôles — deux
  empreintes de 13 tables, et une lecture du code source du module de préparation.
- **Aucun bon ne peut être validé.** La validation, les engagements et le PDF sont MP3.
- **Le calcul des stocks n'est pas modifié.** La correction de `stockDisponibleMatiere` est prévue
  pour MP3, et vous sera présentée avant d'être faite, avec le traitement des anciens achats sans
  réception enregistrée.
- **Les quatre fichiers mal placés** (`electron\ipc\BesoinsPage.tsx`,
  `electron\ipc\FTDescriptionTab.tsx`, `electron\ipc\FTTaillesSelector.tsx`,
  `src\modules\ficheTechnique\ficheTechniquePdf.js`) sont toujours là. Ils sont inoffensifs —
  aucun n'est chargé par le processus principal — et je ne les ai pas déplacés pour ne pas mêler
  un rangement à une livraison fonctionnelle.
