# 3. Commandes de fabrication (productions)

## 1. Rôle

Une commande de production lance la fabrication d'un article dans un atelier, avec une répartition
des quantités par couleur et par taille. Elle suit un cycle de statuts tracé (historique des
transitions, opérateur actif) et donne naissance aux bons de commande produits finis (BC PF) et aux
besoins d'approvisionnement.

## 2. Règles métier (document fonctionnel §3)

### Statuts
```
brouillon → validée → en production → contrôle qualité → terminée
     └──────────────┴── annulée
```
(`CHECK` sur `commandes.statut` : `brouillon, validee, en_production, controle_qualite, terminee, annulee`.)

- **RCM1** — Une production validée **ne peut pas** repasser en brouillon ; seule l'annulation existe.
- **RCM2** — Champs verrouillés hors brouillon : `article_id`, `type_production`, `numero_reassort`,
  `reference_production`. **Une production validée ne change donc jamais d'article, ni de fiche.**
- **RCM3** — La répartition couleurs × tailles reste **modifiable après validation, tant que le BC PF
  n'est pas validé**. La mise à jour supprime et réinsère les lignes (les identifiants de ligne
  changent ; rien ne s'y rattache — les achats pointent la commande).
- **RCM4** — Une production ne pointe pas de fiche : le lien passe par l'article. D'où le gel
  ([revisions-et-recettes-figees.md](revisions-et-recettes-figees.md)).
- **RCM5** — 🟦 À la **validation**, la recette de la production est figée (motif
  `validation_commande`), dans la transaction de validation.

### Règles inscrites dans le code (constat)
- Le **numéro officiel** (`CMD-AAAA-NNN`) n'est attribué qu'à la validation (`numero` NULL en
  brouillon), par compteur annuel (`compteurs`) avec boucle anti-collision (`genererNumero`).
- Valider, lancer, passer en contrôle qualité, terminer, bloquer, débloquer, annuler, archiver
  exigent un **opérateur actif** (`assertOperateurActif`) ; chaque geste est inscrit dans
  `historique_transitions` (`enregistrerHistorique`) avec l'opérateur et, s'il y a lieu, le motif.
- Le **blocage** est un drapeau (`bloquee`), pas un statut : il exige un motif non vide (`CHECK`).
- Seule une commande en **brouillon** peut être supprimée définitivement (`remove`) ; les autres
  s'annulent.
- `CHECK (date_fin_prevue >= date_lancement)`, `priorite` ∈ `haute/normale/faible`,
  `type_production` ∈ `nouveau/reassort`.

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `commandes` | `numero` (UNIQUE, NULL en brouillon), `article_id`, `type_production`, `numero_reassort`, `reference_production`, `responsable_nom`, `atelier_id`, `quantite_totale`, `date_lancement`, `date_fin_prevue`, `etape_id`, `statut`, `priorite`, `bloquee`/`blocage_motif`, horodatages et opérateurs de chaque transition (`valide_le`, `valide_par_id`, `lance_le`, `lance_par_id`…), `archived`, `est_demo`, `deleted_at` |
| `commande_lignes` | `couleur_id` → `listes_valeurs`, `reference_libre`, `taille_id` → `grilles_tailles_valeurs`, `taille_nom`, `quantite` (CHECK > 0) ; supprimées avec la commande |
| `historique_transitions` | `type_evenement` (CHECK : `validation, lancement, entree_controle_qualite, fin_production, annulation, blocage, deblocage, archivage, desarchivage`), `operateur_id`, `motif`, `survenu_le` |
| `compteurs` | dernier numéro par année |
| `commande_cout_previsionnel_lignes` | coût prévisionnel par commande (catégorie, quantité, prix) |

## 4. Code

`commandes.js` : `list`, `get` (commande + lignes + historique), `create`, `update` (contrôle RCM2/RCM3),
`remove`, transitions `validerCommande`, `lancerProduction`, `entrerEnControleQualite`,
`terminerProduction`, `annulerCommande`, `bloquer`, `debloquer`, `archiver`, `desarchiver` ;
`getOperateurActif` ; `besoinsMatieres` (ancien calcul, voir RB1).

Dépendances : `commandes` → `bcPf` ; lit la fiche technique de l'article pour `besoinsMatieres`.
Le passage automatique en production au lancement d'un BC PF est fait par la route spéciale
`bcPf/lancer` ([bc-produits-finis.md](bc-produits-finis.md)).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/commandes/list` | — | `commandes.list` |
| GET | `/api/commandes/get` | `id` | `commandes.get` |
| POST | `/api/commandes/create` | `payload` | `commandes.create` |
| POST | `/api/commandes/update` | `id`, `payload` | `commandes.update` |
| POST | `/api/commandes/remove` | `id` | `commandes.remove` |
| POST | `/api/commandes/besoinsMatieres` | `id` | `commandes.besoinsMatieres` |
| POST | `/api/commandes/valider` | `id` | `commandes.validerCommande` |
| POST | `/api/commandes/lancerProduction` | `id` | `commandes.lancerProduction` |
| POST | `/api/commandes/entrerEnControleQualite` | `id` | `commandes.entrerEnControleQualite` |
| POST | `/api/commandes/terminerProduction` | `id` | `commandes.terminerProduction` |
| POST | `/api/commandes/annuler` | `id`, `motif` | `commandes.annulerCommande` |
| POST | `/api/commandes/bloquer` | `id`, `motif` | `commandes.bloquer` |
| POST | `/api/commandes/debloquer` | `id` | `commandes.debloquer` |
| POST | `/api/commandes/archiver` | `id` | `commandes.archiver` |
| POST | `/api/commandes/desarchiver` | `id` | `commandes.desarchiver` |

Export Excel/CSV de toutes les commandes : `GET /api/system/exportFile?format="xlsx"` (voir
[systeme-et-exploitation.md](systeme-et-exploitation.md)).

## 6. Interface

`apps/web/src/modules/commandes/` : `CommandesPage.tsx` (liste), `CommandeDetailModal.tsx`,
`OrderForm.tsx`, `SizeColorGrid.tsx`, `RepartitionEditor.tsx`, `RepartitionTable.tsx`,
`RatioPanel.tsx`, `TransitionDialog.tsx`, `LancerProductionScreen.tsx`, `HistoriqueList.tsx`,
`CommandeBesoinsMatieres.tsx` ; création guidée : `apps/web/src/modules/wizard/CommandeWizard.tsx`.

## 7. Tests

`scenario-productions.test.js` : création, répartition, toutes les transitions, blocage, archivage,
annulation et refus métier, ancien = nouveau. Le balayage des lectures appelle `commandes/get` sur
toutes les commandes de la base réelle.

## 8. Points ouverts / dette technique

- **RCM5** 🟦 : `validerCommande` ne fige pas encore la recette.
- **RB1** 🟦 : `commandes.besoinsMatieres` (matières seules, mode moyenne, sans fournitures ni
  engagements) doit être retiré et l'écran rebranché sur le moteur unique. Le code le dit lui-même
  (commentaire : le mode `par_taille` n'y est pas couvert).
- Opérateur actif global à la base (voir [articles-et-referentiels.md](articles-et-referentiels.md)).
- `CommandeBesoinsMatieres.tsx` : erreur de type TypeScript (`besoinsMatieres` absent du type
  `BelvieApi`), sans effet à l'exécution.
