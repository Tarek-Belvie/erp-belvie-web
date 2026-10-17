# 9. Stock

## 1. Rôle

Il n'existe **pas de module Stock** à proprement parler. Un stock **dérivé** est calculé par la
Finance à partir des engagements et de leurs affectations, lot par lot (logique premier entré,
premier sorti). Cette fiche décrit l'existant et les évolutions prévues.

## 2. Règles métier (document fonctionnel §9)

### État actuel (§9.1)
Stock dérivé : `stockDisponibleMatiere()` = quantités **commandées** (`achats.quantite`) − quantités affectées.
- **RS1** — En l'absence de module Stock, les quantités reçues **ne sont pas considérées
  automatiquement comme disponibles** dans le calcul des besoins (voir aussi RB3 : le stock n'est
  pas déduit des besoins).

### Évolution prévue (MP3) 🟨 (§9.2)
- Baser « acheté » sur `achats_receptions` (ce qui est physiquement là) et ajouter `en_commande` ;
  sans cela, une matière commandée non livrée apparaîtrait disponible dès la validation d'un BC MP.
- Traiter les **anciens achats sans réception enregistrée** pour qu'aucun stock existant ne diminue
  artificiellement — **présenté avant d'être construit**.

### Stock minimal (si retenu) 🟨 (§9.3)
`stock_mouvements` (entrée/sortie, composant, coloris, quantité, unité, origine
`reception_mp | sortie_production | inventaire | correction`). Stock = Σ entrées − Σ sorties,
calculé. `achat_reception_id UNIQUE` : une réception ne peut jamais créer deux mouvements.
- **RS2** — Le rouleau, le carton, la bobine sont des **conditionnements**, pas des unités : on achète
  12 rouleaux de 50 m, on stocke 600 m.

## 3. Données

Pas de table propre. Lues : `achats` (catégories stockables), `achats_affectations`,
`achats_receptions`. La table `stock_mouvements` n'existe pas (🟨).

## 4. Code

Dans `finance.js` : `estCategorieStockable` (`CATEGORIES_STOCKABLES`), `listLotsMatiere` (lots d'un
composant matière + couleur, du plus ancien au plus récent ; `couleur = null` cible les lots **sans**
couleur, ce n'est pas un joker), `stockDisponibleMatiere` (acheté / consommé / disponible, détail par
lot), `affecterConsommationMatiere`, `syntheseStockMatiere`.

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/finance/stockDisponibleMatiere` | `matiereCatalogueId`, `couleur` | `finance.stockDisponibleMatiere` |
| POST | `/api/finance/affecterConsommationMatiere` | `payload` | `finance.affecterConsommationMatiere` |
| GET | `/api/finance/syntheseStockMatiere` | — | `finance.syntheseStockMatiere` |

## 6. Interface

Pas d'écran Stock dédié ; les synthèses sont affichées dans les écrans Finance
(`apps/web/src/modules/finance/`).

## 7. Tests

`scenario-appro-finance.test.js` (« finance : engagements, réceptions, factures, paiements,
échéances, coûts, stock »).

## 8. Points ouverts / dette technique

- Décision ouverte §12.3 n° 1 : sort de `stockDisponibleMatiere` à MP3 — recommandé : stock fondé sur
  les réceptions.
- §12.4 : `CATEGORIES_STOCKABLES` contient `habillage`, absent de la contrainte `achats.categorie`.
