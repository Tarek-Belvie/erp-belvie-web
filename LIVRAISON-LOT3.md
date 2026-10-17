# Lot 3 — l'installateur Windows

**571 contrôles automatiques, 0 échec** (499 avant le lot 3 : aucune régression, 72 nouveaux).
**Aucun fichier de l'application n'est modifié.** Le lot 4 n'est pas commencé.

> **Mise à jour du 17 octobre** — deux obstacles Windows rencontrés et traités : Smart App Control
> a bloqué `PREPARER-ICONE.bat` (§ 0.1), et la fabrication a échoué sur un lien symbolique
> (§ 0.2, **corrigé, la fabrication doit maintenant aboutir**). Le § 0.1 contient aussi une
> conséquence plus importante que le `.bat` lui-même, qui touche l'installateur.

---

## 0. Les deux obstacles Windows

## 0.1 Smart App Control

### Pourquoi le `.bat` a été bloqué

Smart App Control refuse **39 extensions de fichiers provenant d'Internet**, dont `.bat`, `.cmd`,
`.js`, `.ps1` et `.vbs`. La marque « provient d'Internet » se propage du ZIP téléchargé à **chaque
fichier qu'on en extrait** : le `.bat` était donc marqué, et bloqué, sans rapport avec son contenu.

**Corrigé, et sans affaiblir Windows.** Les `.bat` sont supprimés. Tout passe maintenant par `npm`,
déjà installé chez vous et jamais téléchargé (§ 2 et § 3). Contrôle `T33` : il ne reste aucun
`.bat` dans le projet.

### La conséquence que je n'attendais pas

En vérifiant la documentation de Microsoft, j'ai lu ceci, qui ne concerne pas le `.bat` :

> « **Il n'existe aucun moyen de contourner la protection de Smart App Control pour des
> applications individuelles.** »

Il n'y a donc **pas de « Exécuter quand même »** avec Smart App Control actif, contrairement au
message « Éditeur inconnu » que j'annonçais au § 7. Microsoft ne laisse que deux portes :
désactiver Smart App Control — **irréversible sans réinstaller Windows**, et vous l'avez exclu, à
raison — ou **signer l'application** avec un certificat d'une autorité du Trusted Root Program.

**Donc : l'installateur que le lot 3 fabrique n'est pas signé, et il est probable que Smart App
Control refuse de l'installer.** C'est l'objectif même du lot 3 qui est remis en cause, et cela
rouvre la question de la signature, que nous avions mise de côté.

Je dis « probable » et pas « certain », pour une raison précise et utile : **le `.exe` sera
fabriqué sur votre machine, pas téléchargé.** Il ne portera donc pas la marque « provient
d'Internet » qui a bloqué le `.bat`. Smart App Control évalue tout de même les applications
inconnues, mais une application construite localement part dans de bien meilleures conditions
qu'un fichier téléchargé. **Je ne peux pas le savoir depuis ici ; votre machine, elle, le dira en
cinq minutes.**

### Ce que je propose, dans cet ordre

**1. Faites l'essai, il ne coûte presque rien.** Fabriquez l'installateur (§ 3) et lancez-le.
S'il démarre, le sujet est clos et nous n'avons rien payé. S'il est bloqué, **rien n'est
installé, rien n'est modifié, et votre installation de développement continue de fonctionner** —
vous n'aurez perdu que quelques minutes.

**2. S'il est bloqué : restez en mode développement, sans rien décider tout de suite.** C'est ce
que vous faites depuis le début, et depuis le lot 1 c'est **la même base, au même endroit**
(`%APPDATA%\belvie-erp`). L'installateur n'apportait que du confort — une icône au menu Démarrer,
pas de fenêtre de commandes — **pas une fonction que vous n'auriez pas**. Rien ne presse.

**3. Et seulement alors, la signature.** Azure **Artifact Signing** (l'ancien Trusted Signing),
**9,99 $ par mois** pour 5 000 signatures, délivre un certificat d'une autorité reconnue par
Windows — Smart App Control accepterait alors l'installateur. Cela demande une validation
d'identité (pour une société, trois ans d'existence légale ; sinon une validation individuelle),
donc quelques jours. Je vous le détaillerai si et quand l'essai montre que c'est nécessaire. **Je
ne vous demande rien aujourd'hui.**

**Ce que je ne proposerai pas :** désactiver Smart App Control. Vous l'avez exclu, et c'est le bon
choix — le réactiver demande de réinstaller Windows.

### Et la vérification des scripts, que vous avez demandée

Elle est au **§ 10**, avec le détail de chaque écriture.

---

## 0.2 Le lien symbolique qui arrêtait la fabrication

```
ERROR: Cannot create symbolic link : Le client ne dispose pas d'un privilège nécessaire.
...\Cache\winCodeSign\...\darwin\10.12\lib\libcrypto.dylib
```

### Pourquoi une compilation Windows extrait des fichiers macOS

Pour écrire **l'icône et le numéro de version dans `Belvie ERP.exe`**, electron-builder utilise un
outil nommé `rcedit`. Et `rcedit` est livré dans une archive unique, `winCodeSign-2.6.0.7z`, qui
contient **tous les outils de signature de toutes les plateformes à la fois**.

Je l'ai téléchargée et ouverte pour en être sûr plutôt que de le supposer. Elle contient
**96 entrées** :

| Dossier | Ce qu'il contient |
|---|---|
| `windows-10`, `windows-6` | `signtool.exe` (signature Windows) |
| `rcedit-x64.exe`, `rcedit-ia32.exe` | **l'outil dont nous avons besoin** |
| `darwin` | `osslsigncode` et les bibliothèques OpenSSL de macOS |
| `linux`, `openssl-ia32`, `appxAssets` | les équivalents Linux et les ressources Appx |

**Rien de macOS n'est « compilé ».** L'archive est simplement commune aux trois plateformes, et il
faut l'extraire en entier pour y prendre un seul fichier.

### Et pourquoi cela échoue sans être administrateur

Sur ces 96 entrées, **exactement deux sont des liens symboliques** — je les ai comptées :

```
darwin/10.12/lib/libcrypto.dylib  ->  libcrypto.1.0.0.dylib
darwin/10.12/lib/libssl.dylib     ->  libssl.1.0.0.dylib
```

Créer un lien symbolique sous Windows demande le privilège `SeCreateSymbolicLink`, **réservé aux
administrateurs**. Le décompresseur échoue donc sur ces deux entrées, sort en erreur, et toute la
fabrication s'arrête. Votre message nomme d'ailleurs le premier des deux.

Ces deux liens ne servent à rien ici : ils appartiennent à l'outil de signature **de macOS**.

### La correction

**Extraire l'archive nous-mêmes, une fois, en laissant ces deux liens de côté, puis les remplacer
par de vraies copies.** electron-builder trouve alors son outillage déjà en place dans son cache
et **ne décompresse plus rien** : plus de lien symbolique à créer, donc plus de privilège à
demander.

C'est une nouvelle étape de la chaîne, `npm run installateur:outils`, appelée automatiquement par
`npm run installateur`. **Aucun réglage de fabrication n'est modifié, aucune version n'est
changée, et Windows n'est pas touché.**

### Ce que j'ai vérifié, et non supposé

| Vérification | Résultat | Contrôle |
|---|---|---|
| L'archive contient bien `rcedit-x64.exe` | oui — c'est pour lui qu'elle est téléchargée | |
| Elle ne contient que **deux** liens symboliques | oui, sur 96 entrées | `T59` |
| L'extraction en les excluant réussit **sans erreur** | oui, 95 entrées, aucun lien | `T61` |
| Les deux fichiers sont ensuite de vraies copies, de la bonne taille | oui | `T63` |
| L'empreinte attendue est celle **publiée par electron-builder lui-même** | identique | `T57`, `T58` |
| **L'outil d'electron-builder, cache ainsi rempli, ne télécharge plus rien** | confirmé : il affiche le chemin et s'arrête | |
| Relancer la commande ne refait rien | oui | `T64` |
| Une archive altérée d'un octet n'est pas utilisée | oui | `T65`, `T67` |
| Une tentative précédente incomplète est mise de côté, pas supprimée | oui | `T68` |
| Le dossier de données reste intact | empreinte par empreinte | `T69` |

Le dernier point de cette liste est le seul que je ne pouvais pas déduire du code : je l'ai obtenu
en remplissant un cache d'essai, puis en lançant l'outil d'electron-builder dessus. Il s'est
contenté d'afficher le chemin du dossier — c'est exactement le comportement attendu.

### Les deux autres solutions, et pourquoi je ne les propose pas

- **Être administrateur** (ou activer le mode développeur de Windows, ou s'accorder le privilège
  dans `secpol.msc`). Cela fonctionne, et c'est ce que font la plupart des gens. Vous l'avez
  exclu, et je suis d'accord : fabriquer en tant qu'administrateur donne les pleins droits à tout
  ce que la fabrication exécute, y compris aux paquets npm.
- **`signAndEditExecutable: false`**, qui supprime l'étape fautive. Elle supprimerait aussi
  **l'icône et le numéro de version de `Belvie ERP.exe`** — c'est-à-dire précisément le travail du
  § 2. Je l'ai écarté pour cette raison.

### À terme : la dépendance disparaît d'elle-même

Dans les versions récentes d'electron-builder (26.x), cette étape a été réécrite en JavaScript
(bibliothèque `resedit`) et l'archive `winCodeSign-2.6.0` complète est marquée *legacy* — vérifié
dans le code de la version 26.15.3. **Le jour où nous monterons de version, cette correction
deviendra inutile et pourra être retirée.** Je ne propose pas ce changement de version majeure
aujourd'hui : avant votre première fabrication réussie, ce serait ajouter un risque pour régler un
problème déjà réglé.

---

## 1. Ce que je ne peux pas faire, et qu'il faut savoir d'abord

**Je ne peux pas fabriquer le `.exe` depuis ici.** Je travaille dans un conteneur Linux ; produire
un installateur Windows demande de compiler `better-sqlite3` et `sharp` **pour Windows, sur
Windows**, puis de lancer NSIS. J'ai vérifié : ni Wine ni les outils nécessaires ne sont présents.

Un `.exe` que je produirais ici ne démarrerait pas sur votre machine. **Vous en auriez un, et il
serait inutilisable.**

Ce que je livre à la place : **tout ce qu'il faut pour qu'un seul double-clic le fabrique chez
vous**, avec une vérification automatique de ce qui est sorti. C'est la même démarche qu'au lot 0,
et pour la même raison.

---

## 2. L'icône — votre validation d'abord

Vous avez demandé un aperçu avant de figer quoi que ce soit. **Je n'ai pas votre logo** : il est
dans `%APPDATA%\belvie-erp\images\entreprise\`, sur votre machine.

Le script fonctionne donc en **deux temps**, et le premier ne fige rien :

```
npm run icone                   → fabrique seulement build\apercu-icone.png
npm run icone:valider           → écrit build\icon.ico, après votre accord
```

À lancer depuis une invite de commandes **ouverte dans le dossier du projet** — la même que pour
`npm run dev`. Aucun fichier téléchargé n'intervient : `npm` est déjà installé chez vous.

Tant que vous n'avez pas tapé `/valider`, **`build\icon.ico` n'existe pas** — le contrôle `T13` le
vérifie, et la fabrication de l'installateur refuse de démarrer sans lui.

### À quoi ressemblera l'aperçu

La planche montre les quatre tailles réelles, **sur fond clair et sur fond sombre** : Windows
affiche les deux selon le thème, et un logo sombre disparaît sur une barre des tâches sombre. Elle
ressemblera à ceci — ce n'est **pas** votre logo, c'est la disposition :

```
┌────────────────────────────────┬────────────────────────────────┐
│ Fond clair                     │ Fond sombre (barre des tâches) │
│                                │                                │
│   [    icône    ]  256 × 256   │   [    icône    ]              │
│   [     256     ]              │   [     256     ]              │
│                                │                                │
│   [ 48 ]           48 × 48     │   [ 48 ]                       │
│   [32]             32 × 32     │   [32]                         │
│   [16]             16 × 16     │   [16]                         │
└────────────────────────────────┴────────────────────────────────┘
```

Le script vous dira aussi la **définition réelle** de votre logo. S'il fait moins de 256 × 256, il
vous prévient que l'icône sera agrandie, donc moins nette aux grandes tailles — les petites,
celles qu'on voit le plus, resteront correctes.

### Si vous préférez

Envoyez-moi simplement le fichier du logo, et je vous montrerai l'aperçu ici avant que vous ne
lanciez quoi que ce soit.

### Comment l'icône est fabriquée

Sept tailles dans un seul fichier — 16, 24, 32, 48, 64, 128 et 256 pixels — le logo redimensionné
**sans déformation** (`contain`, pas `cover` : un logo rectangulaire recadré perdrait une partie
de lui-même), avec 8 % de marge pour qu'il ne touche pas les bords.

Le fichier `.ico` est assemblé à la main, **sans ajouter de dépendance** : en installer une juste
avant votre première fabrication serait exactement le mauvais moment. Le résultat a été vérifié
ici par deux lecteurs indépendants — Python/PIL et la commande `file` du système — qui y
reconnaissent bien une icône Windows de sept tailles, dont le 256 × 256 qu'exige electron-builder
(contrôles `T14` à `T18`).

---

## 3. Fabriquer l'installateur

```
npm run installateur
```

Une seule commande, six étapes enchaînées :

1. **l'icône est-elle là ?** — sinon il s'arrête tout de suite, plutôt que d'échouer au milieu de
   la fabrication (`npm run installateur:prerequis`) ;
2. **l'outillage** est mis en place sans lien symbolique (`npm run installateur:outils`, § 0.2) —
   la première fois seulement ; ensuite cette étape ne fait rien ;
3. **les modules compilés** sont alignés sur Electron (`electron-builder install-app-deps`) ;
4. **l'interface** — `vite build` ;
5. **l'installateur** — `electron-builder --win nsis` ;
6. **la vérification** — automatique, voir le § 5 — puis la **conservation** de l'installateur.

Chaque installateur produit est recopié dans `release\installateurs\` et **n'y est jamais
effacé**. C'est ce qui permet de revenir à une version précédente (§ 6).

L'ordre est vérifié mécaniquement (`T35`) : l'icône avant, la vérification après, la conservation
en dernier. Un enchaînement dans le mauvais ordre passerait inaperçu jusqu'au jour où il faudrait
revenir en arrière et où la copie manquerait.

**Cette commande ne touche pas à vos données.** Elle ne lit ni n'écrit `%APPDATA%\belvie-erp` — elle
ne travaille que dans le dossier du projet. Détail et preuves au § 10.

---

## 4. Vos six exigences, et où chacune est tenue

| # | Exigence | Comment |
|---|---|---|
| **1** | Installer sans déplacer ni supprimer les données | L'installateur ne touche jamais `%APPDATA%`. Il installe le programme dans `%LOCALAPPDATA%\Programs`. Deux endroits différents. |
| **2** | Continuer à utiliser `%APPDATA%\belvie-erp` | C'est le lot 1 : `app.setPath` fige le dossier. **La vérification refuse l'installateur si cette ligne a disparu** (`T29`). |
| **3** | Conserver la protection contre les instances simultanées | Idem : vérifiée dans l'installateur produit (`T29`, second contrôle). |
| **4** | Installation et mise à jour simples, sans réinitialiser la base | Réinstaller par-dessus met à jour le programme. Les données vivent ailleurs : **elles ne sont pas touchées**. |
| **5** | Préserver les sauvegardes, permettre un retour en arrière | `deleteAppDataOnUninstall: false`, et chaque installateur est conservé. Voir § 6. |
| **6** | `.exe`, tests, procédure | La procédure est au § 7. Les tests, au § 5. Le `.exe`, c'est vous qui le fabriquez — § 1. |

### Le réglage le plus important de tout le lot

```json
"deleteAppDataOnUninstall": false
```

Sans lui, **désinstaller l'application pourrait effacer vos données**. C'est déjà le
comportement par défaut d'electron-builder, mais un défaut peut changer d'une version à l'autre,
et je ne voulais pas que vos 171 images en dépendent. Le contrôle `T3` le vérifie, et la
vérification d'après-fabrication le revérifie sur le projet réel (`T28` prouve qu'elle le
détecte).

### Deux autres réglages ajoutés

- **`asarUnpack`** — `better-sqlite3`, `sharp`, ses paquets `@img`, et tout fichier `.node`.
  Restés dans l'archive `app.asar`, les modules compilés ne peuvent pas se charger et
  **l'application ne démarre pas du tout**. C'était la principale inconnue du plan ; elle est
  désormais traitée, et vérifiée après coup.
- **`allowElevation: false`** et l'assistant **en français**.

---

## 5. La vérification d'après-fabrication

Lancée automatiquement, elle contrôle ce qu'on ne peut constater qu'une fois l'application
empaquetée :

```
OK    Un installateur .exe a été produit        Belvie-ERP-Setup-1.0.0.exe  (182 Mo)
OK    Le nom de l'installateur porte la version version 1.0.0
OK    L'application est empaquetée (app.asar)
OK    Les modules compilés sont extraits        6 fichier(s) .node — better-sqlite3, sharp
OK    Le module « better-sqlite3 » est extrait
OK    Le module « sharp » est extrait
OK    La désinstallation NE supprimera PAS vos données
OK    Aucun mot de passe administrateur ne sera demandé
OK    Le dossier de données est fixé (lot 1)
OK    La protection contre les instances simultanées est présente
```

**Elle a été éprouvée en la faisant échouer.** J'ai fabriqué de fausses arborescences de sortie
pour vérifier qu'elle détecte vraiment : des modules compilés restés dans l'archive (`T26`), un
réglage qui effacerait les données à la désinstallation (`T28`), l'oubli du dossier fixé (`T29`),
un installateur qui ne porte pas la bonne version (`T30`), l'absence totale d'installateur
(`T31`). Un contrôle qui ne détecte rien ne vérifie rien.

Et `T32` vérifie qu'elle **ne modifie rien**.

---

## 6. Revenir à la version précédente

Il n'y a pas de mécanisme automatique, et je n'en propose pas : pour une application mono-poste,
la procédure manuelle est plus sûre parce qu'elle est lisible.

1. **Faites une sauvegarde complète** (Paramètres → Données et maintenance).
2. Désinstallez la version en place (Paramètres de Windows → Applications). **Vos données ne sont
   pas touchées** — c'est `deleteAppDataOnUninstall: false`.
3. Relancez l'installateur de la version précédente, conservé dans
   `release\installateurs\Belvie-ERP-Setup-<version>.exe`.
4. L'application rouvre la même base, au même endroit.

**Le point qui demande de l'attention :** si la version récente a exécuté une migration de base,
l'ancienne version rouvrira une base migrée. Nos migrations sont toutes **additives** — l'ancien
code ignore ce qu'il ne connaît pas — donc cela fonctionne. C'était déjà vérifié au § 5 du plan de
sécurisation, expérience à l'appui. Et depuis le lot 2, **une sauvegarde complète est prise
automatiquement avant toute migration** : en dernier recours, c'est elle qui vous ramène à l'état
exact d'avant.

---

## 7. Procédure d'installation

### Avant tout

1. **Sauvegarde complète** depuis Paramètres → Données et maintenance, sur votre clé USB.
2. Relevez l'état : `npm run diagnostic`, et gardez le rapport `diagnostic-belvie.txt`.
3. Fermez l'application.

### Fabriquer

4. `npm run icone` → ouvrez `build\apercu-icone.png` et regardez-le.
5. Si l'icône vous convient : `npm run icone:valider`.
6. `npm run installateur` → comptez quelques minutes.
7. Lisez la vérification. **S'il y a un ÉCHEC, n'installez pas** : envoyez-le moi.

### Installer

8. Lancez `release\Belvie-ERP-Setup-1.0.0.exe`.
9. **C'est ici que Smart App Control se prononce** (§ 0). Trois issues possibles :
   - l'installateur démarre → continuez ;
   - **« Éditeur inconnu »**, avec « Informations complémentaires » → « Exécuter quand même » :
     c'est le filtre SmartScreen, pas Smart App Control. Sans danger, continuez ;
   - **« Contrôle intelligent des applications a bloqué… »**, sans aucun moyen de passer outre :
     **arrêtez là**, rien n'est installé. Dites-le-moi : nous en sommes au point 3 du § 0, et
     votre installation de développement continue de fonctionner entre-temps.
10. L'assistant propose un dossier d'installation ; le dossier proposé convient.
11. **Aucun mot de passe administrateur ne doit être demandé.** S'il l'est, arrêtez et
    signalez-le-moi.

### Vérifier

12. L'application s'ouvre. **Vos 44 commandes, 33 articles et 9 fiches techniques doivent être
    là**, avec leurs images.
13. **Aucune fenêtre** sur les dossiers de données ne doit apparaître.
14. Relancez `npm run diagnostic` : toujours **un seul** dossier, les mêmes chiffres qu'avant.

**Gardez votre installation de développement** : elle reste fonctionnelle, et c'est votre filet.

---

# Tests manuels

## Groupe I — l'icône

- **I1** `npm run icone`, puis ouvrez `build\apercu-icone.png`. **`build\icon.ico` ne doit PAS
  exister** (vérifiez dans le dossier `build`).
- **I2** Regardez la ligne 16 × 16 **sur fond sombre** : c'est là qu'un logo trop foncé disparaît.
  Si c'est le cas, dites-le moi — il y a des remèdes.
- **I3** `npm run icone:valider` : `build\icon.ico` apparaît.
- **I4** Relancez `npm run icone:valider` : l'icône précédente doit être conservée sous
  `icon.ico.precedent-...`, jamais écrasée sans copie.

## Groupe F — la fabrication

- **F1** Renommez temporairement `build\icon.ico` et lancez `npm run installateur` : il doit
  **s'arrêter immédiatement** en vous disant quelle commande lancer. Remettez le nom.
- **F2** `npm run installateur` jusqu'au bout. La vérification doit être **tout en OK**.
- **F3** `release\installateurs\` contient une copie de l'installateur.
- **F4** Relancez `npm run installateur:archiver` : la copie déjà présente **ne doit pas changer de
  date** — une version conservée n'est jamais écrasée.

## Groupe W — l'installation *(le plus important)*

- **W1** Avant d'installer : **sauvegarde complète faite**, et `npm run diagnostic` relevé.
- **W2** Installez. Aucun mot de passe administrateur. **Si Smart App Control bloque, arrêtez-vous
  là** et passez directement à W5 : c'est le test qui compte le plus, et il ne demande pas
  l'installateur.
- **W3** **Fermez la version de développement si elle tourne**, puis lancez la version installée
  depuis le menu Démarrer.
- **W4** **Vos données sont là** : commandes, fiches techniques, croquis, logo, bons MP.
- **W5** Laissez la version installée ouverte et lancez `npm run dev` : **la seconde doit être
  refusée**, en nommant la version installée. C'est le lot 1 qui tient entre les deux modes —
  le test que je ne pouvais pas faire depuis mon environnement.
- **W6** Faites une **sauvegarde complète depuis la version installée** : les neuf contrôles
  doivent être tous en OK, et toujours 171 images.
- **W7** Créez une commande d'essai dans la version installée. Fermez-la, rouvrez la version de
  développement : **la commande doit y être**. C'est la preuve que les deux versions partagent la
  même base.
- **W8** Supprimez cette commande d'essai.

## Groupe D — la désinstallation *(à faire une fois, sereinement)*

- **D1** Sauvegarde complète d'abord.
- **D2** Désinstallez depuis les Paramètres de Windows.
- **D3** **Vérifiez que `%APPDATA%\belvie-erp` existe toujours, avec la base, les images et les
  sauvegardes.** C'est le test de `deleteAppDataOnUninstall`.
- **D4** Réinstallez : vos données sont retrouvées telles quelles.

---

## 8. Les risques résiduels

**1. La fabrication peut encore échouer sur autre chose.** Deux obstacles sont tombés (§ 0.1
et § 0.2), mais l'inconnue annoncée dans le plan reste entière : **les modules compilés**
(`better-sqlite3` et `sharp`), qui doivent être recompilés pour Electron sur votre machine. Si
cela arrive, l'erreur s'affichera, **rien ne sera installé**, et votre version de développement
continuera de fonctionner. Envoyez-moi le texte.

**2. Smart App Control peut refuser l'installateur, sans recours.** C'est désormais le risque
principal du lot 3, et il est détaillé au § 0. Il ne met en danger ni vos données ni votre
installation actuelle — il peut seulement empêcher l'installation d'aboutir. Le test **W2** le
tranche en cinq minutes.

**3. La taille.** Comptez 150 à 250 Mo pour l'installateur. Ce n'est pas anormal : Electron
embarque son propre moteur de rendu.

**4. Le verrou entre les deux versions n'a jamais été éprouvé en conditions réelles.** Le test
**W5** est celui qui le prouvera. S'il échoue, le second garde du lot 1 — la marque dans le
dossier de données — prendra le relais, mais je veux le savoir.

**5. Une migration future verrouillerait le retour en arrière à la sauvegarde.** Si une version
ultérieure migre la base et que vous revenez en arrière, l'ancienne version rouvrira une base
migrée. C'est sans danger avec des migrations additives — mais si l'une d'elles reconstruisait une
table un jour, ce ne le serait plus. Je vous le signalerai le moment venu, comme convenu.

**6. `electron-builder` reste en version 24.** L'étude mentionnait une faille
(**CVE-2026-54673**) et recommandait de monter en 26. **J'ai vérifié : elle concerne
`builder-util-runtime` dans le flux de mise à jour authentifié** — le code qui télécharge des
mises à jour avec des identifiants. Nous ne faisons pas de mises à jour automatiques, donc ce
code ne tourne jamais chez vous. Monter une version majeure juste avant votre première
fabrication ajouterait du risque sans rien régler. **Elle redeviendra pertinente le jour où nous
ferons les mises à jour automatiques**, et ce sera alors un prérequis.

---

## 9. Ce qui reste

Le **lot 4** — les huit tests de migration de votre installation — n'est pas commencé et attend
votre autorisation. Il porte précisément sur les groupes W et D ci-dessus, joués méthodiquement
avec relevé avant/après.

Et **MP3** attend toujours votre feu vert, après validation fonctionnelle de MP2.

---

## 10. Vérification demandée : les scripts peuvent-ils toucher à vos données ?

**Non.** Voici comment je l'ai établi, plutôt que de vous l'affirmer.

Il y a maintenant **cinq** scripts : les quatre d'origine, en lecture seule sur vos données, et
celui d'outillage ajouté au § 0.2, qui est le seul à écrire ailleurs que dans le projet. Je le
traite séparément, à la fin, parce qu'il mérite d'être regardé de plus près et non noyé dans un
tableau.

### Les quatre scripts, et tout ce qu'ils écrivent

Il n'y a **que dix écritures** dans les quatre scripts. Les voici toutes, sans exception :

| Script | Écriture | Destination |
|---|---|---|
| `diagnostic-belvie.js` | le rapport (3 endroits du code, un seul fichier) | `diagnostic-belvie.txt`, dans le dossier du projet |
| `preparer-icone.js` | crée le dossier `build` | dossier du projet |
| | l'aperçu | `build\apercu-icone.png` |
| | copie de l'icône précédente | `build\icon.ico.precedent-…` |
| | l'icône | `build\icon.ico` |
| `verifier-installateur.js` | crée le dossier de conservation | `release\installateurs` |
| | copie de l'installateur | `release\installateurs\…exe` |
| `verifier-besoins.js` | le relevé | le fichier que vous nommez vous-même |

**Toutes sont dans le dossier du projet.** Aucune ne désigne `%APPDATA%\belvie-erp` (contrôle
`T51`), et le compte lui-même est vérifié (`T52`) : si une onzième écriture apparaissait un jour,
le test échouerait et il faudrait la justifier.

### Ce qu'aucun des quatre ne contient

| Vérifié | Contrôle |
|---|---|
| **Aucune suppression, aucun déplacement, aucune troncature de fichier** — ni `unlink`, ni `rm`, ni `rmdir`, ni `rename`, ni `truncate`, nulle part | `T47` |
| **Aucun lancement de commande système** — pas de `child_process`, pas de `exec`, pas de `spawn`. Donc aucun `del`, `rd` ou `powershell` caché derrière | `T48` |
| **Aucun ordre SQL d'écriture** — pas d'`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER` | `T50` |

### La base est ouverte en lecture seule

Les trois scripts qui lisent la base l'ouvrent avec `readonly: true`. **C'est SQLite lui-même qui
refuse alors toute écriture** — la garantie ne dépend pas de ce que le code fait ensuite, ni de ma
relecture. Les cinq ouvertures sont vérifiées une par une (`T49`).

### Et la preuve à l'exécution, pas seulement à la lecture

Lire le code ne suffit pas : j'ai donc fait tourner le script d'icône, **`/valider` compris**, sur
un faux dossier de données contenant une base et un logo, en calculant l'**empreinte SHA-256 de
chaque fichier avant et après**.

- `T53` : **toutes les empreintes du dossier de données sont identiques** après le passage.
- `T54` : et le script a bien écrit, mais **dans le projet** — l'icône et l'aperçu sont là.

Le second compte autant que le premier : un script qui ne fait rien du tout passerait le premier
test sans rien prouver.

### Les dépendances

Ces scripts n'utilisent que `fs` et `path` (Node lui-même), `better-sqlite3` ou `node:sqlite`
**en lecture seule**, et `sharp` pour les images dans le seul script d'icône. **Aucun accès
réseau, aucun module installé pour l'occasion.** Le fichier `.ico` est d'ailleurs assemblé à la
main précisément pour ne pas ajouter de dépendance (§ 2).

### Ce que cela ne couvre pas, pour être exact

Deux scripts — le diagnostic et le relevé des besoins — écrivent leur rapport **à l'endroit que
vous indiquez** en ligne de commande. Si vous leur donniez vous-même un chemin dans
`%APPDATA%\belvie-erp`, ils y écriraient ce rapport. Par défaut, et avec `npm run diagnostic`,
c'est un fichier `.txt` dans le dossier du projet. Je le signale pour que l'affirmation du § 10
soit exacte, pas approximative.

### Le cinquième script : `preparer-outils-build.js`

C'est celui du § 0.2, et il est différent des quatre autres sur trois points. Je les déclare au
lieu de les ranger dans la même colonne.

| Ce qu'il fait d'inhabituel | Jusqu'où, exactement |
|---|---|
| **Il écrit en dehors du projet** | Uniquement dans `%LOCALAPPDATA%\electron-builder\Cache\winCodeSign` — le cache d'electron-builder, que la fabrication remplirait elle-même si elle y parvenait. **Pas dans le projet, pas dans `%APPDATA%\belvie-erp`.** |
| **Il lance un programme** | Un seul : le décompresseur `7za` livré avec le projet, avec une liste d'arguments fixe. C'est le même programme que celui qu'emploie la fabrication. |
| **Il supprime un fichier** | Deux appels, tous deux sur **la seule archive qu'il vient lui-même de télécharger**, et jamais ailleurs (`T71`). Aucune suppression récursive (`T72`). |

Et ce qu'il ne fait pas :

- il **n'ouvre jamais la base de données** et ne lit pas `%APPDATA%` : il ne construit de chemin
  que depuis `%LOCALAPPDATA%` (`T73`) ;
- il **ne supprime pas** un outillage incomplet laissé par une tentative ratée : il le **met de
  côté** sous un nom daté (`T68`) — c'est la même règle que pour vos sauvegardes ;
- il **refuse une archive dont l'empreinte ne correspond pas**, avant toute décompression
  (`T65`, `T67`). L'empreinte de référence est celle publiée par electron-builder lui-même.

**Et la preuve à l'exécution**, comme pour le script d'icône : avec un faux dossier de données
placé juste à côté, toutes ses empreintes SHA-256 sont identiques après le passage du script
(`T69`), et rien n'a été écrit dans le projet (`T70`).
