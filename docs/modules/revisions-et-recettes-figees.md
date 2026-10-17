# 2. Révisions de fiche et 4. Références techniques figées (gel des recettes)

## 1. Rôle

Une production décidée ne doit pas changer de nomenclature parce que la fiche de son article a été
corrigée ensuite. Ce module **archive** chaque version validée d'une fiche et **fige la recette**
(l'entrée du moteur de besoins) sur les productions déjà décidées, avant de rouvrir la fiche en
brouillon. Le moteur de besoins lit ensuite la recette figée plutôt que la fiche actuelle.

## 2. Règles métier

### Révision par instantané — option A ✅ (§2.1)
La fiche reste **unique par article**. Chaque révision antérieure est archivée sous forme
d'instantané JSON (la sortie complète de `ficheTechnique.get()`, la même que reçoit le PDF), donc
réimprimable. ⛔ Option B (une ligne `fiches_techniques` par révision, `commandes.fiche_id`) :
écartée pour l'instant.

### « Modifier la nomenclature » sur une fiche validée ✅ (§2.2)
Une seule transaction : (1) instantané de la fiche → `fiches_techniques_revisions` ; (2) recette
figée pour chaque production décidée de l'article qui n'en a pas encore → `commandes_recette_figee`
(motif `revision_fiche`) ; (3) fiche repassée en `brouillon`, avec motif ; (4) vérification : nombre
de productions concernées sans recette figée = 0, sinon annulation complète.

- **RR1** — Si une seule production ne peut être protégée, **rien n'est appliqué** et l'utilisateur
  voit laquelle et pourquoi.
- **RR2** — Productions concernées : *validée, en production, contrôle qualité, terminée*. Exclues :
  *brouillon* et *annulée* (`STATUTS_A_PROTEGER`).
- **RR3** — Le gel copie la fiche **telle qu'elle est, lacunes comprises**.
- **RR4** — Revalidation : repasse par le contrôle avant validation (§1.8) ; la révision en vigueur
  reçoit sa `validated_at`.
- **RR5** — Une révision **ne peut pas** toucher un BC MP validé ni un achat.

### Gel des recettes (§4)
- **RG1** — On fige **la recette**, jamais le résultat : `besoin = RECETTE (figée) × QUANTITÉS (vivantes)`.
- **RG2** — On fige **l'entrée du moteur** (sortie de `lireMatieres()` + `lireFournitures()`) : un
  calcul sur recette figée et un calcul sur fiche identique donnent le même résultat au chiffre près.
- **RG3** — En dehors des quatre motifs ci-dessous, **aucune écriture** dans `commandes_recette_figee`.
- **RG4** — `format_version` inconnu : **refusé** ; le moteur revient à la fiche en l'affichant clairement.
- **RG5** — L'instantané garde l'identifiant (rattachement des achats) **et** le libellé.
- **RG6** — L'affichage des besoins **ne fige jamais rien**.

| Motif de gel | Quand | Statut |
|---|---|---|
| `revision_fiche` | « Modifier la nomenclature » sur une fiche validée | ✅ |
| `validation_commande` | Validation de la production (RCM5) | 🟦 |
| `adoption_manuelle` | L'utilisateur adopte la révision en vigueur | 🟦 |
| `reprise_historique` | Reprise H1 des productions sans référence | 🟦 |

### Adoption manuelle d'une nouvelle révision 🟦 (§4.5)
**RA1** bouton visible uniquement si la référence est en retard sur une révision **validée** ;
**RA2** autorisée pour *validée* et *en production*, refusée pour *contrôle qualité*, *terminée*,
*annulée* ; **RA3** refusée tant qu'un BC MP brouillon porte sur la production ; **RA4** écran de
comparaison avant confirmation ; **RA5** confirmation tracée (motif, date, opérateur) ; **RA6**
référence remplacée copiée dans l'historique ; **RA7** les BC MP ne sont jamais recalculés, seul le
*reste à commander* change. 🟨 Actualisation groupée : reportée.

### Reprise des productions historiques (H1) 🟦 (§4.6)
**RH-1** écran « Références techniques » ; **RH-2** motif `reprise_historique` ; **RH-3** effet nul
sur les besoins à l'instant de la reprise ; **RH-4** fiches en brouillon traitées individuellement ;
**RH-5** ⛔ reprise automatique à la migration ; **RH-6** annulées jamais figées, terminées figées.

### Bandeau à quatre états sur la page des besoins 🟦 (§4.7)
Pas de référence figée / fiche en cours de modification / révision validée plus récente
(**Comparer et adopter**) / référence à jour ; pastille dans la liste des articles à approvisionner.

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `fiches_techniques` | `revision` (NOT NULL, défaut 1), `revision_motif` |
| `fiches_techniques_revisions` | `fiche_id`, `revision`, `motif`, `contenu_json`, `format_version`, `validated_at`, `archivee_le`, `archivee_par_id` ; `UNIQUE(fiche_id, revision)` |
| `commandes_recette_figee` | `commande_id` (clé primaire : une seule référence en vigueur par production), `fiche_id`, `fiche_revision`, `composants_json`, `format_version`, `figee_le`, `figee_motif`, `figee_par_id` |
| `commandes_recette_figee_historique` | 🟦 décidée, **pas encore créée** dans le schéma |

## 4. Code

- `revisionsFiche.js` — **seul** fichier qui écrit dans `fiches_techniques_revisions` et
  `commandes_recette_figee`. `apercuModification` (lecture : ce que la réouverture va protéger),
  `rouvrirPourModification` (la transaction décrite plus haut, via `db.transaction`),
  `listRevisions` (sans le contenu complet), `getRevision`.
- `besoins.js` — `construireRecette(db, ficheId)` produit l'entrée du moteur (`FORMAT_RECETTE`) ;
  `calculerPourCommande` lit la recette figée si elle existe et est lisible, sinon la fiche actuelle
  (seul endroit de lecture, §4.4).
- `ficheTechnique.validerFiche` — attribue le numéro de révision à la revalidation (voir point
  ouvert ci-dessous).

Dépendances : `revisionsFiche` → `besoins` (`construireRecette`), `ficheTechnique` (`get`).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/ficheTechnique/apercuModification` | `ficheId` | `revisionsFiche.apercuModification` |
| POST | `/api/ficheTechnique/rouvrirPourModification` | `ficheId`, `options` | `revisionsFiche.rouvrirPourModification` |
| GET | `/api/ficheTechnique/listRevisions` | `ficheId` | `revisionsFiche.listRevisions` |
| GET | `/api/ficheTechnique/getRevision` | `revisionId` | `revisionsFiche.getRevision` |

## 6. Interface

Les actions sont dans la fiche technique (`apps/web/src/modules/ficheTechnique/FicheTechniquePage.tsx`,
`FTApercuTab.tsx`) ; la source du calcul (recette figée ou fiche) est affichée dans
`apps/web/src/modules/approvisionnement/BesoinsDetail.tsx`.

## 7. Tests

- `scenario-productions.test.js` : réouverture d'une fiche validée, gel des productions décidées,
  listes et lecture des révisions.
- `scenario-appro-finance.test.js` : « besoins sur recette figée (révision de fiche) et engagements
  rattachés ».
- Outil de diagnostic historique (lecture seule) de la version Electron : `npm run diagnostic:recette`
  (§5.8) — **non repris** dans la version web.

## 8. Points ouverts / dette technique

- 🟦 non livrés : gel à la validation de la commande (RCM5), adoption manuelle (RA1–RA7), table
  d'historique, reprise H1, bandeau à quatre états.
- *Incohérence document / code* : le schéma §2.2 indique « fiche : statut = 'brouillon',
  revision = revision + 1 » à la réouverture. Le code **n'incrémente pas** à la réouverture
  (`rouvrirPourModification`, étape 3, commentaire explicite) : le numéro avance à la
  **revalidation** (`ficheTechnique.validerFiche`), si une archive porte déjà le numéro courant. Le
  diagramme §1.3 (« brouillon (révision + 1) ») est à lire dans ce sens.
- *Constat* : les outils `diagnostic:recette` (§4.6, §5.8) n'existent plus dans la version web.
