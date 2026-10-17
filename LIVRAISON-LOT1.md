# Lot 1 — dossier de données fixé et instances simultanées empêchées

**499 contrôles automatiques, 0 échec** (495 avant le lot 1 : aucune régression, 43 nouveaux).
**Aucune migration. Aucun changement des calculs ni du schéma.** Le lot 3 n'est pas commencé.

Archive **cumulative** : lot A + MP1 + B3 + MP2 + lot 2 + lot 1.

---

## 1. Installation

`Belvie-ERP-LOT1.zip` **sans dossier racine**, à extraire **à l'intérieur** de votre dossier de
projet.

**Aucune migration.** Le schéma de la base est identique au lot 2, octet pour octet.

`electron/main.js` est modifié. En développement, Vite ne recharge que l'interface : **arrêtez
complètement (Ctrl + C) et relancez**, sinon le nouveau démarrage ne s'exécute pas.

### Quatre fichiers, et aucun autre

```
nouveaux   electron/dossierDonnees.js     résout le dossier, et constate les doublons
           electron/verrouInstance.js     la marque d'instance et son message

modifiés   electron/main.js               setPath, isDev durci, verrou, constat, libération
           electron/ipc/sauvegarde.js     deux exclusions de plus — voir le § 5
```

`preload.js`, `global.d.ts`, `schema.sql`, `db/index.js` et **toute l'interface** sont inchangés.
Les contrôles `L40` et `L42` le vérifient à chaque exécution de la suite.

---

## 2. Le dossier de données, fixé

```js
// electron/main.js, ligne 19 — avant tout require qui pourrait lire un chemin
app.setPath("userData", dossierDonnees.cheminDonnees(app.getPath("appData")));
```

Le dossier vaut désormais **toujours** `%APPDATA%\belvie-erp`, quel que soit le nom que porte
l'application. La version installée de demain ouvrira donc exactement la base que vous utilisez
aujourd'hui.

**Aujourd'hui, vous ne verrez aucune différence** — et c'est normal : votre version de
développement utilise déjà ce dossier. Cette ligne ne change rien maintenant ; elle empêche que
tout change au lot 3.

**Aucune migration n'est nécessaire** parce que le diagnostic du lot 0 l'avait vérifié sur vos
données : aucun chemin absolu n'est stocké en base, tous les chemins d'images sont relatifs à ce
dossier. Fixer le dossier suffit, il n'y a rien à réécrire.

### L'ordre, qui n'est pas négociable

`setPath` est appelé **avant** `require("./db")` et **avant** la demande du verrou d'instance. Un
seul module qui lirait un chemin avant cette ligne suffirait à tout casser en silence. Les
contrôles `L3` et `L4` vérifient cet ordre dans le fichier source.

### Et si deux dossiers existaient

Le diagnostic n'en a trouvé qu'un chez vous, donc ce cas ne devrait pas se présenter. S'il se
présentait, l'application **constate et affiche**, et ne touche à rien :

```
Deux dossiers de données ont été trouvés sur cet ordinateur.

CELUI QUE L'APPLICATION UTILISE :
  C:\Users\User\AppData\Roaming\belvie-erp
      base : 47,2 Mo, modifiée le 2026-10-17
      contenu : 44 commandes, 33 articles, 9 fiches techniques, 171 images

L'AUTRE :
  C:\Users\User\AppData\Roaming\Belvie ERP
      ...

AUCUNE DONNÉE N'A ÉTÉ DÉPLACÉE, COPIÉE NI SUPPRIMÉE, et aucune ne le sera sans
votre instruction. Faites une sauvegarde complète, puis signalez-le.
```

Un cas particulier porte son propre nom, **l'inversion** : le dossier utilisé est vide alors que
l'autre contient vos données. Le message met alors en garde contre l'usage de l'application avant
d'avoir décidé — continuer créerait de nouvelles données dans le dossier vide.

**Une fusion automatique est exclue, et je ne la proposerai pas.** Deux bases contenant chacune
des commandes ne se réunissent pas sans arbitrer des conflits de numérotation, et un arbitrage
automatique produirait un historique faux que personne ne pourrait plus démêler.

---

## 3. Une seule instance à la fois

### Deux gardes, et pourquoi deux

**Le premier est le verrou système d'Electron** (`app.requestSingleInstanceLock`). C'est Windows
qui le tient : quand un processus meurt — proprement, brutalement, ou par coupure de courant — le
système le libère tout seul. **Il ne peut pas rester coincé.**

**Le second est une marque dans le dossier de données**, `instance-ouverte.json`, qui note le
numéro de processus, le mode (développement ou installée), la version et l'heure de démarrage.

Pourquoi deux ? Le verrou d'Electron est en principe lié au dossier de données, donc il devrait à
lui seul couvrir les deux versions. **« Devrait » : je n'ai pas pu le vérifier sur une machine
Windows depuis ici**, et une protection qui repose sur un « devrait » n'en est pas une. La marque,
elle, vit dans le dossier partagé : elle couvre le cas quoi qu'il arrive.

### Ce qui règle le défaut que je vous avais annoncé

Je vous avais prévenu qu'un verrou de fichier laisse un verrou mort après une coupure de courant,
et qu'il faudrait une façon de le lever. **C'est réglé, et pas par une procédure :**

> **Ce n'est pas la présence du fichier qui bloque, c'est la vie du processus qu'il nomme.**

Une marque laissée par une application coupée ne bloque rien : le code demande au système si ce
processus existe encore, constate que non, et **remplace la marque**. Il signale au passage, dans
la console, que la fermeture précédente s'est mal passée. Contrôles `L25` à `L28`.

### Ce que vous verrez

En lançant une seconde fois :

```
Belvie ERP est déjà ouvert sur cet ordinateur.

L'application en cours est la version de développement (npm run dev), démarrée à 11h42.

Les deux versions utilisent désormais le même dossier de données. Les ouvrir en
même temps afficherait deux vérités différentes, et une sauvegarde lancée d'un
côté remplacerait la base que l'autre est en train de lire.

Fermez d'abord celle qui est ouverte, puis relancez.
Aucune donnée n'a été modifiée.
```

Et si l'application est déjà ouverte, **un second lancement ramène sa fenêtre au premier plan**
plutôt que de ne rien faire : un double-clic sans effet laisse croire à un plantage.

---

## 4. Le détecteur de mode, durci

```js
const isDev = !app.isPackaged && process.env.NODE_ENV === "development";
```

Sans `app.isPackaged`, une variable `NODE_ENV=development` restée dans votre environnement
Windows ferait chercher le serveur de développement à la **version installée**, qui afficherait
alors une fenêtre blanche sans la moindre explication. C'était le point 3 du § 4 du plan.

---

## 5. Deux corrections dans la sauvegarde — et pourquoi j'ai touché au lot 2

Le lot 1 fait partager le dossier de données entre les deux versions. Cela a **deux conséquences
directes sur la sauvegarde complète**, que je ne pouvais pas laisser passer.

### Le cache de Chromium n'est plus sauvegardé

Votre dossier de données contient aussi les dossiers de travail de Chromium — `Cache`,
`GPUCache`, `Code Cache` et quelques autres. Ils sont **entièrement regénérés au démarrage**, ils
pèsent des dizaines de méga-octets, et surtout **Windows en garde certains verrouillés tant que
l'application tourne**.

Les copier faisait courir un risque réel : une sauvegarde qui échoue parce qu'un fichier de cache
est verrouillé. Et depuis le lot 2, ce risque remonte plus haut encore — **une sauvegarde
d'avant-migration qui échoue empêche le démarrage**. C'est un défaut que j'ai introduit au lot 2 ;
je le corrige ici plutôt que d'attendre qu'il vous arrive.

Rien de ce qui vous appartient ne vit là : j'ai vérifié que l'interface n'utilise ni
`localStorage` ni `IndexedDB`.

### La marque d'instance n'est pas sauvegardée non plus

La copier reviendrait à planter dans une sauvegarde le numéro de processus d'un ordinateur donné,
à un instant donné — sans aucun sens une fois restauré ailleurs.

**C'est la seule modification apportée au lot 2**, et le contrôle `L42` le vérifie : à la liste
d'exclusions près, le fichier est identique à celui que vous avez validé.

---

## 6. Ce qui a été vérifié — 43 contrôles

### Le dossier fixé, 5 contrôles
Le nom est toujours `belvie-erp`. `setPath` est appelé **avant** le chargement du module de base
et **avant** le verrou. `isDev` s'appuie d'abord sur `app.isPackaged`.

### Le constat des doublons, 13 contrôles
Un seul dossier : aucun conflit. Un second dossier **vide** : pas un conflit non plus. Deux
dossiers avec des données : conflit signalé, les chiffres des deux affichés. **L'inversion** est
nommée et met en garde. Un **troisième** dossier inattendu est trouvé par balayage. Une base
**illisible** est signalée sans faire échouer le constat, et n'est jamais comptée comme contenant
des données.

Et à chaque fois, le contrôle qui compte : **l'empreinte du dossier est identique avant et après
le constat** — rien n'a été déplacé, copié ni supprimé.

### Le verrou, 15 contrôles
Un processus **réellement vivant** bloque, avec un message qui dit quelle version est ouverte et
donne la sortie de secours. Notre propre marque ne nous bloque pas. **Une marque périmée ne bloque
pas** et est remplacée en signalant la fermeture ratée. La libération retire notre marque et
**jamais celle d'un autre**. Un fichier illisible, un dossier inexistant : aucun blocage.

### Le branchement, 10 contrôles
La seconde instance ne touche **pas** à la base — le `return` est avant `openDatabase`. Le second
garde est vérifié **avant** l'ouverture, la marque posée **après**. Elle est libérée à la
fermeture. Un constat raté ne fait jamais échouer le démarrage.

### La non-régression
Les calculs et le schéma sont **identiques au lot 2, octet pour octet** : `besoins.js`,
`calculBesoins.js`, `preparationBcMp.js`, `bcMp.js`, `ficheTechnique.js`, `finance.js`,
`db/index.js`, `schema.sql`.

---

## 7. Les risques résiduels

Vous les avez demandés. Les voici, du plus probable au plus improbable.

**1. Le verrou d'Electron entre les deux versions n'est pas vérifié.** Je n'ai pas de machine
Windows ici. C'est précisément pourquoi il y a un second garde, qui lui ne dépend de rien. Le test
manuel **V3** le vérifiera, et si le verrou système ne couvrait pas les deux modes, la marque le
ferait quand même.

**2. Un numéro de processus réattribué.** Si l'application est coupée brutalement et que Windows
réattribue son numéro à un autre programme avant le relancement, la marque bloquerait à tort. Très
improbable — il faut une coupure brutale *et* une réattribution immédiate. **La sortie de secours
est écrite dans le message lui-même**, avec le chemin exact du fichier à supprimer. C'est le seul
cas où vous auriez à toucher un fichier.

**3. Le dossier de données contiendra les fichiers de travail de Chromium de la version
installée.** C'est la conséquence normale de `setPath`. Ils sont exclus des sauvegardes (§ 5), donc
sans effet sur vous — mais le dossier grossira de quelques dizaines de méga-octets.

**4. Une marque laissée après un arrêt brutal** produit une ligne dans la console
(*« la fermeture précédente ne s'est pas faite proprement »*). Information, pas erreur : la marque
est remplacée et l'application démarre normalement.

**5. Le verrou empêche aussi d'ouvrir volontairement deux fenêtres.** L'application n'a de toute
façon qu'une fenêtre ; mais si un jour vous vouliez deux vues côte à côte, il faudrait revenir sur
ce point.

**6. Aucun effet visible aujourd'hui.** Si vous cherchez un changement dans l'interface, il n'y en
a pas — hormis le refus d'une seconde instance. Le lot 1 prépare le lot 3 ; c'est tout son objet,
et c'est pourquoi il doit passer avant.

---

# Tests manuels

## Groupe V — le verrou *(le plus important)*

- **V1** Lancez `npm run dev`. L'application s'ouvre normalement.
- **V2** Sans la fermer, ouvrez **un second terminal** et lancez `npm run dev` à nouveau. Une
  fenêtre d'erreur doit apparaître : *« Belvie ERP est déjà ouvert »*, en nommant la version de
  développement et l'heure de démarrage. **La seconde instance doit se fermer seule.**
- **V3** Vérifiez dans la première fenêtre que **rien n'a changé** : aucune donnée touchée.
- **V4** Fermez proprement l'application (fermeture de la fenêtre, pas Ctrl + C). Vérifiez que
  `%APPDATA%\belvie-erp\instance-ouverte.json` **a disparu**.
- **V5** Relancez : l'application s'ouvre sans rien signaler.
- **V6** *(le cas de la coupure de courant)* Lancez l'application, puis **tuez-la brutalement**
  (Ctrl + C dans le terminal, ou le Gestionnaire des tâches). Le fichier `instance-ouverte.json`
  reste. **Relancez : l'application doit s'ouvrir normalement**, avec seulement une ligne dans la
  console sur la fermeture précédente. **C'est le test qui prouve qu'aucun verrou ne reste
  coincé.**

## Groupe D — le dossier de données

- **D1** Au démarrage, **aucune fenêtre** sur les dossiers de données ne doit apparaître : vous
  n'en avez qu'un.
- **D2** Vérifiez que vos données sont toutes là : commandes, fiches techniques, images, bons MP.
- **D3** Relancez `npm run diagnostic` : il doit toujours trouver **un seul** dossier, avec les mêmes
  chiffres qu'au lot 0 (44 commandes, 33 articles, 9 fiches techniques, 171 images).

## Groupe S — la sauvegarde, après les exclusions

- **S1** Paramètres → **Sauvegarder maintenant**. Les neuf contrôles doivent être **tous en OK**,
  et le résumé annoncer toujours **171 images**.
- **S2** Ouvrez le dossier créé : il ne doit contenir **ni `Cache`, ni `GPUCache`, ni
  `Code Cache`, ni `instance-ouverte.json`** — mais toujours `images\fiches-techniques`,
  `images\entreprise` et `manifeste.json`.
- **S3** Comparez la taille avec votre sauvegarde précédente : elle devrait être **plus petite de
  quelques dizaines de méga-octets**. C'est le cache en moins.

## Groupe N — non-régression

- **N1** Aucune ligne `[migration]` au démarrage.
- **N2** Approvisionnement, bons MP, fiches techniques, finance, PDF — **inchangés**.
- **N3** Relancez `verifier-besoins.js` avant et après si vous voulez la preuve mécanique.

---

## 8. Ce qui reste

Le **lot 3** — l'installateur Windows — n'est pas commencé, et ne le sera pas sans votre
autorisation explicite. Il demandera deux décisions que le lot 0 a déjà mises en évidence :

- **l'icône** : votre logo fait 180 × 180 pixels, là où Windows en demande 256. Il faudra soit un
  fichier d'origine en meilleure définition, soit accepter une icône moins nette — je vous
  montrerai un aperçu avant de valider, comme convenu ;
- **le numéro de version** : `1.0.0` au premier installateur, sous réserve des tests, comme vous
  l'avez décidé.

Le **lot 4** — les huit tests de migration de votre installation — viendra après.

Et MP3 attend toujours votre feu vert, après validation fonctionnelle de MP2.
