# Mise à jour 1.0.0 → 1.0.1 — accès aux bons de commande MP

**580 contrôles automatiques, 0 échec** (571 en 1.0.0 : aucune régression, 9 nouveaux).
**Aucune migration de base. Aucune modification du moteur de calcul. Aucun écran refondu.**

---

## 1. Diagnostic : vos quatre questions

### 1.1 Le moteur MP2 est-il réellement présent ?

**Oui, entièrement.** Vérifié fichier par fichier dans la version que vous avez installée :

| Couche | État | Détail |
|---|---|---|
| Moteur de regroupement | présent | `electron/ipc/preparationBcMp.js` |
| Création et édition des bons | présent | `electron/ipc/bcMp.js` |
| Canaux IPC | **12 enregistrés** | `bcMp:regrouper`, `creerLot`, `enregistrerPreparation`, `creer`, `get`, `list`, `mettreAJour`, `supprimer`, `ajouterLigne`, `mettreAJourLigne`, `supprimerLigne` |
| Pont `preload.js` | présent | groupe `bcMp` complet |
| Écrans | présents | `PreparationBons.tsx`, `BonsListe.tsx`, `BonDetail.tsx` |

Les 75 contrôles automatiques du moteur (49 sur la préparation, 26 sur les bons) passaient et
passent toujours. **Rien n'était manquant côté calcul.**

### 1.2 Où l'interface était-elle accessible ?

À un seul endroit, et mal placé :

```
Approvisionnement  →  onglet « Bons de commande MP »  →  bouton « Préparer des bons »
```

Le module s'ouvre sur l'onglet **« Besoins »**. L'onglet des bons est le second, et il prend la
forme de deux petits boutons sous le titre. **Depuis l'écran des besoins — c'est-à-dire depuis la
liste des productions, là où vous regardiez — rien n'y menait.** Vous n'avez pas cherché au mauvais
endroit : vous avez cherché au bon.

### 1.3 Ce qui manquait exactement

Pas une fonction : **un chemin.** Et le plus révélateur :

```tsx
// src/modules/approvisionnement/PreparationBons.tsx
const [choisies, setChoisies] = useState<number[]>(commandesInitiales || []);
```

L'écran de préparation **acceptait déjà une liste de productions de départ**. Mais le seul appelant
existant ne lui en passait aucune :

```tsx
onPreparer={() => setRoute({ kind: "preparation" })}   //  ← aucune production transmise
```

Le paramètre d'entrée était prévu, construit, testé — et **jamais alimenté**. Le départ « depuis
les productions » avait été écrit du côté de l'arrivée seulement. C'est un défaut de ma part :
mes contrôles vérifiaient que chaque écran fonctionne, aucun ne vérifiait qu'on puisse l'atteindre.
**C'est corrigé dans les deux sens : le chemin, et les contrôles qui le surveillent** (§ 3).

### 1.4 Comment la génération part désormais des productions

**Deux chemins, selon d'où vous venez** — et l'ancien reste en place.

```
Approvisionnement → Besoins            Commandes de production
   ┌──────────────────────────┐           ┌──────────────────────────┐
   │ ☑ Parka Marine    1160 m │           │  Détail d'une production │
   │ ☑ Parka Noir       450 m │           │  Actions disponibles :   │
   │ ☐ Blouson Gris     220 m │           │  [Préparer un bon MP]    │
   │                          │           └────────────┬─────────────┘
   │ 2 productions            │                        │
   │     [Préparer des bons]──┼────────┐               │
   └──────────────────────────┘        ▼               ▼
                              Préparation des bons de commande MP
                              1 Choisir  ›  2 Regrouper  ›  3 Enregistrer
```

---

## 2. La correction, et rien de plus

Cinq fichiers d'interface. **Aucun fichier du moteur, du calcul des besoins, de la finance ou de
la base n'est touché.**

| Fichier | Ce qui change |
|---|---|
| `BesoinsListe.tsx` | une case à cocher par production, « tout cocher », et une barre d'action qui n'apparaît que lorsqu'une production est cochée |
| `ApprovisionnementPage.tsx` | la sélection ouvre la préparation ; le module accepte une demande venue d'un autre module |
| `App.tsx` | le saut d'un module à l'autre, avec un jeton de demande |
| `CommandesPage.tsx` | fait passer le rappel au détail de la production |
| `CommandeDetailModal.tsx` | le bouton « Préparer un bon de commande MP » dans « Actions disponibles » |
| `approvisionnementTypes.ts` | les quelques règles de style de la barre de sélection |

Trois décisions valent d'être expliquées, parce qu'elles vous concerneront à l'usage :

**Le bouton n'apparaît que pour une production approvisionnable** (validée, en production,
contrôle qualité). Un brouillon ou une commande terminée ne s'approvisionne pas. Et la liste des
statuts est **importée du module d'approvisionnement** plutôt que recopiée : deux définitions de
« production approvisionnable » finiraient par diverger, et la divergence n'apparaîtrait que dans
un bon de commande.

**Une production cochée puis sortie de la vue n'est pas décochée, mais elle n'est pas préparée.**
Le compteur n'annonce que ce qui part réellement. Décocher de force serait une surprise ;
préparer en silence une production qu'on ne voit plus serait un bon de commande inexplicable.

**Le bouton du détail referme la fenêtre avant de changer de module.** Sans cela, la fenêtre de la
production resterait au-dessus de l'écran vers lequel vous venez de partir.

Ce qui **n'est pas** fait, volontairement : MP3 reste entier — pas de validation, pas d'écriture
financière, pas de PDF, pas de correction de stock. Les bons produits sont des **brouillons**,
exactement comme avant.

---

## 3. Les contrôles ajoutés

Neuf contrôles, `P1` à `P9`, qui portent sur le **chemin** et non sur les écrans :

| | Ce qui est vérifié |
|---|---|
| `P1` | la liste des productions propose de préparer des bons, avec des cases à cocher |
| `P2` | et transmet les productions **cochées**, restreintes aux lignes affichées |
| `P3` | la coquille du module ouvre la préparation **sur ces productions** |
| `P4` | l'écran de préparation part réellement d'elles |
| `P5` | le détail d'une production propose son bon MP, et referme la fenêtre |
| `P6` | ce bouton n'apparaît que pour une production approvisionnable, statuts importés |
| `P7` | le passage d'un module à l'autre est câblé **de bout en bout** |
| `P8` | deux demandes successives sur la même production fonctionnent toutes les deux |
| `P9` | **l'ancien chemin par l'onglet des bons n'a pas disparu** |

`P8` mérite un mot : sans jeton de demande, la seconde demande porterait la même valeur que la
première et n'ouvrirait rien. Vous cliqueriez sans effet — le pire des comportements, parce qu'on
ne sait pas s'il faut recliquer ou si l'on s'est trompé.

Et les 580 contrôles au complet confirment qu'aucun calcul, aucune écriture financière et aucun
écran existant n'a bougé.

---

## 4. Installer la mise à jour

**C'est désormais une mise à jour, pas une copie de fichiers.** Vous ne remplacez aucun fichier à
la main.

### Avant

1. **Sauvegarde complète** depuis Paramètres → Données et maintenance. Elle ne sert probablement à
   rien ici — il n'y a aucune migration — mais la règle ne souffre pas d'exception.
2. Fermez l'application installée.

### Fabriquer et installer

3. Remplacez le dossier du **projet** par celui de cette archive (c'est du code, pas vos données :
   vos données sont dans `%APPDATA%\belvie-erp` et ne sont jamais dans l'archive).
4. `npm install` — si des dépendances ont changé.
5. `npm run installateur` → vous obtenez `Belvie-ERP-Setup-1.0.1.exe`.
6. **Lancez-le par-dessus la version installée.** L'assistant met à jour le programme en place.
   Ne désinstallez pas d'abord : c'est inutile, et désinstaller puis réinstaller multiplie les
   occasions de se tromper.

L'icône est déjà figée dans `build\icon.ico` : `npm run icone` n'est pas à refaire.

### Vérifier, en trois minutes

| | Test | Attendu |
|---|---|---|
| **U1** | L'application s'ouvre | vos commandes, articles et fiches sont là, inchangés |
| **U2** | Menu « À propos » ou titre de la fenêtre | version **1.0.1** |
| **U3** | Approvisionnement → Besoins | une **colonne de cases à cocher** à gauche |
| **U4** | Cochez deux productions | une barre verte apparaît : « 2 productions sélectionnées » |
| **U5** | « Préparer des bons de commande MP » | l'écran de préparation s'ouvre, **les deux productions déjà choisies**, à l'étape 2 |
| **U6** | Enregistrez en brouillon | les bons apparaissent dans l'onglet « Bons de commande MP » |
| **U7** | Commandes de production → ouvrez une production validée → « Actions disponibles » | le bouton **« Préparer un bon de commande MP »** |
| **U8** | Cliquez-le | la fenêtre se referme, l'écran de préparation s'ouvre sur **cette seule** production |
| **U9** | Revenez aux commandes et recliquez sur **la même** production | l'écran s'ouvre **de nouveau** (c'est `P8`) |
| **U10** | Ouvrez un **brouillon** de production | **pas** de bouton MP — un brouillon ne s'approvisionne pas |

**U5 et U8 sont les deux qui comptent** : ce sont eux qui prouvent que la production est
réellement transmise, et pas seulement que l'écran s'ouvre.

### Si quelque chose ne va pas

Réinstallez `Belvie-ERP-Setup-1.0.0.exe`, conservé dans `release\installateurs\`. Vos données ne
sont pas concernées : **cette mise à jour ne touche pas la base**, il n'y a donc rien à défaire.

---

## 5. Les prochaines livraisons

Comme vous le demandez, chaque livraison sera désormais **une version de l'application** —
numérotée, installée par-dessus la précédente, l'installateur précédent conservé pour revenir en
arrière. Plus de remplacement manuel de fichiers isolés.

Ce que cela ne devient pas encore : une mise à jour **automatique**. Il faudrait publier les
versions quelque part et les signer, et la signature est précisément la question ouverte du
§ 0.1 de la note du lot 3. Tant qu'elle n'est pas tranchée, la fabrication reste chez vous.

**Restent en attente de votre autorisation :** le **lot 4** (les huit tests de migration) et
**MP3** (validation des bons, écritures financières, PDF, correction des stocks). Je n'ai rien
commencé ni sur l'un ni sur l'autre.
