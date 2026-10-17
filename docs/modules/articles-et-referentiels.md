# Articles et référentiels

## 1. Rôle

Ce groupe porte les données de base sur lesquelles reposent tous les autres modules : les
**articles** (avec leur référence principale et leurs photos), les **listes de valeurs**
(couleurs, ateliers, saisons, rayons, types de produit…), les **déclinaisons** et variantes, les
**grilles de tailles** et les **ratios de répartition**, les **étapes** de fabrication,
l'**opérateur actif**, la **fiche entreprise** (en-têtes et logo des documents) et les **modèles
de mesures** réutilisés par les fiches techniques.

## 2. Règles métier

Le document fonctionnel ne leur consacre pas de section numérotée ; les règles ci-dessous sont
celles **inscrites dans le code** (commentaires et contrôles), relevées comme constat.

**Articles** (`articles.js`, `lib/references.js`)
- Référence principale générée à la création : `{codeSaison}{AA}-{codeRayon}-{abreviation}-{n°}`
  (ex. `FW26-M-JEA-01`). Le numéro séquentiel suit une **série par grande famille**, déduite de la
  catégorie du type d'article (`listes_valeurs.parent_id`) ; la création échoue si la catégorie
  n'a pas de série (« Aucune catégorie n'est rattachée à ce type d'article… »).
- Génération dans une boucle de nouvelle tentative : en cas de collision sur la référence
  (générations concurrentes), le numéro suivant est recalculé.
- Une référence attribuée n'est **jamais régénérée** : `update` ne touche ni
  `reference_principale` ni `numero_sequentiel`. `verifierChangementReference` calcule l'effet d'un
  changement **sans rien modifier** ; les commandes gardent leur `reference_production`, instantané
  figé à l'émission (R0.1, R0.4).
- `completerReference` complète une fois pour toutes un article issu d'une migration (sans référence).
- `preparerDuplication` ne crée rien : il renvoie un payload de départ ; id, uuid, référence,
  numéro, commandes et données financières ne sont jamais repris.
- Abréviation : 2 à 5 lettres majuscules (contrôle applicatif `assertAbreviationValide` et `CHECK`
  sur `articles.abreviation`).

**Listes de valeurs** (`listes.js`)
- Types autorisés : `produit, couleur, responsable, atelier, taille, saison, rayon, operateur,
  coupe, pointure, categorie` (`CHECK` sur `listes_valeurs.type`).
- Doublons détectés sur le nom normalisé (`UNIQUE(type, nom_normalise)`) ; recréer une valeur
  désactivée la **réactive** au lieu de créer un doublon.
- `saison` et `rayon` portent un code court unique (1 à 6 lettres/chiffres, en majuscules), utilisé
  par la référence article ; `taille`, `saison`, `rayon` ont un ordre d'affichage.

**Déclinaisons** (`declinaisons.js`)
- `previsualiserImpact` détaille l'effet d'une nouvelle configuration **avant** confirmation :
  combinaisons conservées, à réactiver, nouvelles, obsolètes.
- `appliquerConfiguration` **désactive** (jamais ne supprime) les variantes devenues obsolètes et
  réactive celles redevenues valides ; la génération des nouvelles variantes reste une action séparée
  (`genererVariantes`).

**Grilles de tailles et ratios** (`grillesTailles.js`, `ratiosRepartition.js`)
- La suppression d'une grille est bloquée si elle est utilisée (commande, fiche technique, type de
  produit) ; la désactivation reste toujours possible.
- Un ratio appartient **toujours** à une grille et ses lignes pointent `grilles_tailles_valeurs(id)`
  par clé étrangère : aucune correspondance par libellé. Le calcul des quantités se fait côté
  interface (`repartitionRatio.ts`) et son résultat est saisi comme une valeur manuelle.

**Opérateur actif** (`parametres.js`) : stocké dans `parametres` (clé `operateur_actif_id`). Sans
opérateur actif, valider, lancer, bloquer, annuler ou archiver une commande est impossible
(bandeau dans `App.tsx`).

**Entreprise** (`entreprise.js`) : une seule ligne (`CHECK (id = 1)`), logo copié dans
`images/entreprise/`, état de l'assistant de premier lancement dans `parametres`.

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `articles` | `produit_id`, `saison_id`, `annee_collection`, `rayon_id`, `categorie_id` → `listes_valeurs` ; `designation`, `abreviation` (CHECK), `numero_sequentiel`, `reference_principale`, `prix_vente_envisage`, `est_demo` |
| `article_photos` | `photo_path`, `photo_thumb_path` (chemins **relatifs** au dossier de données), `est_principale`, `ordre` |
| `listes_valeurs` | `type` (CHECK), `nom`, `nom_normalise`, `code`, `ordre`, `responsable_nom` et `fournisseur_id` (ateliers), `parent_id`, `actif` ; `UNIQUE(type, nom_normalise)` |
| `declinaison_types`, `declinaison_valeurs` | types (`code`, `affichage_couleur`) et valeurs (`couleur_hex`) ; `UNIQUE(declinaison_type_id, valeur_normalisee)` |
| `article_declinaison_types`, `article_declinaison_valeurs` | configuration d'un article |
| `article_variantes`, `article_variante_valeurs` | variantes (`sku`, `code_barres`, `reference_interne`, `actif`) et leurs valeurs |
| `grilles_tailles`, `grilles_tailles_valeurs` | grilles et tailles ordonnées ; `UNIQUE(grille_id, valeur_normalisee)` |
| `produit_grille_taille` | grille associée à un type de produit |
| `repartition_ratios`, `repartition_ratios_lignes` | ratio nommé par grille (`UNIQUE(grille_id, nom_normalise)`) et poids par taille (`UNIQUE(ratio_id, taille_id)`) |
| `etapes` | `cle`, `libelle`, `pourcentage`, `ordre`, `optionnelle`, `actif` |
| `parametres` | clé/valeur (`operateur_actif_id`, `entreprise_wizard_etat`…) |
| `entreprise` | coordonnées, banque, `taux_tva_defaut`, `logo_path` |
| `modeles_mesures`, `modeles_mesures_lignes`, `mesures_catalogue`, `tailles_catalogue`, `accessoires_catalogue` | catalogues et modèles réutilisés par les fiches |

## 4. Code

| Fichier | Fonctions principales |
|---|---|
| `articles.js` | `list`, `get`, `create`, `update`, `completerReference`, `verifierChangementReference`, `preparerDuplication`, `ajouterPhoto`, `definirPhotoPrincipale`, `retirerPhoto`, `photoPrincipale` |
| `lib/references.js` | `genererReferencePrincipale`, `prochainSequentiel` (séries par famille) |
| `listes.js` | `list`, `create`, `update` |
| `declinaisons.js` | types et valeurs (`listTypes`, `createType`, `reorderTypes`, `listValeurs`…), configuration d'article (`setArticleDeclinaisonTypes`, `previsualiserImpact`, `appliquerConfiguration`), variantes (`genererVariantes`, `updateVariante`, `deleteVariante`) |
| `grillesTailles.js` | `listGrilles`, `getGrille`, `creerGrille`, `renommerGrille`, `setGrilleActive`, `supprimerGrille`, valeurs (`ajouterValeur`…), `getGrillePourProduit`, `setGrillePourProduit` |
| `ratiosRepartition.js` | `listPourGrille`, `get`, `enregistrer`, `supprimer` |
| `etapes.js` | `list`, `create`, `update` |
| `parametres.js` | `get`, `set`, `getOperateurActif`, `setOperateurActif` |
| `entreprise.js` | `get`, `save`, `setLogo`, `removeLogo`, `getEtatWizard`, `setEtatWizard` |
| `modelesMesures.js` | modèles par type de produit, lignes, modèles et compléments standard (`chargerModeleStandard`, `chargerComplementStandard`) |
| `photos.js` | stockage des images : `copyIntoStore` (+ miniature 160 px via sharp), `copyLogoIntoStore`, `cleanupOldPhoto`, `snapshotArticlePhoto` (copies figées des BC PF), `decrireTeleversement` (aperçu d'un fichier envoyé par le navigateur) |

Dépendances : `articles` → `photos`, `lib/references` ; `entreprise` → `photos`.

**Fichiers envoyés par le navigateur** : `POST /api/fichiers` range le fichier dans
`televersements/` et renvoie un jeton `televersement:<uuid>.<ext>`. Les routes dont un paramètre
s'appelle `sourcePath` (ex. `articles.ajouterPhoto`, `entreprise.setLogo`) reçoivent ce jeton ; la
route le traduit en chemin réel avant d'appeler la fonction métier (`src/routes/index.js`).

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/articles/list` | `opts` | `articles.list` |
| GET | `/api/articles/get` | `id` | `articles.get` |
| POST | `/api/articles/create` | `payload` | `articles.create` |
| POST | `/api/articles/update` | `id`, `patch` | `articles.update` |
| GET | `/api/articles/verifierChangementReference` | `id`, `ref` | `articles.verifierChangementReference` |
| GET | `/api/articles/preparerDuplication` | `id` | `articles.preparerDuplication` |
| POST | `/api/articles/completerReference` | `id`, `payload` | `articles.completerReference` |
| POST | `/api/articles/ajouterPhoto` | `articleId`, `sourcePath` | `articles.ajouterPhoto` |
| POST | `/api/articles/definirPhotoPrincipale` | `photoId` | `articles.definirPhotoPrincipale` |
| POST | `/api/articles/retirerPhoto` | `photoId` | `articles.retirerPhoto` |
| GET | `/api/etapes/list` | `opts` | `etapes.list` |
| POST | `/api/etapes/update` | `id`, `payload` | `etapes.update` |
| POST | `/api/etapes/create` | `payload` | `etapes.create` |
| GET | `/api/listes/list` | `type`, `opts` | `listes.list` |
| POST | `/api/listes/create` | `type`, `nom`, `opts` | `listes.create` |
| POST | `/api/listes/update` | `id`, `patch` | `listes.update` |
| GET | `/api/parametres/getOperateurActif` | — | `parametres.getOperateurActif` |
| POST | `/api/parametres/setOperateurActif` | `operateurId` | `parametres.setOperateurActif` |
| GET | `/api/entreprise/get` | — | `entreprise.get` |
| POST | `/api/entreprise/save` | `payload` | `entreprise.save` |
| POST | `/api/entreprise/setLogo` | `sourcePath` | `entreprise.setLogo` |
| POST | `/api/entreprise/removeLogo` | — | `entreprise.removeLogo` |
| GET | `/api/entreprise/getEtatWizard` | — | `entreprise.getEtatWizard` |
| POST | `/api/entreprise/setEtatWizard` | `etat` | `entreprise.setEtatWizard` |
| GET | `/api/declinaisons/listTypes` | `options` | `declinaisons.listTypes` |
| POST | `/api/declinaisons/createType` | `nom`, `options` | `declinaisons.createType` |
| POST | `/api/declinaisons/updateType` | `id`, `patch` | `declinaisons.updateType` |
| POST | `/api/declinaisons/reorderTypes` | `orderedIds` | `declinaisons.reorderTypes` |
| GET | `/api/declinaisons/listValeurs` | `typeId`, `options` | `declinaisons.listValeurs` |
| POST | `/api/declinaisons/createValeur` | `typeId`, `valeur`, `options` | `declinaisons.createValeur` |
| POST | `/api/declinaisons/updateValeur` | `id`, `patch` | `declinaisons.updateValeur` |
| POST | `/api/declinaisons/reorderValeurs` | `typeId`, `orderedIds` | `declinaisons.reorderValeurs` |
| GET | `/api/declinaisons/getArticleTypes` | `articleId` | `declinaisons.getArticleDeclinaisonTypes` |
| GET | `/api/declinaisons/getArticleValeurs` | `articleId` | `declinaisons.getArticleDeclinaisonValeurs` |
| POST | `/api/declinaisons/setArticleTypes` | `articleId`, `typeIds` | `declinaisons.setArticleDeclinaisonTypes` |
| GET | `/api/declinaisons/articleHasVariantes` | `articleId` | `declinaisons.articleHasVariantes` |
| GET | `/api/declinaisons/previsualiserImpact` | `articleId`, `selections` | `declinaisons.previsualiserImpact` |
| POST | `/api/declinaisons/appliquerConfiguration` | `articleId`, `typeIds`, `selections` | `declinaisons.appliquerConfiguration` |
| GET | `/api/declinaisons/listVariantes` | `articleId`, `options` | `declinaisons.listVariantes` |
| GET | `/api/declinaisons/getVariante` | `id` | `declinaisons.getVariante` |
| POST | `/api/declinaisons/genererVariantes` | `articleId`, `selections` | `declinaisons.genererVariantes` |
| POST | `/api/declinaisons/updateVariante` | `id`, `patch` | `declinaisons.updateVariante` |
| POST | `/api/declinaisons/deleteVariante` | `id` | `declinaisons.deleteVariante` |
| GET | `/api/grillesTailles/list` | `options` | `grillesTailles.listGrilles` |
| GET | `/api/grillesTailles/get` | `grilleId` | `grillesTailles.getGrille` |
| POST | `/api/grillesTailles/creer` | `nom` | `grillesTailles.creerGrille` |
| POST | `/api/grillesTailles/renommer` | `grilleId`, `nom` | `grillesTailles.renommerGrille` |
| POST | `/api/grillesTailles/setActive` | `grilleId`, `actif` | `grillesTailles.setGrilleActive` |
| POST | `/api/grillesTailles/supprimer` | `grilleId` | `grillesTailles.supprimerGrille` |
| POST | `/api/grillesTailles/ajouterValeur` | `grilleId`, `valeur` | `grillesTailles.ajouterValeur` |
| POST | `/api/grillesTailles/modifierValeur` | `grilleId`, `valeurId`, `valeur` | `grillesTailles.modifierValeur` |
| POST | `/api/grillesTailles/supprimerValeur` | `grilleId`, `valeurId` | `grillesTailles.supprimerValeur` |
| POST | `/api/grillesTailles/reordonnerValeurs` | `grilleId`, `orderedIds` | `grillesTailles.reordonnerValeurs` |
| GET | `/api/grillesTailles/getPourProduit` | `produitId` | `grillesTailles.getGrillePourProduit` |
| POST | `/api/grillesTailles/setPourProduit` | `produitId`, `grilleId` | `grillesTailles.setGrillePourProduit` |
| GET | `/api/ratiosRepartition/listPourGrille` | `grilleId` | `ratiosRepartition.listPourGrille` |
| POST | `/api/ratiosRepartition/enregistrer` | `payload` | `ratiosRepartition.enregistrer` |
| POST | `/api/ratiosRepartition/supprimer` | `ratioId` | `ratiosRepartition.supprimer` |
| GET | `/api/modelesMesures/listProduitsAvecStatut` | — | `modelesMesures.listProduitsAvecStatut` |
| GET | `/api/modelesMesures/listByProduitId` | `produitId`, `options` | `modelesMesures.listByProduitId` |
| GET | `/api/modelesMesures/getById` | `modeleId` | `modelesMesures.getById` |
| POST | `/api/modelesMesures/create` | `produitId`, `nom` | `modelesMesures.create` |
| POST | `/api/modelesMesures/dupliquer` | `modeleId`, `nouveauNom` | `modelesMesures.dupliquer` |
| POST | `/api/modelesMesures/updateNom` | `modeleId`, `nom` | `modelesMesures.updateNom` |
| POST | `/api/modelesMesures/setActif` | `modeleId`, `actif` | `modelesMesures.setActif` |
| POST | `/api/modelesMesures/deleteModele` | `modeleId` | `modelesMesures.deleteModele` |
| POST | `/api/modelesMesures/addLigne` | `modeleId`, `nom`, `options` | `modelesMesures.addLigne` |
| POST | `/api/modelesMesures/updateLigne` | `modeleId`, `ligneId`, `patch` | `modelesMesures.updateLigne` |
| POST | `/api/modelesMesures/removeLigne` | `modeleId`, `ligneId` | `modelesMesures.removeLigne` |
| POST | `/api/modelesMesures/reorderLignes` | `modeleId`, `orderedLigneIds` | `modelesMesures.reorderLignes` |
| GET | `/api/modelesMesures/listModelesStandards` | — | `modelesMesures.listModelesStandards` |
| POST | `/api/modelesMesures/chargerModeleStandard` | `modeleId`, `cle` | `modelesMesures.chargerModeleStandard` |
| GET | `/api/modelesMesures/listComplementsStandards` | `cleBase` | `modelesMesures.listComplementsStandards` |
| POST | `/api/modelesMesures/chargerComplementStandard` | `modeleId`, `cle` | `modelesMesures.chargerComplementStandard` |

Routes spéciales : `POST /api/fichiers` (envoi d'image), sélecteurs `photos.pick` /
`entreprise.pickLogo` reconstruits côté navigateur (`apps/web/src/api/client.ts`). Les fichiers
enregistrés sont servis par `GET /media/<chemin relatif>` (session obligatoire, dossier `images/` uniquement).

## 6. Interface

- `apps/web/src/modules/articles/` : `ArticlesPage.tsx`, `ArticleForm.tsx`, `ArticlePhotoField.tsx`,
  `ArticleDeclinaisonsSection.tsx`, `CompleterReferenceForm.tsx`.
- `apps/web/src/modules/settings/` : `SettingsPage.tsx`, `ListeManager.tsx`, `EtapeManager.tsx`,
  `GrillesTaillesManager.tsx`, `DeclinaisonsSection.tsx`, `DeclinaisonTypesManager.tsx`,
  `DeclinaisonValeursManager.tsx`, `OperateurActifSelector.tsx`, `EntrepriseSection.tsx`.
- `apps/web/src/modules/entreprise/EntrepriseWizard.tsx` (premier lancement).
- `apps/web/src/modules/fabrication/AtelierResponsableManager.tsx` (responsable par défaut d'un atelier).
- Ratios : `apps/web/src/modules/commandes/RatioPanel.tsx`, `repartitionRatio.ts`.

## 7. Tests

`apps/api/test/differentiel/scenario-referentiels.test.js` (ancien code = nouveau code) :
- « listes, étapes, opérateur, entreprise » ;
- « grilles, ratios, déclinaisons, articles, photos » ;
- « modèles de mesures et planning » ;
- « données de démonstration ».

## 8. Points ouverts / dette technique

- **Opérateur actif global** (constat) : `parametres.operateur_actif_id` est une valeur unique pour
  toute la base. Avec plusieurs utilisateurs connectés en même temps sur le web, le choix de l'un
  s'applique à tous. À relier au compte connecté (`req.utilisateur`).
- **Données de démonstration** (constat) : `system.loadDemoData` échoue sur une installation neuve
  comme dans la v1.0.1 (`prochainSequentiel` appelé sans type de produit rattaché à une catégorie).
- *Constat* : le commentaire de tête de `lib/references.js` mentionne à la fois un numéro sur 2 et
  sur 3 chiffres ; le code utilise des séries par famille (101, 201…) et laisse les anciennes
  références sur 2 chiffres intactes.
- §12.4 du document fonctionnel : le sélecteur de couleurs de la fiche lit le catalogue global et non
  les couleurs de l'article (`article_declinaison_valeurs`).
