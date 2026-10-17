# Lot 2 — sauvegarde et restauration sécurisées

**440 contrôles automatiques, 0 échec** (383 avant le lot 2 : aucune régression, 71 nouveaux).
**Aucune migration. Aucun changement des calculs.** Les lots 1, 3 et 4 ne sont pas commencés.

Archive **cumulative** : lot A + MP1 + B3 + MP2 + lot 2.

---

## 1. La première chose à faire après l'installation

**Faites une sauvegarde complète tout de suite**, avant toute autre chose.

Vos sauvegardes existantes ont été faites par l'ancien code. Elles ne contiennent **ni vos
croquis techniques, ni vos photos de fournitures, ni votre logo** — c'est ce que le diagnostic a
chiffré : **93 images sur 171**. Et elles n'ont pas de manifeste, donc la nouvelle vérification
les refusera, avec ce message :

> Sans manifeste, cette sauvegarde ne peut pas être vérifiée. Elle a peut-être été faite par une
> version antérieure de l'application : elle est alors probablement incomplète.

C'est exact, et c'est volontaire : il vaut mieux refuser une sauvegarde douteuse que de la
restaurer et découvrir le manque après coup. **Ne les supprimez pas pour autant** — elles
contiennent une base valable, et rien dans ce lot n'y touche.

---

## 2. Installation

`Belvie-ERP-LOT2.zip` **sans dossier racine**, à extraire **à l'intérieur** de votre dossier de
projet.

**Aucune migration** : le lot 2 n'ajoute ni table ni colonne. Aucune ligne `[migration]` ne doit
apparaître au démarrage.

`electron/preload.js` est modifié : **arrêtez complètement l'application (Ctrl + C) avant de la
relancer.**

### Les sept fichiers qui changent, et aucun autre

```
nouveaux   electron/ipc/sauvegarde.js                        toute la mécanique, 0 dépendance Electron
           src/modules/settings/SauvegardeSection.tsx        l'écran

modifiés   electron/ipc/system.js        délègue au nouveau module ; copyImagesDirIfPresent supprimée
           electron/db/index.js          sauvegarde complète obligatoire avant migration
           electron/main.js              7 canaux de plus
           electron/preload.js           7 passerelles de plus
           src/global.d.ts               déclaration de l'API
           src/modules/settings/SettingsPage.tsx   remplace l'ancien bloc par le nouveau
```

**Vos six fichiers de calcul sont inchangés, octet pour octet**, par rapport à la livraison MP2 :
`besoins.js`, `calculBesoins.js`, `preparationBcMp.js`, `bcMp.js`, `ficheTechnique.js`,
`finance.js`. C'est votre exigence n° 8, et le contrôle `S65` la vérifie mécaniquement à chaque
exécution de la suite de tests.

---

## 3. Vos huit exigences, et où chacune vit

| # | Exigence | Où elle est tenue |
|---|---|---|
| **1** | Sauvegarde complète : base, toutes les images, documents, paramètres | On copie **tout le dossier de données sauf `backups`**. Énumérer les sous-dossiers connus était le défaut à corriger. Vos paramètres sont dans la table `parametres`, donc dans la base. |
| **2** | Sauvegarde automatique légère à la fermeture, avec inventaire | Base + manifeste d'inventaire. **Aucune image copiée.** |
| **3** | Sauvegarde complète avant toute installation ou migration | Au démarrage, **si et seulement si** une migration est en attente. Si elle échoue, **la migration n'a pas lieu**. |
| **4** | Emplacement externe au choix | Enregistré dans `parametres`, réutilisé par les sauvegardes d'avant-migration. |
| **5** | Manifeste et vérification d'intégrité | Un manifeste par sauvegarde, **neuf contrôles**, et une vérification immédiate après écriture. |
| **6** | Restauration testée sur un dossier isolé | « Essayer une restauration » : restaure ailleurs, vérifie le résultat, et **refuse** d'écrire dans votre dossier de données. |
| **7** | Conservation des anciennes sauvegardes | La rotation ne touche **que** `backups/auto`. Les sauvegardes complètes ne sont **jamais** purgées. |
| **8** | Aucun changement métier ni de calcul | Six fichiers de calcul identiques au bit près — contrôle `S65`. |

---

## 4. Ce qui apparaît dans Paramètres → Données et maintenance

Trois blocs au lieu d'un.

**Sauvegarde complète.** Dit ce qu'elle contient, laisse choisir un emplacement habituel (clé USB,
disque externe), et après chaque sauvegarde affiche **le résultat des neuf contrôles**, ligne par
ligne. Exemple sur vos volumes :

```
OK    Le manifeste est présent et lisible            type « complete », créé le 16/10/2026
OK    L'empreinte de la base est intacte             SHA-256 identique
OK    La base s'ouvre et passe PRAGMA integrity_check    ok
OK    Aucun lien cassé (PRAGMA foreign_key_check)
OK    Les comptages correspondent au manifeste       27 tables vérifiées
OK    Chaque image du manifeste est présente et intacte     171 fichier(s) vérifié(s)
OK    Chaque image citée par la base est dans la sauvegarde  171 référence(s), toutes présentes
```

**Essayer une restauration, sans risque.** Restaure dans un dossier vide de votre choix, puis
vérifie le résultat. Votre dossier de données n'est pas touché, et le code **refuse** de
l'utiliser comme cible — ce n'est pas une consigne, c'est un refus.

**Restaurer pour de bon.** Vérifie d'abord. **Déplace** vos données actuelles dans
`backups/avant-restauration-<date>` au lieu de les écraser. Refuse une sauvegarde automatique,
qui n'a pas les images.

---

## 5. Les décisions que j'ai prises, et pourquoi

### Tout le dossier, plutôt qu'une liste de dossiers

L'ancienne sauvegarde copiait `images/commandes` et rien d'autre. Lister les cinq dossiers connus
aurait corrigé le symptôme ; il aurait suffi qu'un sixième apparaisse pour que l'oubli
recommence. On copie donc tout, sauf `backups`. **Un dossier ajouté demain est couvert sans que
personne y pense.**

L'exclusion de `backups` n'est pas un détail : sans elle, chaque sauvegarde contiendrait les
précédentes.

### La sauvegarde automatique ne contient pas les images — et le dit

Votre décision n° 1. Le manifeste d'une sauvegarde automatique porte cet avertissement :

> Cette sauvegarde ne contient PAS les images. Elle sert à retrouver la base ; pour une
> restauration complète, utilisez une sauvegarde complète.

Et la restauration **refuse** d'utiliser une sauvegarde automatique : *« elle contient la base
mais PAS les images. La restaurer rendrait des fiches techniques sans croquis. »*

Son manifeste garde en revanche **l'inventaire** de vos 171 images — nom, taille, date. Deux
inventaires comparés disent si une image a disparu, sans avoir copié un seul octet.

### Si la sauvegarde d'avant-migration échoue, la migration n'a pas lieu

C'est votre mot : *obligatoire*. J'en ai tiré la conséquence stricte. Si la sauvegarde complète
préalable échoue ou ne passe pas sa propre vérification, **l'application s'arrête au démarrage**
avec un message qui nomme la cause, et vos données sont intactes — aucune migration n'a tourné.

Une application qui refuse de démarrer est désagréable. Une application qui migre sans sauvegarde
est pire. Avec 565 Go libres, ce cas ne devrait jamais se présenter ; mais s'il se présente, c'est
le bon comportement.

Elle ne se déclenche **que si une migration est réellement en attente**. La question est posée aux
modules de migration eux-mêmes (leurs fonctions `needsXxx`), jamais réimplémentée — deux
définitions de « faut-il migrer ? » finiraient par diverger, et la sauvegarde se ferait au mauvais
moment, ou pas du tout.

### Aucun prix n'est deviné sur la rotation

Les sauvegardes **automatiques** tournent, par défaut les **10 dernières** (au lieu de 5). Elles
ne pèsent plus que la base, donc en garder le double ne coûte presque rien. Les sauvegardes
**complètes** ne sont jamais purgées, où qu'elles soient.

Conséquence pour vous : **vos 5 sauvegardes automatiques actuelles**, celles qui contiennent les
images, resteront en place jusqu'à ce que 10 nouvelles existent. Si vous y tenez, copiez-les
ailleurs maintenant.

---

## 6. Ce qui a été vérifié — 71 contrôles

Tous portent sur de **vraies arborescences sur disque**, pas sur des doublures : c'est le seul
moyen de prouver qu'un fichier a été copié, déplacé, ou laissé en place.

### La sauvegarde complète, 16 contrôles
La base, les photos d'articles, **les croquis techniques**, les photos de fournitures, **le
logo**, les documents — tout est là. Les sauvegardes existantes ne sont **pas** recopiées dedans.
Les annexes du journal SQLite ne sont pas emportées. Le manifeste porte les comptages, les images
par dossier, et **une empreinte par fichier**.

### La vérification détecte-t-elle vraiment quelque chose ? 5 contrôles
J'ai abîmé la sauvegarde de quatre façons et vérifié que chacune est vue : une image supprimée,
**une image modifiée d'un seul octet**, une base altérée, un manifeste absent. Et une sauvegarde
intacte reste déclarée exploitable — un contrôle qui refuse tout ne vérifie rien.

### Le cas mesuré chez vous, 2 contrôles
Une image citée par la base mais absente du disque est **nommée** dans le manifeste, et la
vérification **refuse** de déclarer la sauvegarde exploitable.

### La sauvegarde automatique, 7 contrôles
Elle contient la base, **pas les images**, pèse la base plus quelques kilo-octets, inventorie les
images sans les copier, avertit de ce qu'elle n'a pas, et sa vérification la déclare valide en
disant que les images sont « sans objet ». La rotation garde le nombre demandé et **ne supprime
jamais une sauvegarde complète**.

### La restauration d'essai, 5 contrôles
Elle réussit, se vérifie elle-même, rend les croquis et le logo dans le dossier d'essai, et —
le contrôle qui compte — **le dossier de données réel n'a pas bougé d'un octet**. Elle refuse
d'écrire dans le dossier de données réel, et refuse un dossier d'essai non vide.

### La restauration réelle, 11 contrôles
La base est fermée avant et rouverte après. Le croquis supprimé revient. **Les données précédentes
sont déplacées, pas supprimées** — et elles sont intactes : la commande ajoutée entre-temps est
encore dans le dossier déplacé. Les sauvegardes existantes survivent. Restaurer une sauvegarde
automatique est refusé ; restaurer une sauvegarde qui échoue à la vérification est refusé ; et
**dans les deux cas, rien n'a été modifié**.

### La sauvegarde avant opération, 6 contrôles
Avec un emplacement externe elle y va, sans avertissement. Sans, elle se rabat dans
`backups/avant-migration` **et prévient qu'elle est sur le même disque**. Un emplacement externe
injoignable — clé non branchée — ne la fait pas échouer.

### Le branchement et la non-régression, 14 contrôles
La sauvegarde est déclenchée **avant** la première migration, seulement si une migration est en
attente, et son échec lève une erreur. L'ancienne fonction fautive a disparu du code. Les sept
canaux existent dans le handler, le preload et les types. Et les six fichiers de calcul sont
identiques à MP2.

### L'écran, vérifié en l'affichant
Monté dans un navigateur et photographié, en réussite et en échec : aucun débordement, aucune
erreur, et le tableau des contrôles reste lisible.

---

# Tests manuels

## Groupe S — la sauvegarde *(le plus important)*

- **S1** Paramètres → Données et maintenance → **Choisir** un emplacement (clé USB de préférence)
  → **Sauvegarder maintenant**.
- **S2** Les neuf contrôles doivent s'afficher, **tous en OK**, et le résumé annoncer environ
  **171 images et 81 Mo**. Si un contrôle est en échec, envoyez-moi la copie d'écran.
- **S3** Ouvrez le dossier créé : vous devez y trouver `images\fiches-techniques` (vos croquis),
  `images\entreprise` (votre logo) et `manifeste.json`. **C'est ce qui manquait.**
- **S4** Vérifiez qu'il **ne contient pas** de dossier `backups`.

## Groupe V — la vérification

- **V1** **Vérifier une sauvegarde** → choisissez celle que vous venez de faire : tout en OK.
- **V2** Choisissez une **ancienne** sauvegarde (faite avant ce lot) : elle doit être **refusée**,
  avec l'explication sur le manifeste absent. C'est le comportement attendu.
- **V3** Pour voir la vérification mordre : copiez votre sauvegarde ailleurs, supprimez-y une
  image dans `images\fiches-techniques`, puis vérifiez cette copie. Elle doit **échouer** et
  **nommer** le fichier manquant.

## Groupe R — la restauration

- **R1** **Essayer une restauration** → choisissez votre sauvegarde, puis un dossier **vide** (par
  exemple sur le Bureau). L'essai doit réussir, et le message rappeler que votre dossier de
  données n'a pas été touché.
- **R2** Ouvrez le dossier d'essai : croquis, logo et documents doivent y être.
- **R3** Vérifiez dans l'ERP que **rien n'a changé** : commandes, fiches techniques, images.
- **R4** *(facultatif, et seulement après S1)* **Restaurer pour de bon** depuis votre sauvegarde.
  Le message final doit indiquer où vos données précédentes ont été **déplacées**. Allez vérifier
  que ce dossier existe et contient bien l'ancienne base.

## Groupe N — non-régression

- **N1** Aucune ligne `[migration]` au démarrage.
- **N2** Approvisionnement : besoins, préparation des bons, bons MP — **inchangés**.
- **N3** Finance : coût d'une commande, dette d'un fournisseur — **aucun changement**.
- **N4** Fiches techniques, croquis, PDF — inchangés.
- **N5** Fermez l'application proprement, puis regardez
  `%APPDATA%\belvie-erp\backups\auto\` : la nouvelle sauvegarde automatique doit contenir
  `belvie.db` et `manifeste.json`, **et aucun dossier `images`**.

---

## 7. Ce qui reste, et dans quel ordre

Les lots **1** (figer le dossier de données + le verrou entre les deux versions), **3**
(l'installateur et l'icône) et **4** (les huit tests de migration) ne sont pas commencés, comme
convenu.

**Le lot 1 doit passer avant le lot 3** : fabriquer l'installateur avant d'avoir figé le dossier
de données produirait un `.exe` qui s'ouvre vide.

Et MP3 attend toujours votre feu vert, après validation fonctionnelle de MP2.
