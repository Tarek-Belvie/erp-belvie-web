# Diagnostic — les corrections de fiche technique ne descendent pas dans les besoins

**580 contrôles automatiques, 0 échec. Aucune ligne de l'application n'est modifiée par cette
livraison** : elle n'apporte qu'un outil de diagnostic en lecture seule. Le mécanisme
d'actualisation n'est **pas** développé, conformément à votre demande.

---

## 1. La réponse, en trois phrases

**L'approvisionnement de CMD-2026-047 n'utilise pas la dernière fiche technique. Il utilise la
nomenclature figée au moment où vous avez rouvert la fiche pour la corriger.** Vos corrections
sont enregistrées, lisibles et correctes : elles sont simplement dans une révision que cette
production ne regarde pas.

Ce n'est pas une panne, c'est la protection qui fonctionne. **Mais il manque la moitié du
mécanisme : rien ne permet aujourd'hui d'accepter la nouvelle révision pour une production
donnée.** La protection a été construite, la porte de sortie jamais.

---

## 2. Le mécanisme réel, tel qu'il est écrit

Un seul endroit du code décide d'où part le calcul — `electron/ipc/besoins.js`, ligne 472 :

```js
const figee = lireRecetteFigee(db, commandeId);
const tousComposants = lisible
  ? figee.composants                       // la recette figée, si elle existe
  : lireMatieres(...).concat(lireFournitures(...));   // sinon, la fiche actuelle
```

Et le gel est écrit à un seul endroit, `revisionsFiche.js`, **au moment où vous cliquez
« Modifier la nomenclature »** :

| Quand | Ce qui se passe |
|---|---|
| Validation d'une **production** | **rien n'est figé.** La production suit la fiche. |
| « Modifier la nomenclature » sur une fiche validée | la révision est archivée, **et la recette est figée sur chaque production décidée** (validée, en production, contrôle qualité, terminée) |
| Revalidation de la fiche | le numéro de révision avance (1 → 2) |
| Affichage des besoins | **lecture seule, ne fige jamais rien** |

C'est le bon découpage : c'est le geste de corriger la fiche qui protège les productions en cours,
et non la consultation des besoins.

---

## 3. La séquence, rejouée et observée

Je n'ai pas déduit ce diagnostic : je l'ai reproduit, avec vos deux défauts exacts — un biais sans
consommation, un zip sans unité. Voici ce que le moteur répond à chaque étape.

| Étape | Source | Révision figée / actuelle | Avertissement | Biais | Zip |
|---|---|---|---|---|---|
| **1.** Production validée, fiche en révision 1 | fiche | — / 1 | — | `consommation_absente` | `unite_absente` |
| **2.** Vous cliquez « Modifier la nomenclature » | **figée** | 1 / 1 | **aucun** | `consommation_absente` | `unite_absente` |
| **3.** Corrections saisies, fiche en brouillon | **figée** | 1 / 1 | **aucun** | `consommation_absente` | `unite_absente` |
| **4.** Fiche revalidée en révision 2 | **figée** | 1 / **2** | « révision en retard » | `consommation_absente` | `unite_absente` |

Et la fiche, au même instant, lue sans le gel : **biais 0,8 m/pièce, zip en « piece »**. Les
corrections sont bien là.

Trois choses se lisent dans ce tableau.

**Le « calcul incomplet » n'est pas un troisième problème.** C'est la conséquence des deux autres :
une pièce dont la consommation n'a pas pu être retenue n'est comptée nulle part, et le moteur le
dit plutôt que de la compter pour zéro. Corrigez le biais, il disparaît.

**Aux étapes 2 et 3, aucun avertissement n'est affiché.** Tant que la fiche est en brouillon, la
révision figée (1) et la révision actuelle (1) sont égales : l'écran affiche donc « Elle correspond
à la révision en vigueur » — rassurant, et faux. **C'est un vrai défaut, distinct du sujet
principal, et il est de ma responsabilité** (§ 7).

**L'avertissement de l'étape 4 existe déjà.** Sur la page des besoins de la production, un bandeau
dit : *« Recette technique figée le …, depuis la révision 1 … La fiche est aujourd'hui en
révision 2 : cette production n'en tient pas compte. »* Si vous le voyez sur CMD-2026-047, le
diagnostic est confirmé sur vos données.

---

## 4. Vos cinq questions, une par une

### 4.1 Dernière fiche, ou nomenclature figée ?

**La nomenclature figée**, dès lors qu'une recette figée existe pour la production. Vérifiable en
dix secondes sur le bandeau de la page des besoins, et formellement par l'outil du § 8.

### 4.2 Versionnement, calcul, enregistrement, ou lecture ?

**Aucun des quatre n'est en cause.** J'ai vérifié chacun :

| Hypothèse | Vérdict | Preuve |
|---|---|---|
| **Versionnement cassé** | non | la révision avance bien à la revalidation (1 → 2, observé à l'étape 4) |
| **Calcul faux** | non | les mêmes composants donnent les mêmes anomalies à chaque étape ; le moteur est déterministe et ses 81 contrôles passent |
| **Enregistrement perdu** | non | la fiche contient bien 0,8 m et « piece » après correction (§ 3, dernière ligne) |
| **Lecture fautive** | non | la lecture est correcte — elle porte simplement sur l'instantané figé |

**Ce qui est réellement en cause, ce sont deux manques :**

**(a) `adoption_manuelle` n'a jamais été implémenté.** La table porte ce commentaire, écrit par
moi :

```sql
-- validation_commande | revision_fiche | adoption_manuelle
figee_motif TEXT NOT NULL,
```

Trois motifs prévus. **Un seul est écrit dans tout le code : `revision_fiche`.** Le motif
`adoption_manuelle` désignait exactement le mécanisme que vous demandez au point 4 — il a été
nommé, décrit, et jamais construit. Le drapeau `revision_en_retard` est calculé et affiché, mais
**rien ne permet d'agir dessus.**

**(b) `hors_approvisionnement` est lu mais non modifiable.** Les colonnes existent, l'écran des
besoins les affiche — mais **aucun canal IPC et aucune interface ne permettent de poser ce
drapeau**. C'est la réponse prévue pour un composant dont la consommation par pièce n'a pas de
sens (un biais acheté au rouleau, par exemple), et elle est aujourd'hui inaccessible.

### 4.3 Comment appliquer une correction à une production déjà validée, aujourd'hui ?

**Proprement : on ne peut pas.** Voici les trois contournements possibles, et ce qu'ils coûtent.
Je les décris pour être complet, **je n'en recommande aucun.**

| Contournement | Effet | Ce qu'il casse |
|---|---|---|
| Repasser la production en brouillon puis la revalider | ne change rien : rien ne supprime la recette figée existante | rien, mais inutile |
| Supprimer la ligne de `commandes_recette_figee` à la main (SQL) | la production repasse sur la fiche actuelle | **aucune trace**, aucune confirmation, aucune comparaison préalable — exactement l'actualisation silencieuse que vous refusez |
| Recréer la production | besoins corrects | perd l'historique, le numéro, les achats affectés et les bons MP déjà préparés |

C'est précisément parce qu'aucune de ces trois voies n'est acceptable qu'il faut construire la
quatrième.

### 4.4 et 4.5 Le mécanisme d'actualisation, et ce qu'il doit préserver

Ce que je propose, dans ses principes — à valider avant toute ligne de code :

**Un geste explicite, par production.** Sur la page des besoins, quand et seulement quand
`revision_en_retard` est vrai, un bouton « Actualiser la nomenclature de cette production ».
Jamais automatique, jamais global, jamais au chargement d'un écran.

**Un écran de comparaison AVANT, pas un message après.** Composant par composant : ajouté,
retiré, modifié — et pour chaque modification, l'ancienne et la nouvelle valeur côte à côte. C'est
exactement ce que produit déjà le § 4 de l'outil livré aujourd'hui : la comparaison existe, il
reste à la montrer dans l'application et à y accrocher une confirmation.

**Une trace, pas un écrasement.** La ligne figée est **remplacée** par la nouvelle recette avec
`figee_motif = 'adoption_manuelle'`, la date, et l'opérateur. L'ancienne révision reste dans
`fiches_techniques_revisions` : elle y est déjà, archivée au moment de la réouverture. Rien ne
disparaît.

**Les bons MP déjà préparés ne sont jamais recalculés.** Ils sont des faits. Après actualisation,
ils continuent d'être déduits du « déjà commandé » exactement comme avant ; **c'est le reste à
commander qui change, et lui seul.** Un bon déjà enregistré ne voit pas ses quantités réécrites —
ce serait modifier rétroactivement un engagement.

**Et l'écran doit le dire avant de le faire** : « 2 bons de commande MP portent sur cette
production. Ils ne seront pas modifiés. Le reste à commander sera recalculé. »

**L'historique de la production est intact** : statut, numéro, dates, achats affectés, aucun n'est
touché. Seule la recette de référence change.

---

## 5. Les options, et leurs conséquences

### Option A — Actualisation explicite par production *(ce que je recommande)*

Le mécanisme du § 4.4. Un bouton, un écran de comparaison, une confirmation, une trace.

- **Conséquences sur les productions existantes : aucune, tant que vous n'agissez pas.** Rien ne
  bouge sans votre clic, production par production.
- Le mécanisme de nomenclature figée est **conservé entier** : on lui ajoute une sortie, on ne le
  retire pas.
- Les bons MP préparés sont préservés.
- **Travail :** un canal IPC d'actualisation, un écran de comparaison, une confirmation, et les
  contrôles automatiques qui vont avec. C'est le plus gros des quatre, et le seul qui règle
  vraiment le problème.
- **Limite :** production par production. Si dix productions partagent l'article, dix clics.

### Option B — Option A, plus une actualisation groupée

Même chose, avec en plus « actualiser les N productions en retard de cet article », la comparaison
étant la même pour toutes (c'est la même fiche).

- **Conséquence :** un seul clic peut changer dix productions. Puissant, et donc plus dangereux.
- Je ne la proposerais **qu'après** l'option A éprouvée, et avec la liste nominative des
  productions concernées dans l'écran de confirmation.

### Option C — Rendre `hors_approvisionnement` modifiable

Indépendante des précédentes, et bien plus légère. Elle ne règle pas le retard de révision, mais
elle règle un cas voisin : un composant dont la consommation par pièce n'a pas de sens cesse de
produire une anomalie et un « calcul incomplet », avec son motif affiché.

- **Conséquence :** le composant sort du calcul mais **reste visible** à l'écran, avec son motif.
  Aucune quantité n'est inventée.
- **À vérifier avant :** le biais de CMD-2026-047 est-il un composant dont la consommation est
  inconnue, ou un composant dont la consommation est connue et n'avait pas été saisie ? Le § 5 de
  l'outil livré le dira. **Ce n'est pas la même réponse métier.**

### Option D — Ne rien faire pour l'instant

- **Conséquence immédiate :** les besoins de toute production dont la fiche a été corrigée après
  gel restent faux — non pas erronés, mais **périmés**, avec leurs anomalies.
- C'est incompatible avec votre objectif : *« que les besoins d'approvisionnement soient fiables
  avant de générer des bons de commande fournisseurs »*. **Je ne la recommande pas.**

### Ce que je ne proposerai pas

**Supprimer ou contourner le gel**, ni le rendre facultatif, ni « lire la fiche quand la recette
figée est en retard ». Ce serait l'actualisation silencieuse que vous refusez, et elle changerait
rétroactivement les besoins de productions déjà engagées.

---

## 6. Un point que je dois vous poser avant de développer

Le gel intervient aujourd'hui **à la réouverture de la fiche**, pas à la validation de la
production. Conséquence : **une production validée avant toute réouverture suit la fiche et change
donc si la fiche change**, tant que personne n'a cliqué « Modifier la nomenclature ».

Est-ce ce que vous voulez ? Deux lectures défendables :

- **telle quelle** — une production n'est protégée qu'à partir du moment où quelqu'un touche
  réellement à la fiche. C'est le comportement actuel, et il a l'avantage de ne rien figer
  inutilement ;
- **geler à la validation de la production** (le motif `validation_commande`, également jamais
  implémenté) — toute production décidée est protégée dès sa validation, sans dépendre d'un geste
  ultérieur sur la fiche.

Cela change la réponse à « quelles productions sont protégées », donc le périmètre de l'option A.
**Je ne tranche pas cela à votre place.**

---

## 7. Le défaut annexe, à corriger quoi qu'il arrive

Aux étapes 2 et 3 du § 3, **le bandeau affirme que la recette figée correspond à la révision en
vigueur alors que la fiche est en brouillon et contient déjà vos corrections.** Techniquement,
les deux numéros sont bien égaux ; pour vous, le message est faux, et c'est lui qui vous a laissé
chercher.

Le correctif est petit : quand la fiche est en brouillon, le bandeau doit dire que la fiche est en
cours de modification et que cette production ne verra ces changements qu'après revalidation **et**
actualisation. Deux lignes de condition, un contrôle automatique. **À inclure dans la même
livraison que l'option retenue** — ou tout de suite si vous préférez, c'est sans risque.

---

## 8. L'outil livré aujourd'hui, et rien d'autre

```
npm run diagnostic:recette CMD-2026-047
```

**Lecture seule.** La base est ouverte en `readonly` — c'est SQLite qui refuse l'écriture, la
garantie ne dépend pas du code. Le script écrit un seul fichier, son rapport `.txt`, dans le
dossier du projet. Il ne fige rien, ne corrige rien, n'actualise rien.

Il imprime six sections : la production, la fiche et sa révision, **d'où part le calcul**, **la
comparaison composant par composant entre la recette figée et la fiche actuelle**, ce que le
moteur lit réellement pour chaque composant avec ses manques nommés, et ce qu'une actualisation
toucherait en aval (bons MP, achats affectés).

Je l'ai éprouvé sur les deux cas possibles : une production figée en retard, et une production sans
recette figée. Dans le second cas il le dit explicitement — *« les anomalies ne viennent PAS du
figeage »* — et vous renvoie aux valeurs réellement lues. **C'est ce qui distingue « le gel cache
votre correction » de « votre correction ne porte pas sur ce que le moteur lit ».**

Aucune réinstallation n'est nécessaire : rien dans l'application n'a changé, le script se lance
depuis le dossier du projet comme `npm run diagnostic`.

---

## 9. Ce que j'attends de vous

1. Le rapport de `npm run diagnostic:recette CMD-2026-047` — il confirmera le diagnostic sur vos
   données, et dira notamment si le biais relève de l'option C.
2. Votre choix entre **A**, **A + C**, ou **B** plus tard.
3. Votre réponse à la question du § 6 : geler à la réouverture de la fiche, ou dès la validation
   de la production ?
4. Votre accord pour le correctif du § 7.

**Je ne développe rien avant.** MP3 n'est pas commencé, et le mécanisme de nomenclature figée reste
entier.
