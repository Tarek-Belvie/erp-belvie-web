# Confirmation avant développement — adoption manuelle et gel à la validation

Vos décisions sont enregistrées. **Je ne développe rien tant que vous n'avez pas répondu au § 8.**
Voici, point par point, ce que je confirme, ce que je dois vous signaler, et les trois questions
qu'il reste à trancher.

Un outil d'inventaire en lecture seule est livré (§ 7) : il répond en dix secondes, **sur vos
données**, à la question dont dépend tout le § 2.

---

## 1. Ce que je confirme, en une page

| Votre exigence | Confirmé | Comment |
|---|---|---|
| Adoption manuelle, production par production | **oui** | bouton visible seulement si la référence est en retard ; aucun traitement automatique ni global |
| Comparaison avant / après | **oui** | composant par composant, ajouté / retiré / modifié, ancienne et nouvelle valeur côte à côte — déjà produit par l'outil du diagnostic |
| Confirmation explicite | **oui** | la comparaison **et** l'état des BC MP concernés sont affichés avant, pas après |
| Traçabilité | **oui** | motif `adoption_manuelle`, date, opérateur, **et conservation de la référence remplacée** (§ 4) |
| Gel dès la validation de la production | **oui** | nouveau motif `validation_commande`, dans la transaction de validation |
| Les brouillons suivent la fiche | **oui** | aucun gel sur un brouillon ; c'est déjà le cas aujourd'hui |
| Aucun écrasement rétroactif des BC MP | **oui** | les bons ne sont jamais recalculés (§ 3) |
| « Hors approvisionnement » réservé aux exclusions réelles, justifié, visible | **oui** | justification **obligatoire**, composant affiché avec son motif (§ 5) |
| Bandeau à trois états distincts | **oui** | § 6 |
| Actualisation groupée et MP3 reportés | **oui** | rien n'est commencé |

**Deux points demandent votre décision et non ma confirmation** : le sort des productions
historiques (§ 2) et la portée exacte de l'unité d'achat (§ 5). Je ne les tranche pas à votre
place, parce que l'un touche vos 44 productions existantes et l'autre votre façon d'acheter.

---

## 2. Les productions historiques — le point le plus délicat

### Le problème, posé franchement

Vous décidez que **la nomenclature est figée dès la validation de la production**. Cette règle
vaut à partir de maintenant. Mais vos productions déjà validées, elles, n'ont rien eu de figé :
aujourd'hui, seules les productions dont la fiche a été rouverte au moins une fois ont une
référence.

Et voici ce que je ne peux pas faire, quoi que je développe :

> **Pour une production déjà validée sans référence figée, la nomenclature telle qu'elle était au
> jour de sa validation n'existe nulle part.** Elle n'a jamais été enregistrée. Aucun mécanisme ne
> permet de la reconstituer.

Ce que nous avons, ce sont les révisions archivées des fiches **qui ont été rouvertes** — et pour
celles-là, la production a justement déjà sa référence. Pour les autres, il n'y a rien à retrouver.

Je préfère vous le dire avant de développer plutôt que de vous livrer une reprise qui aurait l'air
de restaurer une vérité historique sans en être une.

### Un fait qui rassure, et qu'il faut bien comprendre

Une fiche **validée** ne peut être modifiée qu'en passant par « Modifier la nomenclature », ce qui
fige aussitôt les productions décidées. Donc : **une production sans référence figée dont la fiche
est validée voit aujourd'hui la même nomenclature qu'au jour de sa validation.** Pour celles-là,
figer maintenant depuis la fiche actuelle enregistre exactement la bonne référence.

L'exception est la production validée alors que **sa fiche était encore en brouillon** : la fiche
a pu changer depuis, sans aucune trace. Pour ces productions-là, et pour elles seules, figer
aujourd'hui enregistrerait une référence qui n'est pas celle du jour de la validation.

**L'inventaire du § 7 vous dit combien de productions sont dans chaque cas.** C'est pour cela que
je vous le livre avant de développer.

### Les trois options, et leurs conséquences

#### Option H1 — Une reprise explicite, que vous déclenchez *(ce que je recommande)*

Un écran « Références techniques » listant les productions décidées sans référence, avec le statut
de leur fiche, et un bouton « Figer la référence de ces N productions ». Vous voyez la liste, vous
confirmez, c'est écrit avec le motif **`reprise_historique`** — distinct de `validation_commande`
et d'`adoption_manuelle`, pour qu'on sache toujours qu'une référence a été reprise et non captée.

- **Conséquence sur les besoins : aucune, à l'instant de la reprise.** La référence figée est la
  fiche actuelle, donc les quantités calculées sont rigoureusement identiques la seconde avant et
  la seconde après. **Rien n'est modifié rétroactivement.**
- **Conséquence après :** ces productions ne suivront plus les évolutions de la fiche. C'est
  précisément la règle que vous venez de choisir.
- **Les productions dont la fiche est en brouillon sont signalées à part** dans la liste, avec un
  avertissement : leur référence sera celle de la fiche actuelle, pas celle du jour de validation.
  Vous pouvez les figer ou les laisser.
- **Rien n'est silencieux** : pas de migration qui écrit 44 lignes au démarrage.

#### Option H2 — Ne rien reprendre

Le gel ne s'applique qu'aux validations futures. Les productions existantes continuent de suivre
la fiche jusqu'à ce que quelqu'un rouvre celle-ci.

- **Conséquence :** la règle que vous venez d'énoncer ne s'applique pas aux 44 productions que
  vous êtes précisément en train d'approvisionner. C'est le cas d'usage réel qui resterait
  découvert.
- Je ne la recommande pas, mais elle est défendable si vous préférez ne rien écrire du tout sur
  l'existant.

#### Option H3 — Une reprise automatique à la migration

Techniquement le plus simple, et **je l'écarte** : écrire une référence sur 44 productions au
premier démarrage, sans que vous l'ayez vu ni demandé, c'est exactement l'actualisation silencieuse
que vous refusez depuis le début. Je ne la proposerai pas.

### Ce qui se passe en toute hypothèse

- **Une production annulée n'est jamais figée** : elle ne produira rien.
- **Une production terminée est figée comme les autres** : sa référence technique fait partie de
  son historique et de son coût.
- **Une production validée ne peut pas repasser en brouillon** — j'ai vérifié : seule l'annulation
  existe. Il n'y a donc aucun cas de « dégel » à traiter.
- **Le gel à la réouverture de la fiche est conservé tel quel.** Il ne fige que les productions qui
  n'ont pas encore de référence, donc il ne contredira jamais le gel à la validation.

---

## 3. Les BC MP existants — ce qui change et ce qui ne change pas

### La règle

**Un bon de commande MP déjà préparé n'est jamais recalculé, jamais réécrit, jamais supprimé par
une adoption.** C'est un engagement : il est un fait, pas un résultat.

Ce qui change après adoption : **le reste à commander, et lui seul.** Les bons continuent d'être
déduits du « déjà commandé » exactement comme avant.

| | Avant adoption | Après adoption |
|---|---|---|
| Lignes du bon MP, quantités, fournisseur, prix | — | **inchangés** |
| Affectations du bon aux productions | — | **inchangées** |
| Besoin nécessaire | ancienne nomenclature | nouvelle nomenclature |
| Déjà commandé | les bons existants | **les mêmes bons existants** |
| **Reste à commander** | — | **recalculé** |

### Le cas qui demande de l'attention, et qui est déjà traité

Si la nouvelle révision **retire** un composant, ou **change son unité**, un bon MP peut porter sur
quelque chose qui n'est plus dans la nomenclature. Cet engagement ne doit pas disparaître de la
vue : il doit devenir visible comme anormal.

**Ce mécanisme existe déjà** et n'a pas à être créé : le moteur produit une liste
`engagements_non_rattaches`, avec son motif, par exemple :

> « Aucune ligne de besoin ne correspond à ce composant et cette couleur »

L'écran des besoins l'affiche déjà. Après une adoption qui retire un composant, l'engagement
correspondant apparaîtra donc dans cette liste, avec son achat et sa quantité. **Rien n'est perdu,
rien n'est masqué, et aucun chiffre n'est inventé.**

### Ce que l'écran de confirmation dira, avant d'agir

- combien de bons MP portent sur cette production, et leurs numéros ;
- qu'ils **ne seront pas modifiés** ;
- que le reste à commander sera recalculé ;
- **et, si l'adoption retire ou modifie un composant déjà engagé, lequel** — c'est le seul cas où
  l'adoption mérite une hésitation, donc il doit être nommé avant et non découvert après.

---

## 4. L'historique des changements — un point que je dois corriger

### Le problème dans la structure actuelle

```sql
CREATE TABLE commandes_recette_figee (
  commande_id INTEGER PRIMARY KEY ...     -- UNE SEULE ligne par production
```

Une production n'a qu'une référence. **Une adoption remplacerait donc la précédente, et la
référence d'avant serait perdue.** C'est incompatible avec votre exigence de traçabilité, et c'est
une limite de ma conception initiale : le gel avait été pensé comme un événement unique.

### La correction, strictement additive

Une table d'historique **en ajout seul**, qui reçoit la référence remplacée avant qu'elle ne le
soit :

```sql
CREATE TABLE commandes_recette_figee_historique (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  commande_id INTEGER NOT NULL,
  fiche_revision INTEGER NOT NULL,
  composants_json TEXT NOT NULL,      -- la référence complète, telle qu'elle servait
  figee_le TEXT NOT NULL,             -- quand elle avait été posée
  figee_motif TEXT NOT NULL,          -- validation_commande | revision_fiche | reprise_historique
  remplacee_le TEXT NOT NULL,         -- quand elle a cessé de servir
  remplacee_par_motif TEXT NOT NULL,  -- adoption_manuelle
  remplacee_par_id INTEGER            -- opérateur
);
```

Pourquoi ce découpage plutôt qu'une table versionnée unique :

- `commandes_recette_figee` continue de contenir **la référence en vigueur, une par production** ;
- donc **`besoins.js` n'est pas modifié du tout** — le chemin de lecture du calcul reste celui qui
  est éprouvé par 81 contrôles automatiques ;
- l'historique est en ajout seul : rien ne s'y écrase, et une ligne d'historique n'a aucun effet
  sur un calcul.

Vous pourrez ainsi lire, pour une production : *« référence d'origine figée le 3 mars à la
validation, remplacée le 17 octobre par adoption manuelle depuis la révision 2 »* — avec les deux
nomenclatures intégralement conservées.

### Ce que l'historique conserve, et où

| Élément | Où il est conservé | Déjà en place ? |
|---|---|---|
| La nomenclature de référence remplacée | `commandes_recette_figee_historique` | **à créer** |
| La fiche technique complète de chaque révision | `fiches_techniques_revisions` | oui |
| Qui a adopté, quand, et depuis quelle révision | les deux tables ci-dessus | partiellement |
| Les BC MP et leurs affectations | `bc_mp`, `bc_mp_ligne_productions` | oui, et jamais touchés |
| Les achats et réceptions | `achats`, `achats_affectations`, `achats_receptions` | oui, et jamais touchés |

**Aucune suppression nulle part.** Toutes les migrations restent additives : des `CREATE TABLE IF
NOT EXISTS` et des `ALTER TABLE ADD COLUMN`, rien d'autre.

---

## 5. Option C — votre restriction est juste, et elle demande un champ qui n'existe pas

Vous distinguez trois choses. J'ai vérifié ce qui existe réellement :

| Notion | État dans la base | Commentaire |
|---|---|---|
| **Consommation par pièce** | existe | `ft_matieres.consommation_technique`, `ft_accessoires.consommation_par_piece` |
| **Unité de consommation** | existe, mais inégalement | matières : contraint à `kg, m, piece, lot`, **jamais vide**. Fournitures : **texte libre et nullable** — d'où « unité manquante » pour le zip |
| **Unité d'achat** | **n'existe pas** | aucun champ, aucun facteur de conversion |

**Votre restriction est donc exacte et elle met le doigt sur un vrai manque.** « Bobine » ou
« rouleau » saisi dans le champ d'unité d'une fourniture est une unité d'achat écrite dans une case
prévue pour une unité de consommation. Le moteur, qui attend une mesure, ne peut rien en faire ;
et la préparation des bons MP, qui n'accepte que `kg, m, piece, lot`, la refuse.

### Ce que je propose

**Deux champs additifs** sur les composants : `unite_achat` (libre : rouleau, bobine, cône…) et
`quantite_par_unite_achat` (combien d'unités de consommation dans une unité d'achat — par exemple
50 m par rouleau). Le besoin reste calculé en **unité de consommation** ; l'unité d'achat ne sert
qu'à proposer une quantité à commander dans le bon MP, avec l'arrondi à l'unité d'achat supérieure.

Un biais consommé à 0,8 m/pièce et acheté au rouleau de 50 m **reste approvisionnable** : 45 pièces
× 0,8 m = 36 m, soit 1 rouleau. C'est exactement votre exigence.

**Deux précautions que je dois annoncer :**

**Je n'ajouterai pas de contrainte `CHECK` sur les unités existantes.** `ft_accessoires.unite` est
en texte libre et contient peut-être déjà « bobine » ou « paire » chez vous. Ajouter une contrainte
à une colonne existante impose à SQLite de **reconstruire la table** — c'est une migration
destructive, et je m'y suis engagé à ne jamais en faire. La validation se fera donc à l'écriture,
dans le code, et les valeurs existantes qui ne sont pas des mesures seront **signalées** dans les
besoins, jamais rejetées ni réécrites.

**« Hors approvisionnement » sera verrouillé comme vous le demandez** : justification obligatoire
(impossible de cocher sans écrire pourquoi), le composant **reste affiché** dans les besoins avec
son motif, et il n'est jamais compté pour zéro ni masqué.

---

## 6. Le bandeau — les quatre états

Vous en demandez trois ; il en faut quatre, parce que l'absence de référence est un état à part
entière et c'est celui de la plupart de vos productions aujourd'hui.

| État | Message | Action proposée |
|---|---|---|
| **Pas de référence figée** | « Cette production suit la fiche technique actuelle (révision N) : elle changera si la fiche change. » | figer la référence (§ 2) |
| **Fiche en cours de modification** | « La fiche technique est en cours de modification. Cette production garde sa référence figée du … ; les changements en cours ne lui seront proposés qu'après revalidation de la fiche. » | aucune — il n'y a rien à adopter tant que la fiche n'est pas validée |
| **Révision validée plus récente** | « Référence figée depuis la révision 1. La fiche est aujourd'hui en révision 2 : cette production n'en tient pas compte. » | **« Comparer et adopter »** |
| **Référence à jour** | « Référence figée le …, issue de la révision en vigueur. » | aucune |

Le deuxième état est celui qui vous a coûté du temps : aujourd'hui le bandeau affirme dans ce cas
« Elle correspond à la révision en vigueur », ce qui est vrai pour les numéros et faux pour vous.

---

## 7. L'outil d'inventaire, livré aujourd'hui

```
npm run diagnostic:recette -- --toutes
```

**Lecture seule**, comme le diagnostic par production : base ouverte en `readonly`, un seul fichier
écrit — son rapport — dans le dossier du projet. Il ne fige rien et ne modifie aucune production.

Il liste toutes vos productions décidées et, pour chacune, si elle a une référence figée, de quelle
révision, et si elle est en retard :

```
  SANS référence figée (suivent la fiche actuelle) : 1
  Figées et À JOUR avec la révision en vigueur      : 0
  Figées et EN RETARD d'au moins une révision       : 0

  Production        Statut            Référence       Révision          Article
  CMD-2026-0042     validee           AUCUNE          suit la fiche 1   Bomber
```

Je l'ai éprouvé sur les deux cas : production figée en retard, et production sans référence.

**C'est ce rapport qui doit décider du § 2.** S'il montre 40 productions sans référence, la reprise
H1 est indispensable ; s'il en montre deux, la question est bien plus légère.

Aucune réinstallation : rien dans l'application n'a changé, la version reste **1.0.1**.

---

## 8. Ce que j'attends de vous avant de développer

1. **Le sort des productions historiques : H1, H2 ?** (je recommande H1) — et, si H1, faut-il
   inclure les productions dont la fiche est encore en brouillon, qui sont le seul cas où la
   référence reprise n'est pas forcément celle du jour de validation ?
2. **La portée de l'unité d'achat :** le couple `unite_achat` + `quantite_par_unite_achat` tel que
   décrit au § 5 vous convient-il, ou souhaitez-vous d'abord vous limiter à rendre
   « hors approvisionnement » modifiable, et traiter l'unité d'achat ensuite ?
3. **Les deux rapports sur vos données réelles :**
   `npm run diagnostic:recette CMD-2026-047` et `npm run diagnostic:recette -- --toutes`.
   Le premier confirmera le cas du biais — **consommation inconnue ou simplement non saisie, ce
   n'est pas la même réponse métier** — et le second décidera du § 2.

Sur ces trois points, je ne veux pas choisir à votre place : le premier écrit sur vos productions
existantes, le deuxième touche à votre façon d'acheter, et le troisième, je ne peux pas le lire
d'ici.

**Le périmètre que je développerai ensuite**, et rien de plus : le gel à la validation, l'adoption
manuelle avec comparaison et confirmation, l'historique en ajout seul, les quatre états du bandeau,
la reprise historique si vous la retenez, et les contrôles automatiques correspondants. **MP3 et
l'actualisation groupée restent hors périmètre.**
