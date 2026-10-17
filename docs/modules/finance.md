# 7. Finance et 8. Fournisseurs et tarifs

## 1. Rôle

La finance suit ce que coûte réellement chaque production et ce qui est dû à chaque fournisseur,
en séparant strictement trois niveaux : l'**engagement** (ce qu'on a commandé), l'**achat réel**
(ce qui est facturé) et le **règlement** (ce qui est payé). Elle porte aussi les fournisseurs et
leur historique de tarifs, les réceptions, les échéances, les réceptions de production (contrôle
qualité), les estimations de coût de revient et les postes de coût prédéfinis.

## 2. Règles métier (document fonctionnel §7 et §8)

### Trois niveaux strictement séparés (§7.1)
| Niveau | Table | Règle |
|---|---|---|
| **Engagement prévisionnel** | `achats.montant_engage` | *Jamais utilisé seul comme coût réel* |
| **Achat réel** | `achats_factures.montant_ht` | **Seule source du coût réel** |
| **Règlement** | `paiements` + `paiement_affectations` (+ `echeances`) | Un paiement n'est **jamais** rattaché directement à un achat |

> ⚠️ Malgré son nom, `achats` est la table **des engagements**, pas des achats réels.

### Règles de calcul (§7.3)
- **RFI1** — `detteFournisseur()` : `dette_restante = max(0, facturé − payé)` (factures uniquement) ;
  `engagement_restant = max(0, engagé − facturé)`, grandeur distincte. **Valider un BC MP ne crée
  aucune dette.**
- **RFI2** — `coutAchat()` rend `facture_reel` et `provisoire_restant` séparément.
- **RFI3** — `coutCommande()` additionne les deux dans `cout_suivi` : un engagement non facturé
  **entre déjà dans le coût suivi**, à sa valeur engagée. Conséquence connue : à la validation des
  premiers BC MP, les coûts matière apparaîtront plus tôt.
- **RFI4** — La valeur d'une affectation **n'est jamais stockée** : recalculée au prorata de la
  valeur actuelle de l'achat (facturé, ou engagé tant que non facturé).
- **RFI5** — **Aucun calcul de coût parallèle** : tout passe par `coutAchat`, `coutAffectation`, `coutCommande`.
- **RFI6** — Un engagement à zéro est interdit (fausserait le coût de revient en silence). — voir point ouvert.

### Lien BC MP → Finance 🟦 MP3 (§7.4)
- **RFI7** — Une ligne de BC MP validé = **un** `achats` + **un** `achats_affectations` par
  production servie. Rien d'autre.
- **RFI8** — Après validation, `achats_affectations` fait foi pour tous les calculs financiers.
- **RFI9** — Aucune table de réception MP ni d'affectation supplémentaire : on réutilise
  `achats_receptions` et `achats_affectations`.
- **RFI10** — Livraison de MP3 seule, avec comparaison avant/après sur les chiffres réels.

### Fournisseurs et tarifs (§8)
- **RFO1** — `fournisseurs` (complet, conditions de règlement comprises), écrans Finance existants réutilisés.
- **RFO2** — `prix_fournisseurs` est un **historique**, jamais écrasé ; `prixEnVigueur(fournisseur,
  composant, date)` **propose** un prix, l'utilisateur le confirme.
- **RFO3** — 🟨 À terme, l'historique des prix n'est pas saisi : chaque BC MP validé y dépose
  `(fournisseur, composant, couleur, unité, prix, date)` ; prix par couleur : colonne
  `matiere_couleur_id` proposée.
- **RFO4** — Les coordonnées fournisseur sont **figées sur le BC MP** à la validation.

### Règles inscrites dans le code (constat)
- Paiements : montant > 0, toujours rattachés à un fournisseur ; une affectation de paiement relie un
  paiement à une **facture** ; `creditNonAffecte` et `statutFacture` sont calculés.
- Réceptions et factures multiples par achat (livraisons et facturations partielles).
- `calculerEcheanceSuggeree(dateFacture, delaiJours, delaiFinDeMois)` : échéance proposée à partir
  des conditions du fournisseur (`delai_paiement_jours`, `delai_fin_de_mois`).
- Estimations : une estimation par article (`getOuCreerEstimation`), lignes en mode
  `consommation_prix`, `unitaire_direct` ou `montant_global` (CHECK), synthèse et `simulationPrix`.
- Réceptions de production (contrôle qualité) : historique conservé, jamais écrasé ;
  `quantiteCommercialisableCommande`.

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `fournisseurs` | coordonnées, `delai_paiement_jours`, `delai_fin_de_mois`, `mode_paiement_defaut`, `actif` |
| `prix_fournisseurs` | `fournisseur_id`, `matiere_catalogue_id` **ou** `accessoire_catalogue_id` (CHECK), `designation`, `unite` (CHECK `kg/m/piece/lot`), `prix_ht`, `date_debut_validite`, `date_fin_validite` |
| `achats` (engagements) | `uuid`, `fournisseur_id`, `commande_id`, `categorie` (CHECK `matiere, fourniture, confection, impression, transport, retouche, emballage, autre`), `designation`, `matiere_catalogue_id`, `accessoire_catalogue_id`, `couleur`, `quantite`, `unite` (CHECK), `montant_engage` (NOT NULL), `date_engagement`, `reference` |
| `achats_affectations` | `achat_id`, `commande_id`, `quantite_affectee` (la valeur n'est jamais stockée, RFI4) |
| `achats_receptions` | `date_reception`, `quantite_recue`, `reference_bl` |
| `achats_factures` | `date_facture`, `montant_ht`, `montant_tva`, `reference_facture` — **coût réel** |
| `paiements` | `fournisseur_id`, `type` (CHECK), `date_paiement`, `montant`, `mode`, `reference` |
| `paiement_affectations` | `paiement_id`, `achat_facture_id`, `montant_affecte` |
| `echeances` | `achat_id`, `achat_facture_id`, `date_echeance`, `montant` |
| `receptions_production` | `quantite_recue`, `quantite_conforme`, `quantite_a_retoucher`, `quantite_retouchee_recuperee`, `quantite_rebut` (CHECK de cohérence) |
| `estimations`, `estimation_lignes` | estimation par article (`quantite_prevue`) ; lignes (`categorie`, `mode_calcul` CHECK, `quantite`, `prix_unitaire_ht`, `montant_global_ht`, `taux_tva`) |
| `postes_cout_predefinis` | postes réutilisables (`mode_calcul_defaut` CHECK, `ajouter_automatiquement`) |
| `matieres_catalogue` | catalogue des matières (aussi utilisé par les fiches) |

## 4. Code

`finance.js`, organisé en sections numérotées dans le fichier :
1. fournisseurs (`creerFournisseur`, `mettreAJourFournisseur`, `listFournisseurs`, `getFournisseur`) ;
2. tarifs (`ajouterPrixFournisseur`, `listPrixFournisseur`, `prixEnVigueur`) ;
3. engagements (`creerAchat`, `getAchat`, `listAchats`) ;
4. réceptions (`ajouterReceptionAchat`, `listReceptionsAchat`, `quantiteRecueAchat`) ;
5. factures (`ajouterFactureAchat`, `listFacturesAchat`, `getFacture`, `coutAchat`) ;
6. affectations aux productions et stock dérivé (`affecterAchat`, `quantiteDisponibleAchat`,
   `listAffectationsAchat`, `coutAffectation`, `coutCommande`, `stockDisponibleMatiere`,
   `affecterConsommationMatiere`, `syntheseStockMatiere`, `comparaisonConsommationCommande`) ;
7. paiements (`creerPaiement`, `listPaiementsFournisseur`) ;
8. affectation des paiements (`affecterPaiement`, `creditNonAffecte`, `statutFacture`, `detteFournisseur`) ;
9. échéances (`ajouterEcheance`, `listEcheances`, `calculerEcheanceSuggeree`) ;
10. réceptions de production (`ajouterReceptionProduction`, `enregistrerRetoucheReussie`,
    `listReceptionsProduction`, `quantiteCommercialisableCommande`) ;
puis synthèses (`syntheseCoutCommande`, `syntheseGlobale`, `listEcheancesDetaillees`,
`listFournisseursAvecSynthese`, `listAchatsDetailles`, `listFacturesAvecEcheances`,
`listPaiementsEtAvances`), estimations (`getOuCreerEstimation`, lignes, `syntheseEstimation`,
`simulationPrix`, `listEstimationsResume`, `mettreAJourPrixVenteEnvisage`) et postes de coût
(`listPostesCout`, `rechercherPostesCout`, `creerPosteCout`…).

Aucune dépendance vers un autre module de code ; `besoins.js` lit ses tables d'engagements.

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| POST | `/api/finance/creerFournisseur` | `payload` | `finance.creerFournisseur` |
| POST | `/api/finance/mettreAJourFournisseur` | `id`, `patch` | `finance.mettreAJourFournisseur` |
| GET | `/api/finance/listFournisseurs` | `options` | `finance.listFournisseurs` |
| GET | `/api/finance/getFournisseur` | `id` | `finance.getFournisseur` |
| POST | `/api/finance/ajouterPrixFournisseur` | `payload` | `finance.ajouterPrixFournisseur` |
| GET | `/api/finance/listPrixFournisseur` | `fournisseurId`, `options` | `finance.listPrixFournisseur` |
| GET | `/api/finance/prixEnVigueur` | `criteres` | `finance.prixEnVigueur` |
| POST | `/api/finance/creerAchat` | `payload` | `finance.creerAchat` |
| GET | `/api/finance/getAchat` | `id` | `finance.getAchat` |
| GET | `/api/finance/listAchats` | `filtres` | `finance.listAchats` |
| POST | `/api/finance/ajouterReceptionAchat` | `achatId`, `payload` | `finance.ajouterReceptionAchat` |
| GET | `/api/finance/listReceptionsAchat` | `achatId` | `finance.listReceptionsAchat` |
| POST | `/api/finance/ajouterFactureAchat` | `achatId`, `payload` | `finance.ajouterFactureAchat` |
| GET | `/api/finance/listFacturesAchat` | `achatId` | `finance.listFacturesAchat` |
| GET | `/api/finance/getFacture` | `id` | `finance.getFacture` |
| POST | `/api/finance/statutFacture` | `id` | `finance.statutFacture` |
| GET | `/api/finance/coutAchat` | `achatId` | `finance.coutAchat` |
| POST | `/api/finance/affecterAchat` | `payload` | `finance.affecterAchat` |
| POST | `/api/finance/quantiteDisponibleAchat` | `achatId` | `finance.quantiteDisponibleAchat` |
| GET | `/api/finance/listAffectationsAchat` | `achatId` | `finance.listAffectationsAchat` |
| GET | `/api/finance/coutAffectation` | `affectationId` | `finance.coutAffectation` |
| GET | `/api/finance/coutCommande` | `commandeId` | `finance.coutCommande` |
| GET | `/api/finance/syntheseCoutCommande` | `commandeId` | `finance.syntheseCoutCommande` |
| POST | `/api/finance/creerPaiement` | `payload` | `finance.creerPaiement` |
| GET | `/api/finance/listPaiementsFournisseur` | `fournisseurId` | `finance.listPaiementsFournisseur` |
| POST | `/api/finance/affecterPaiement` | `payload` | `finance.affecterPaiement` |
| POST | `/api/finance/creditNonAffecte` | `paiementId` | `finance.creditNonAffecte` |
| GET | `/api/finance/detteFournisseur` | `fournisseurId` | `finance.detteFournisseur` |
| POST | `/api/finance/ajouterEcheance` | `achatId`, `payload` | `finance.ajouterEcheance` |
| GET | `/api/finance/listEcheances` | `filtres` | `finance.listEcheances` |
| GET | `/api/finance/calculerEcheanceSuggeree` | `dateFacture`, `delaiJours`, `delaiFinDeMois` | `finance.calculerEcheanceSuggeree` |
| GET | `/api/finance/listFacturesFournisseur` | `fournisseurId` | `finance.listFacturesFournisseur` |
| POST | `/api/finance/ajouterReceptionProduction` | `commandeId`, `payload` | `finance.ajouterReceptionProduction` |
| POST | `/api/finance/enregistrerRetoucheReussie` | `receptionId`, `quantite` | `finance.enregistrerRetoucheReussie` |
| GET | `/api/finance/listReceptionsProduction` | `commandeId` | `finance.listReceptionsProduction` |
| POST | `/api/finance/quantiteCommercialisableCommande` | `commandeId` | `finance.quantiteCommercialisableCommande` |
| GET | `/api/finance/syntheseGlobale` | — | `finance.syntheseGlobale` |
| GET | `/api/finance/listEcheancesDetaillees` | `filtres` | `finance.listEcheancesDetaillees` |
| GET | `/api/finance/listFournisseursAvecSynthese` | `options` | `finance.listFournisseursAvecSynthese` |
| GET | `/api/finance/listAchatsDetailles` | `filtres` | `finance.listAchatsDetailles` |
| GET | `/api/finance/listMatieresCatalogue` | — | `finance.listMatieresCatalogue` |
| POST | `/api/finance/trouverOuCreerMatiereCatalogue` | `nom`, `uniteDefaut` | `finance.trouverOuCreerMatiereCatalogue` |
| POST | `/api/finance/getOuCreerEstimation` | `articleId` | `finance.getOuCreerEstimation` |
| POST | `/api/finance/mettreAJourEstimation` | `estimationId`, `patch` | `finance.mettreAJourEstimation` |
| POST | `/api/finance/supprimerEstimation` | `estimationId` | `finance.supprimerEstimation` |
| POST | `/api/finance/ajouterLigneEstimation` | `estimationId`, `payload` | `finance.ajouterLigneEstimation` |
| POST | `/api/finance/mettreAJourLigneEstimation` | `ligneId`, `patch` | `finance.mettreAJourLigneEstimation` |
| POST | `/api/finance/supprimerLigneEstimation` | `ligneId` | `finance.supprimerLigneEstimation` |
| GET | `/api/finance/listLignesEstimation` | `estimationId` | `finance.listLignesEstimation` |
| GET | `/api/finance/syntheseEstimation` | `estimationId` | `finance.syntheseEstimation` |
| GET | `/api/finance/simulationPrix` | `coutUnitaireHt`, `params`, `quantiteCommercialisable` | `finance.simulationPrix` |
| GET | `/api/finance/listEstimationsResume` | — | `finance.listEstimationsResume` |
| POST | `/api/finance/mettreAJourPrixVenteEnvisage` | `articleId`, `prix` | `finance.mettreAJourPrixVenteEnvisage` |
| GET | `/api/finance/stockDisponibleMatiere` | `matiereCatalogueId`, `couleur` | `finance.stockDisponibleMatiere` |
| POST | `/api/finance/affecterConsommationMatiere` | `payload` | `finance.affecterConsommationMatiere` |
| GET | `/api/finance/syntheseStockMatiere` | — | `finance.syntheseStockMatiere` |
| GET | `/api/finance/comparaisonConsommationCommande` | `commandeId` | `finance.comparaisonConsommationCommande` |
| GET | `/api/finance/listFacturesAvecEcheances` | `filtres` | `finance.listFacturesAvecEcheances` |
| GET | `/api/finance/listPaiementsEtAvances` | — | `finance.listPaiementsEtAvances` |
| GET | `/api/finance/listPostesCout` | `options` | `finance.listPostesCout` |
| GET | `/api/finance/rechercherPostesCout` | `requete`, `limite`, `categorie` | `finance.rechercherPostesCout` |
| POST | `/api/finance/creerPosteCout` | `payload` | `finance.creerPosteCout` |
| POST | `/api/finance/mettreAJourPosteCout` | `id`, `patch` | `finance.mettreAJourPosteCout` |
| POST | `/api/finance/supprimerPosteCout` | `id` | `finance.supprimerPosteCout` |

## 6. Interface

`apps/web/src/modules/finance/` : `FinancePage.tsx` + `FinanceRoute.ts` (navigation interne),
`FinanceOverview.tsx`, `FinanceFournisseurs.tsx`, `FinanceFournisseurDetail.tsx`,
`FinanceFournisseurNouveau.tsx`, `FinanceNouveauPrix.tsx`, `FinanceAchats.tsx`,
`FinanceAchatDetail.tsx`, `FinanceNouvelAchat.tsx`, `FinanceNouvelleFacture.tsx`,
`FinanceNouveauPaiement.tsx`, `FinanceEcheancesPaiements.tsx`, `FinanceCoutsProduits.tsx`,
`FinanceEstimationPage.tsx` ; postes de coût dans `apps/web/src/modules/settings/PostesCoutSection.tsx`.

## 7. Tests

`scenario-appro-finance.test.js` : « finance : engagements, réceptions, factures, paiements,
échéances, coûts, stock » et « finance : estimations, postes de coût, simulation de prix »,
ancien = nouveau ; balayage de toutes les lectures finance sur une copie de la base réelle.

## 8. Points ouverts / dette technique

- MP3 (RFI7 → RFI10) : 🟦 ; RFO3 : 🟨.
- *Incohérence document / code* : **RFI6** (« un engagement à zéro est interdit ») n'est pas appliquée
  par `creerAchat`, qui refuse seulement un montant **négatif** (`Number(payload.montant_engage) < 0`) :
  un engagement à 0 est accepté.
- *Constat* : le commentaire de tête de `finance.js` dit « backend uniquement (aucune interface
  encore) » alors que les écrans Finance existent.
- §12.4 : `CATEGORIES_STOCKABLES` contient `habillage`, absent de la contrainte `achats.categorie`
  (valeur morte, sans conséquence).
- RB2 : l'écran doit préciser que `comparaisonConsommationCommande` utilise un théorique issu de
  l'estimation.
