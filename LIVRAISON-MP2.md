# MP2 — préparer et modifier les bons de commande matières

**383 contrôles automatiques, 0 échec** (334 avant MP2 : aucune régression, 49 nouveaux).
**Aucune migration. Aucune écriture financière.** MP3 n'est pas commencé.

Archive **cumulative** : elle contient le lot A, MP1, B3 et MP2. Si vous avez déjà installé la
version cumulative MP1 + B3, seuls le code change — pas la base.

---

## Installation

`Belvie-ERP-MP2.zip` **sans dossier racine**, à extraire **à l'intérieur** de votre dossier de
projet. Procédure complète : `PROCEDURE-INSTALLATION-MP2.md`.

**Aucune ligne de migration ne doit apparaître au démarrage.** MP2 n'ajoute ni table ni colonne :
tout ce qu'il écrit existe depuis MP1.

`electron/preload.js` est modifié : **arrêtez complètement l'application (Ctrl + C) avant de la
relancer.** Un rechargement à chaud ne reprend jamais ce fichier, et les nouveaux écrans
afficheraient un message d'erreur au lieu des bons.

---

## 1. Ce qui apparaît dans l'ERP

Le module **Approvisionnement** a maintenant deux onglets : **Besoins** (inchangé) et
**Bons de commande MP**.

### « Préparer des bons » — trois temps

```
1. Choisir les productions   →   2. Ajuster les lignes   →   3. Enregistrer en brouillon
```

**Le regroupement est le cœur de MP2.** Trois productions qui consomment le même sergé noir
donnent **une seule ligne d'achat**, avec le détail de ce que chaque production attend :

```
Sergé polyester 320 g / Noir 001
  nécessaire 778,05 m | commandé 300 m | reste à préparer 478,05 m
    ↳ CMD-2026-0042 : nécessaire 614,25 m, déjà commandé 300 m, reste à préparer 314,25 m
    ↳ CMD-2026-0043 : nécessaire 163,80 m, déjà commandé   0 m, reste à préparer 163,80 m
```

Sur chaque ligne vous ajustez la quantité, l'unité d'achat, le conditionnement, le fournisseur et
le prix. En bas, le récapitulatif **par fournisseur** : c'est lui qui montre combien de bons vont
naître, puisqu'**un bon ne concerne qu'un fournisseur**.

### « Bons de commande MP » — le suivi

La liste de tous les bons, avec recherche, filtre par statut, nombre de lignes, nombre de
productions servies et total HT. Un clic ouvre le bon : **tout y est modifiable tant qu'il est en
brouillon** — quantités, unités, conditionnements, prix, date de livraison, notes — et chaque
modification part immédiatement en base. Il n'y a pas de bouton « Enregistrer » : un écran qui
attend un enregistrement global fait perdre le travail dès qu'on change d'onglet.

---

## 2. Vos quatre décisions, et où chacune vit dans le code

| Votre décision | Où elle vit |
|---|---|
| **Un bon = un fournisseur** | Le récapitulatif groupe par fournisseur et crée un bon par groupe. `creerLot` **refuse** deux bons pour le même fournisseur dans un même lot. Le fournisseur ne se change pas depuis le détail d'un bon : ce serait un autre bon. |
| **Regroupement de plusieurs productions** | `preparationBcMp.regrouper`, et la clé de regroupement : type + composant du **catalogue** + coloris + unité de la fiche. |
| **Quantités en préparation distinctes des quantités commandées** | Inchangé depuis MP1, et vérifié à nouveau : un brouillon alimente « en préparation », jamais « commandé ». |
| **Conditionnement avec arrondi facultatif** | Le bouton `⤴ 5` n'apparaît **que** si l'arrondi change quelque chose, et il faut cliquer dessus. Son infobulle dit ce qu'il coûte : *« Arrondir à 5 conditionnements, soit 500 m (+21,95 m) »*. |

### Sur le regroupement, deux précisions qui comptent

**Le composant est identifié par son catalogue, jamais par sa désignation.** Deux fiches peuvent
nommer « Sergé » et « Sergé polyester » la même matière. Un composant **non relié au catalogue**
ne peut pas être regroupé en confiance : il reste sur sa propre ligne, et la pastille
« hors catalogue » le dit.

**L'unité de la fiche entre dans la clé.** Additionner des mètres et des kilos d'une même matière
donnerait un nombre qui ne veut rien dire.

### Sur la répartition entre productions — le point délicat

Quand vous commandez 478,05 m pour deux productions, il faut décider ce que chacune reçoit. **Ce
calcul est fait à un seul endroit : `bcMp.js`.** L'écran envoie les *poids* — le reste à préparer
de chaque production — et le backend divise au prorata, la dernière part absorbant le millième
d'arrondi.

J'aurais pu le calculer dans l'interface pour l'afficher en direct. Je ne l'ai pas fait : la même
règle écrite des deux côtés finit toujours par diverger, et l'écart ne se verrait qu'au coût de
revient, bien trop tard. L'écran affiche donc le reste à préparer de chaque production, et la
répartition réelle apparaît sur le bon une fois enregistré.

---

## 3. Les contrôles sur les coloris manquants

Vous les aviez demandés explicitement. Trois situations, trois traitements distincts — et aucune
ne bloque un **brouillon**, parce qu'un brouillon sert justement à voir ce qui manque.

| Situation | Dans la préparation | À la validation (MP3) |
|---|---|---|
| **Coloris absent** — la couleur produit n'a aucune correspondance | Ligne surlignée, pastille « coloris à préciser », quantité **visible** | **Bloquant** |
| **Coloris déclaré mais non arrêté** | Même traitement | **Bloquant** |
| **« Toutes couleurs »** — fil, étiquette de composition | Rien. Ce composant n'a pas besoin de coloris | Non bloquant |

La règle qui tranche est celle du § 7 bis de votre document d'architecture, et elle ne devine rien
à partir du libellé : c'est la **clé de cible** qui décide. `*` signifie qu'aucune correspondance
de couleur n'est déclarée sur ce composant — il est identique quelle que soit la couleur du
vêtement.

Chaque blocage porte son message **et l'endroit où corriger** :

> Le coloris de « Bord-côte 2×2 » n'est pas arrêté pour À définir (Marine) : impossible de
> commander la bonne couleur.
> *(Fiche technique → onglet Matières → coloris de la ligne)*

**Deux autres contrôles du même genre**, qui n'existaient nulle part :

- **quantité incalculable** — une consommation manque : la ligne n'est **pas cochée d'office**,
  sa quantité affiche « — » et non zéro. Un zéro coché ferait commander un chiffre que personne
  n'a vu ;
- **unité d'achat indéterminée** — les achats n'acceptent que le mètre, le kilo, la pièce et le
  lot. « pièce », « m », « kg » et « lot » sont traduits ; **« bobine », « paire » et « jeu » ne
  le sont pas** et demandent un choix. Deviner reviendrait à commander la mauvaise quantité sans
  que rien ne le signale.

Ces trois contrôles **empêchent l'enregistrement** seulement quand ils rendent la ligne
inexploitable : pas de fournisseur, pas d'unité, pas de quantité. Le coloris et le prix, eux,
laissent passer le brouillon et sont annoncés comme bloquants pour la suite.

---

## 4. Ce qui a été vérifié — 49 contrôles

### Le regroupement, 8 contrôles
Deux productions sur le même tissu donnent **une** ligne de 778,05 m, et le détail par production
est conservé au millième. Deux coloris du même tissu restent **deux** lignes. Les coloris de
fournitures de B3 sont respectés. Un composant « toutes couleurs » donne une ligne sans coloris
requis. La somme des poids vaut exactement le reste à préparer.

### Les contrôles, 8 contrôles
Le coloris absent, la quantité incalculable, l'unité indéterminée — chacun signalé, nommé, compté,
avec son « où corriger ». Et la preuve que les unités ambiguës **ne sont pas devinées**.

### Le conditionnement, 3 contrôles
1 460 m en rouleaux de 100 → proposition de 15 rouleaux, soit 1 500 m, **supplément 40 m annoncé**.
Une quantité déjà juste est reconnue comme telle. Un conditionnement absurde ne propose rien.

### Les fournisseurs proposés, 4 contrôles
Un tarif saisi passe devant un simple historique d'achat. **Aucun prix n'est reconstitué** à
partir d'un montant engagé divisé par une quantité : ce montant peut inclure du transport ou une
remise, et un prix inventé serait pire que pas de prix — il se laisserait valider sans qu'on le
relise. Un tarif périmé n'est plus proposé.

### De la préparation au brouillon, 11 contrôles
Un bon par fournisseur, numérotés à la suite. La répartition calculée au prorata, sa somme égale à
la quantité au millième. Un brouillon compte « en préparation » et **jamais** comme commandé.
Un second passage ne repropose pas ce qui est déjà sur un brouillon, mais le montre.

**Tout ou rien :** un lot dont un bon est refusé n'enregistre rien du tout, **et le compteur de
numéros n'a pas avancé**. Deux bons pour le même fournisseur dans un lot sont refusés.

### La modification d'un brouillon, 9 contrôles
Y compris **un défaut de MP1 que l'usage a révélé** — voir le § 5.

### L'absence d'écriture financière, 3 contrôles
Une empreinte de **13 tables** — dont `achats`, `achats_affectations`, `achats_factures`,
`paiements`, `prix_fournisseurs`, `estimations`, `commandes`, `fiches_techniques` — est prise
avant, puis après avoir regroupé, créé, modifié, recalculé et supprimé. Elle est **identique**.
Un troisième contrôle lit le code source du module de préparation pour vérifier qu'il ne contient
**aucun `INSERT`, `UPDATE` ni `DELETE`**. Si une écriture y apparaissait un jour, le test le dirait
avant vous.

### Les écrans, vérifiés en les affichant
Les trois écrans ont été montés dans un navigateur et photographiés : **aucun débordement
horizontal** malgré 13 colonnes, l'arrondi proposé affiche bien « 5 conditionnements, soit 500 m
(+21,95 m) » et l'applique au clic, et une quantité refusée **revient à la valeur enregistrée**
avec son message — elle ne reste pas à l'écran comme si elle avait été acceptée.

---

## 5. Un défaut de MP1 corrigé, et deux limites assumées

### Le défaut

Modifier la **seule quantité** d'une ligne de bon échouait. La répartition entre productions était
reprise telle quelle, sa somme ne valait plus la quantité de la ligne, et la modification était
refusée. C'est pourtant l'action la plus courante de l'écran : ajuster une quantité.

Désormais, les parts existantes servent de **poids** et la répartition est recalculée au prorata.
Passer de 1 000 à 1 500 m sur une ligne répartie 800 / 200 donne 1 200 / 300. Contrôle `P36`.

### Deux limites que je préfère vous dire

1. **Le détail d'un bon ne refait pas le contrôle des coloris.** Il affiche ce que la ligne porte,
   y compris « À définir (Marine) », mais il ne sait pas dire *pourquoi*. C'est « Préparer des
   bons », qui part des besoins, qui nomme les lignes concernées — et ce sera la validation de MP3
   qui refusera. L'écran le dit en toutes lettres plutôt que de faire croire à un contrôle qu'il
   ne fait pas.
2. **On n'ajoute pas une ligne depuis le détail d'un bon.** Les lignes viennent des besoins ; pour
   en ajouter, on repasse par « Préparer des bons », où le récapitulatif propose **« Ajouter au
   brouillon MP001-26 »** au lieu de créer un nouveau bon. Nouveaux bons et ajouts partent dans
   **une seule transaction**.

---

## 6. Ce que MP2 ne fait pas, et qui vient à MP3

- **Valider un bon** — et donc créer les engagements (`achats` + `achats_affectations`).
- **Le PDF** du bon de commande.
- **La correction du calcul des stocks** : baser « acheté » sur les réceptions plutôt que sur les
  quantités commandées, et ajouter `en_commande` à côté. C'est votre décision 7 de MP1.
- **Le traitement des anciens achats sans réception enregistrée**, pour qu'aucun stock existant ne
  diminue artificiellement.

Les deux derniers points vous seront présentés **avant** d'être construits, avec une comparaison
avant/après sur vos chiffres réels, comme convenu.

---

# Tests manuels

## Groupe M — la préparation *(le plus important)*

- **M1** Approvisionnement → **Bons de commande MP** → **Préparer des bons**. Cochez **deux
  productions qui partagent un même tissu** → **Regrouper les besoins**.
- **M2** Le tissu commun doit apparaître sur **une seule ligne**, et la colonne « Prod. » afficher
  **2**. Cliquez sur ce **2** : le détail par production s'ouvre, et la somme des « reste à
  préparer » doit valoir celle de la ligne.
- **M3** Saisissez une taille de conditionnement (par exemple `100`) : le bouton **⤴** apparaît.
  Survolez-le — il annonce le supplément. Cliquez : la quantité monte au conditionnement entier.
  **Ne cliquez pas** : elle ne bouge pas.
- **M4** Attribuez des fournisseurs **différents** à deux lignes. Le récapitulatif doit montrer
  **deux fournisseurs, donc deux bons**.
- **M5** **Enregistrer en brouillon**. Deux bons doivent naître, numérotés `MP001-26`, `MP002-26`.
- **M6** Relancez le regroupement sur les mêmes productions : les lignes enregistrées ont
  **reste à préparer = 0**, et la colonne « En prépa. » montre ce qui est sur le brouillon.
- **M7** Retournez aux **Besoins** → cette production : « Commandé » **n'a pas bougé**, et les
  colonnes « En préparation » / « Reste à préparer » sont apparues.

## Groupe C — les coloris et les contrôles

- **C1** Sur un article dont une matière n'a **pas** de correspondance de coloris pour une
  couleur : la ligne est surlignée, porte « coloris à préciser », et sa **quantité reste visible**.
- **C2** Cliquez sur le nombre de productions de cette ligne : le blocage doit nommer l'endroit où
  corriger.
- **C3** Le brouillon doit **accepter** cette ligne — c'est voulu.
- **C4** Une fourniture dont l'unité de fiche est « bobine » ou « paire » : l'unité doit être
  **à choisir**, en orange, et l'enregistrement refusé tant qu'elle ne l'est pas.
- **C5** Une ligne dont une consommation manque : **décochée d'office**, quantité « — » et non 0.

## Groupe B — modifier un brouillon

- **B1** Ouvrez un brouillon → **Modifier**. Changez une quantité : la répartition par production
  se recalcule au prorata, et le total suit.
- **B2** Saisissez `0` ou une valeur négative : **refusé**, et le champ **revient** à sa valeur.
- **B3** Effacez un prix : la ligne passe en « sans prix », le brouillon reste valide.
- **B4** Supprimez une ligne, puis le brouillon. Le message doit rappeler que **le numéro ne sera
  pas réattribué**.
- **B5** Après suppression, le regroupement doit **reproposer** ces quantités en « reste à
  préparer ».

## Groupe R — non-régression

- **R1** Besoins : la liste et le détail **inchangés**, chiffres compris. Relancez
  `verifier-besoins.js` avant et après si vous voulez la preuve mécanique.
- **R2** Finance : coût d'une commande, dette d'un fournisseur, synthèse — **aucun changement**,
  y compris après avoir créé des brouillons.
- **R3** Fiche technique : nomenclature, coloris de fournitures (B3), révisions, PDF — inchangés.
- **R4** Commandes de production et BC PF — inchangés.
