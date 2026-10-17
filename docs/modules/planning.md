# Planning (planification des collections)

## 1. Rôle

La planification suit les articles **prévisionnels** d'une collection, de l'idée jusqu'au
lancement, avant même qu'ils existent comme articles ERP : mois prévus de production et de
réception, quantité et coloris prévisionnels, atelier, photo. Une entrée peut ensuite être
convertie en véritable article sans double saisie.

## 2. Règles métier

Le document fonctionnel ne décrit pas ce module ; règles **inscrites dans le code** (constat) :

- **Statuts** (`CHECK` sur `planning_articles.statut`) : `idee, a_etudier, prototype, echantillon,
  a_modifier, valide, a_produire, en_production, production_terminee, shooting_a_preparer,
  pret_au_lancement, lance, annule`.
- **Verrouillage doux à partir de « Validé »** (`estProtege`) : à partir de `valide` (sauf `annule`),
  les champs `produit_id, rayon_id, categorie_id, saison_id, annee_collection, mois_prevu_production,
  mois_prevu_reception, quantite_previsionnelle, coloris_previsionnels, atelier_id` ne se modifient
  qu'avec `forcer: true`, après confirmation explicite « Modifier malgré validation ». Même règle pour
  déplacer une entrée de mois (`deplacer`) ou changer sa photo.
- **Retirer du planning** (`retirerDuPlanning`) archive, ne détruit jamais ; **supprimer**
  (`supprimerProvisoire`) n'est possible que pour une entrée purement prévisionnelle, non liée à un article.
- **Conversion** (`convertirEnProduit`) : crée l'article à partir de ce qui est déjà renseigné ;
  l'entrée reste, rattachée (`article_id`), pour afficher « Produit créé ✓ ».
- **Indicateurs** (`kpis`) : total, en développement (`a_etudier + prototype + a_modifier`),
  en production, shooting à préparer, prêt au lancement — sur les entrées non archivées.
- Recherche (`list`) insensible à la casse sur nom/référence provisoires, type de produit et
  référence d'article (`ILIKE`).

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `planning_articles` | `article_id` (lien une fois converti), `nom_provisoire`, `reference_provisoire`, `produit_id`, `rayon_id`, `categorie_id`, `saison_id`, `annee_collection`, `mois_prevu`, `mois_prevu_production`, `mois_prevu_reception`, `quantite_previsionnelle`, `coloris_previsionnels`, `statut` (CHECK), `atelier_id`, `photo_path`, `photo_thumb_path`, `ordre`, `produit_cree_le`, `archived` |

## 4. Code

`planning.js` : `list`, `get`, `kpis`, `creer`, `mettreAJour`, `deplacer`, `reordonner`,
`ajouterPhoto`, `retirerPhoto`, `retirerDuPlanning`, `supprimerProvisoire`, `convertirEnProduit`,
`estProtege`. Dépendances : `photos` (stockage d'image), `lib/references` (référence de l'article
créé à la conversion).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/planning/list` | `filtres` | `planning.list` |
| GET | `/api/planning/get` | `id` | `planning.get` |
| POST | `/api/planning/kpis` | — | `planning.kpis` |
| POST | `/api/planning/creer` | `payload` | `planning.creer` |
| POST | `/api/planning/mettreAJour` | `id`, `patch` | `planning.mettreAJour` |
| POST | `/api/planning/deplacer` | `id`, `champ`, `nouveauMois`, `orderedIds`, `forcer` | `planning.deplacer` |
| POST | `/api/planning/reordonner` | `mois`, `orderedIds` | `planning.reordonner` |
| POST | `/api/planning/ajouterPhoto` | `id`, `sourcePath`, `forcer` | `planning.ajouterPhoto` |
| POST | `/api/planning/retirerPhoto` | `id`, `forcer` | `planning.retirerPhoto` |
| POST | `/api/planning/retirerDuPlanning` | `id` | `planning.retirerDuPlanning` |
| POST | `/api/planning/supprimerProvisoire` | `id` | `planning.supprimerProvisoire` |
| POST | `/api/planning/convertirEnProduit` | `id`, `payloadArticle` | `planning.convertirEnProduit` |

## 6. Interface

`apps/web/src/modules/planning/` : `PlanningPage.tsx`, `PlanningCard.tsx`, `PlanningCreateModal.tsx`,
`PlanningDetailPanel.tsx`.

## 7. Tests

`scenario-referentiels.test.js` : « modèles de mesures et planning » (création, déplacements,
protection, photo, conversion, suppression et refus), ancien = nouveau.

## 8. Points ouverts / dette technique

- *Constat* : la recherche est passée de `LIKE` (SQLite : insensible à la casse pour l'ASCII
  seulement) à `ILIKE` (PostgreSQL : insensible à la casse y compris pour les lettres accentuées) —
  léger élargissement volontaire.
- *Constat* : la conversion utilise un `SAVEPOINT` autour de l'insertion pour pouvoir réessayer après
  une collision de référence (PostgreSQL annule sinon toute la transaction).
