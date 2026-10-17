# B3 — les coloris de fournitures

**334 contrôles automatiques, 0 échec** (298 avant B3 : aucune régression, 36 nouveaux).
**Aucune migration**, **aucune écriture financière**. MP2 et MP3 ne sont pas commencés.

---

## Installation

`Belvie-ERP-B3.zip` **sans dossier racine**, à extraire **à l'intérieur** de votre dossier de
projet. Procédure complète, sauvegardes et retour arrière : `PROCEDURE-INSTALLATION-ET-VERIFICATION.md`.

**Aucune ligne de migration ne doit apparaître au démarrage.** La colonne nécessaire
(`ft_fourniture_couleurs.consommation_par_piece`) existait déjà depuis l'étape 1 ; B3 ne fait que
la rendre accessible. Si votre base est à jour, rien ne change en base.

`electron/preload.js` est modifié : **arrêtez complètement l'application (Ctrl+C) avant de la
relancer.** Un rechargement à chaud ne reprend pas ce fichier, et les nouveaux boutons resteraient
sans effet.

---

## 1. Le chiffre

Un zip qui change avec la couleur du produit, sur une production de 450 noirs et 130 marine :

```
Avant B3 — deux lignes de fourniture (le seul contournement possible)
  Zip noir    : 580 pièces      ← consomme sur la production ENTIÈRE
  Zip marine  : 580 pièces      ← idem
  Total       : 1 160

Après B3 — une ligne, deux coloris déclarés
  Zip central / Noir    : 450
  Zip central / Marine  : 130
  Total                 : 580
```

Les deux chiffres sont mesurés par le contrôle `B3-0` et les contrôles `B3-1` à `B3-4`, sur la même
base et le même moteur. **Le moteur de calcul n'a pas été modifié** : il savait déjà répartir un
besoin par coloris de fourniture. Ce qui manquait, c'était de pouvoir le saisir.

---

## 2. Ce qui change dans l'écran

Onglet **Fournitures** de la fiche technique, à l'ouverture d'une ligne, un bloc
**« Coloris par couleur produit »** :

```
COLORIS PAR COULEUR PRODUIT
Chaque couleur produit lancée en production doit être déclarée ici. Si l'une manque,
Approvisionnement signale son besoin comme incomplet au lieu de l'estimer.

  Noir    →  [Noir             ]  [ZIP-N    ]  [      ]  conso. de la ligne   ✕
  Marine  →  [Marine           ]  [ZIP-M    ]  [  2   ]  pièce/pièce          ✕
  Beige   →  [Coloris à préciser] [Référence]  [      ]  conso. de la ligne   ✕
  + Ajouter un coloris
```

Et sur la ligne fermée, une pastille **« 3 coloris »** : l'information qui change le besoin calculé
se voit sans avoir à ouvrir la carte.

**Quatre champs, quatre rôles distincts :**

| Champ | Ce qu'il fait |
|---|---|
| Couleur produit | Vient du **même référentiel que vos quantités de commande**. C'est ce qui permet au calcul de rapprocher un coloris d'une quantité réellement lancée. |
| Coloris de la fourniture | **Texte libre** — un zip noir n'a pas de nuancier fournisseur à référencer. C'est la différence assumée avec les matières. |
| Référence | Propre à cette déclinaison, si elle diffère de celle de la ligne. |
| Conso. / pièce | **Facultative.** Vide, la consommation de la ligne s'applique. Renseignée, elle prime pour cette couleur-là. |

La création d'une couleur produit à la volée (le bouton `+`) réutilise **le mécanisme existant**,
celui de l'onglet Matières et du formulaire de commande : une couleur désactivée du même nom est
réactivée avec son identifiant d'origine, jamais dupliquée.

---

## 3. La règle à connaître avant de saisir

**Tant qu'aucun coloris n'est déclaré**, la fourniture est commandée toutes couleurs confondues.
C'est l'état actuel de toutes vos fournitures : **rien ne change pour elles.**

**Dès qu'un seul coloris est déclaré**, chaque couleur produit lancée en production doit l'être
aussi. Une couleur oubliée n'est **pas** estimée en silence : sa ligne s'affiche
`À définir (Marine)` avec l'anomalie « correspondance des coloris » dans Approvisionnement, et sa
quantité reste visible (contrôles `B3-9`, `B3-10`, `B3-10b`). C'est exactement le comportement
déjà en place pour les matières.

Un coloris déclaré mais **non précisé** est traité à part : la ligne affiche
`Coloris à choisir (Noir)`, la quantité reste calculée, et le besoin est signalé. C'est la
distinction que vous aviez demandée entre « impossible à calculer » et « calculable, coloris
inconnu ».

---

## 4. Ce qui a été vérifié — 36 contrôles

### Le calcul, 9 contrôles
Le contournement à 1 160 et la bonne modélisation à 580, mesurés côte à côte. Une consommation
propre à un coloris prime bien (130 × 2 = 260) pendant que l'autre couleur garde celle de la ligne
(450 × 1). La règle appliquée est **nommée ligne par ligne** : `couleur` pour Marine, `fixe` pour
Noir.

### Les garde-fous, 9 contrôles
Une consommation **nulle ou négative est refusée à la saisie**, avec un message qui dit quoi faire.
Enregistrée, elle aurait voulu dire « cette couleur ne consomme rien », ce qui n'est jamais ce
qu'on veut exprimer en laissant un champ à 0. Un doublon de couleur produit est refusé. Une couleur
hors référentiel est refusée. Un coloris saisi en espaces vaut « non précisé », pas une chaîne
vide. **Le champ vide efface la consommation sans la remplacer par zéro** — c'est la seule façon de
revenir en arrière.

### La fiche validée, 3 contrôles
Ajout, modification et suppression d'un coloris sont **refusés sur une fiche validée**. Le chemin
reste « Modifier la nomenclature », avec sa révision et son gel des productions en cours.

### L'absence d'écriture financière, 1 contrôle décisif
Une empreinte de **11 tables** — dont `achats`, `achats_affectations`, `achats_factures`,
`paiements`, `prix_fournisseurs`, `estimations`, `bc_mp`, `commandes` — est prise avant, puis après
avoir créé un coloris, l'avoir modifié, recalculé les besoins et l'avoir supprimé. Elle est
**identique**. Votre décision « ne pas modifier les écritures financières pendant B3 et MP2 » est
tenue, et vérifiée, pas seulement affirmée.

### La compatibilité, 4 contrôles
`listAccessoires` **conserve toutes ses colonnes existantes** et ajoute `couleurs` à côté : le PDF
de la fiche et le document atelier lisent exactement ce qu'ils lisaient. Une fourniture sans
coloris rend un tableau vide, jamais `undefined`. Supprimer une fourniture emporte ses coloris
(cascade du schéma, vérifiée et non supposée).

### L'écran, vérifié en l'affichant
L'onglet a été monté dans un navigateur et photographié : le bloc s'affiche, le formulaire d'ajout
s'ouvre, **aucun débordement horizontal**, et en lecture seule il ne reste **aucun champ actif,
aucune croix de suppression, aucun bouton d'ajout**. Une consommation négative saisie dans le champ
**revient à la valeur enregistrée** et affiche le refus — elle ne reste pas à l'écran comme si elle
avait été acceptée.

---

## 5. Deux corrections de dette, au passage

`src/global.d.ts` ignorait **toute l'API des matières de la fiche** (`addMatiere`,
`listMatiereCouleurs`, `updateMatiereCouleur`…) et le troisième argument de
`searchAccessoiresCatalogue`. Ces fonctions marchaient, elles n'étaient simplement pas déclarées :
**13 erreurs de type sur 54**, toutes dans `FTMatieresTab`. Les déclarer m'a coûté vingt lignes et
n'a **rien changé au comportement** — aucune signature n'est inventée, chacune reprend celle du
preload et du handler.

**54 → 41 erreurs de type.** Les 41 restantes sont l'ancienne dette, intacte et sans rapport :
gradations, mesures, sélecteur de tailles.

---

## 6. Et maintenant

B3 lève le blocage annoncé à MP1 : **vous pouvez générer des bons définitifs pour un article dont
une fourniture se décline par couleur**, à condition d'avoir déclaré ses coloris.

La suite, comme convenu, avec une validation distincte à chaque étape :

- **MP2** — l'écran de préparation : sélectionner plusieurs productions, regrouper leurs besoins,
  attribuer un fournisseur par ligne, ajuster quantités et conditionnements, enregistrer en
  brouillon. Plus l'écran de suivi des bons. **Aucune écriture financière.**
- **MP3** — la validation, les écritures, et le PDF. Je vous présenterai avant : les modifications
  du calcul des stocks, et le **traitement des anciens achats sans réception enregistrée**, pour
  qu'aucun stock existant ne diminue artificiellement.

---

# Tests manuels

## Groupe C — les coloris *(le plus important)*

- **C1** Fiche technique d'un article bicolore → onglet **Fournitures** → ouvrez le zip →
  « Ajouter un coloris » → choisissez une couleur produit, saisissez le coloris → **Ajouter**.
  Recommencez pour la seconde couleur.
- **C2** Approvisionnement → cette production → le zip doit maintenant donner **deux lignes**, une
  par couleur, dont la somme vaut la quantité produite — et non le double.
- **C3** Supprimez un des deux coloris : la couleur correspondante doit passer à
  **« À définir (…) »** avec son anomalie, sa quantité restant visible. **Elle ne doit jamais
  disparaître ni être estimée.**
- **C4** Laissez le champ coloris vide sur une ligne : elle doit afficher
  **« Coloris à choisir (…) »**, pas une ligne muette.
- **C5** Saisissez `-2` dans la consommation d'un coloris : la saisie doit être **refusée** et le
  champ **revenir à sa valeur précédente**.
- **C6** Renseignez une consommation sur **un seul** coloris : cette couleur doit utiliser cette
  valeur, l'autre garder celle de la ligne.

## Groupe V — la fiche validée

- **V1** Sur une fiche **validée**, le bloc des coloris doit être **entièrement en lecture seule** :
  aucun champ modifiable, aucune croix, pas de bouton « Ajouter un coloris ».
- **V2** « Modifier la nomenclature » → le bloc redevient modifiable, et les productions déjà
  décidées **gardent leurs anciens coloris** (c'est le gel du lot A, inchangé).

## Groupe R — non-régression

- **R1** Fournitures : désignation, emplacement, référence, consommation, unité, photo — **inchangés**.
- **R2** Matières : l'onglet et ses coloris — **inchangés**.
- **R3** Approvisionnement : les matières ne doivent avoir **aucun chiffre modifié**. Relancez
  `verifier-besoins.js` avant et après si vous voulez la preuve mécanique.
- **R4** Finance : coût d'une commande, dette d'un fournisseur, synthèse — **aucun changement**.
- **R5** PDF de la fiche technique et document atelier — **inchangés**.
