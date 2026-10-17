# 1. Fiches techniques

## 1. Rôle

La fiche technique décrit **la recette** d'un article : matières, fournitures (nomenclature),
consommations, pertes, tailles, correspondances de coloris. Elle porte aussi le dossier de
présentation de l'article (mesures et gradations, croquis annotés, description technique) et
produit le PDF de la fiche. Elle est la source du calcul des besoins (voir
[approvisionnement-besoins.md](approvisionnement-besoins.md)).

## 2. Règles métier (document fonctionnel §1)

### Statuts d'une fiche (§1.3)
```
brouillon ──valider──> validée ──« Modifier la nomenclature »──> brouillon (révision + 1)
                          │
                          └──> archivée
```
| Statut | Modifiable ? |
|---|---|
| `brouillon` | Oui — toute la nomenclature |
| `validee` | **Non.** Garde `assertModifiable` (appelée sur les écritures de nomenclature). Seule sortie : « Modifier la nomenclature » ([revisions-et-recettes-figees.md](revisions-et-recettes-figees.md)) |
| `archivee` | Non |

### Matières (§1.4)
| Règle | Garantie par |
|---|---|
| **RM1** — L'unité est obligatoire et vaut `kg`, `m`, `piece` ou `lot` | Schéma (`NOT NULL` + `CHECK`) |
| **RM2** — La consommation technique, si renseignée, est strictement positive | Schéma (`CHECK > 0`) |
| **RM3** — La seule anomalie possible sur la consommation d'une matière est son absence | Conséquence de RM1/RM2 |
| **RM4** — La perte est un pourcentage ≥ 0 | Schéma |
| **RM5** — Besoin d'une matière = consommation × (1 + perte/100) × quantité | Moteur |
| **RM6** — En mode `par_taille`, la consommation est croisée avec la répartition par taille de la commande, **jamais approximée par une moyenne** | Moteur |
| **RM7** — Une matière non reliée au catalogue est signalée (`catalogue_non_relie`) | Moteur |

🟨 **B5** — Remplacer une matière par une autre : `matiere_catalogue_id` n'est pas modifiable
aujourd'hui (supprimer/recréer la ligne). Si on l'ouvre, les correspondances de coloris
(`ft_matiere_couleurs`) devront être **effacées en le disant**.

### Fournitures (§1.5)
| Règle | Statut |
|---|---|
| **RF1** — Unité en texte libre (pièce, m, cm, paire, jeu, bobine…), nullable au niveau du schéma | Existant |
| **RF2** — Une unité absente produit l'anomalie `unite_absente` | ✅ |
| **RF3** — Consommation par pièce strictement positive ; ≤ 0 produit `consommation_invalide` (contrôle applicatif) | ✅ moteur |
| **RF4** — L'unité saisie est l'unité de **consommation** ; elle doit devenir obligatoire et reconnue comme mesure à la saisie ; valeurs non conformes **signalées, jamais réécrites ni rejetées** ; aucune contrainte `CHECK` ajoutée | 🟦 |
| **RF5** — Perte paramétrable sur les fournitures (`ft_accessoires.perte_pourcent`) — colonne présente, saisie à exposer (B1) | 🟨 |

### Coloris par couleur produit (§1.6)
| Règle | Statut |
|---|---|
| **RC1** — La couleur produit vient de `listes_valeurs`, le même référentiel que `commande_lignes` | ✅ |
| **RC2** — Coloris matière : pointe `matiere_couleurs`. Coloris fourniture : **texte libre** | ✅ |
| **RC3** — Aucun coloris déclaré → composant commandé toutes couleurs confondues (cible `*`) | ✅ |
| **RC4** — Au moins un coloris déclaré → chaque couleur lancée doit avoir le sien ; sinon `À définir (Marine)` + `correspondance_couleur_absente`, quantité visible, jamais estimée | ✅ |
| **RC5** — Coloris déclaré mais non arrêté → `Coloris à choisir (Noir)` + `coloris_non_choisi` | ✅ |
| **RC6** — Consommation propre à un coloris facultative ; renseignée, elle prime | ✅ fournitures |
| **RC7** — Consommation par coloris ≤ 0 refusée à la saisie ; le champ vide est la seule façon d'effacer | ✅ fournitures |
| **RC8** — ⛔ Deux lignes de fourniture pour gérer les couleurs : interdit dans la pratique (580 pièces → 1 160 zips) | — |

### Composants hors approvisionnement (§1.7)
| Règle | Statut |
|---|---|
| **RH1** — Colonnes `hors_approvisionnement`, `hors_appro_motif` (`faconnier`, `client`, `descriptif`, `autre`), `hors_appro_precision` sur `ft_matieres` et `ft_accessoires` | ✅ colonnes / 🟦 saisie |
| **RH2** — Justification obligatoire ; `autre` exige une précision | 🟦 |
| **RH3** — Cocher la case efface et désactive les champs de consommation | 🟦 |
| **RH4** — Exclu du calcul mais **toujours affiché**, avec son motif | ✅ affichage |
| **RH5** — Le motif figure sur le PDF de la fiche | 🟦 |
| **RH6** — Réservé aux exclusions réelles | 🟦 |

### Contrôle avant validation (§1.8) 🟦
- **RV1** — La validation appelle le moteur de besoins sur une production fictive (une pièce de
  chaque couleur déclarée, dans chaque taille). **RV2** — Refus net tant qu'une anomalie bloquante
  subsiste. **RV3** — Bloquantes : `consommation_absente`, `consommation_invalide`,
  `consommation_taille_absente`, `unite_absente`, `coloris_non_choisi`. **RV4** — Non bloquantes :
  `catalogue_non_relie`, `correspondance_couleur_absente`, `perte_invalide`. **RV5** — Contrôles de
  cohérence des coloris déclarés. **RV6** — Fournisseur et prix n'entrent pas dans la fiche.
  **RV7** — Aucune invalidation rétroactive des fiches déjà validées.

### Cohérence description / données structurées (§1.9) 🟨
Contrôle en lecture seule dans l'onglet Aperçu ; aucune correction automatique du texte.

### Règles inscrites dans le code (constat)
- **Mesures** : une fiche passe par `mesures_etat` = `non_genere` → `genere_depuis_modele`
  (`appliquerModele` copie les lignes d'un modèle, une fois, sans lien vivant) ou
  `construit_manuellement` (`construireManuellement`).
- **Grille de tailles** : `definirGrille` ne supprime **rien** par défaut — les tailles sans
  correspondance restent, « hors grille » ; suppression seulement sur demande explicite.
- **Gradations** : `appliquerGradation` en mode `vides` (défaut) ne touche aucune cellule déjà
  renseignée ; les valeurs produites sont des valeurs ordinaires. Un trigger PostgreSQL
  (`verifier_gradation_meme_fiche`) garantit que les deux tailles d'une gradation appartiennent à la fiche.
- **Description technique** : `descriptionTechnique.js` est le seul endroit qui décide des balises,
  attributs et styles autorisés (`assainirDescription`) ; il est partagé par l'enregistrement et le PDF.

## 3. Données

| Table | Contenu / contraintes clés |
|---|---|
| `fiches_techniques` | une fiche **par article** (`article_id UNIQUE`) ; `statut` (CHECK `brouillon/validee/archivee`), `mesures_etat` (CHECK), `tailles_confirmees`, `modele_mesures_id`, `grille_id`, `coupe_id`, `notes`, `description_technique`, `revision` (défaut 1), `revision_motif`, `validated_at`, `archived_at` |
| `ft_matieres` | `matiere_catalogue_id`, `nom`, `unite` (NOT NULL, CHECK `kg/m/piece/lot`), `consommation_technique` (CHECK > 0), `perte_pourcent` (CHECK ≥ 0), `mode_consommation` (CHECK `moyenne/par_taille`), colonnes hors appro |
| `ft_matiere_consommations_taille` | consommation d'une matière par taille (`UNIQUE(ft_matiere_id, ft_taille_id)`, CHECK > 0) |
| `ft_matiere_couleurs` | couleur produit → `matiere_couleur_id` (`UNIQUE(ft_matiere_id, couleur_produit_id)`) |
| `ft_accessoires` | fournitures : `accessoire_catalogue_id`, `famille` (CHECK `habillage/composant`), `reference`, `consommation_par_piece`, `unite` (texte libre), `perte_pourcent`, `photo_path`, colonnes hors appro |
| `ft_fourniture_tailles` | consommation d'une fourniture par taille |
| `ft_fourniture_couleurs` | couleur produit → `couleur_fourniture` (texte), `reference`, `consommation_par_piece` (CHECK > 0 ou NULL) |
| `ft_tailles` | tailles de la fiche (`grille_valeur_id`, `ordre`) |
| `ft_mesures_lignes`, `ft_mesures_valeurs`, `ft_mesures_gradations` | lignes de mesures (repère, tolérances, groupe), valeurs par taille, gradations |
| `ft_croquis`, `ft_annotations` | croquis (`vue` CHECK `face/dos/detail/autre`, `image_path`) et annotations (ancre, étiquette, flèche) |
| `matieres_catalogue`, `matiere_couleurs`, `accessoires_catalogue`, `mesures_catalogue`, `tailles_catalogue` | référentiels |

Images : `images/fiches-techniques/` (croquis) et `images/fiches-techniques-accessoires/` (photos de fournitures).

## 4. Code

| Fichier | Rôle |
|---|---|
| `ficheTechnique.js` | tout le contenu de la fiche : création (`getOrCreateByArticleId`), lecture complète (`get`, `listAll`), validation (`validerFiche`, qui attribue le numéro de révision), archivage, croquis et annotations, mesures (`addMesureLigne`, `setValeur`, `appliquerModele`, `mesuresSuggerees`, `creerTableauMesures`, `mesuresManquantes`…), gradations (`setGradation`, `simulerGradation`, `appliquerGradation`, `intervallesGradation`), tailles et grille (`taillesDisponibles`, `definirGrille`, `analyserChangementGrille`, `ajouterTailleExceptionnelle`), fournitures (`addAccessoire`, `addFournitureCouleur`…), matières (`addMatiere`, `addMatiereCouleur`, `setConsommationTaille`…). Garde `assertModifiable` sur les écritures. |
| `descriptionTechnique.js` | `assainirDescription`, `decouperEnBlocs`, `blocEstTableau` : filtre du texte enrichi, partagé avec le PDF |
| `ficheTechniquePdf.js` | `buildFicheTechniqueHtml` (document HTML du dossier), `SCRIPT_PAGINATION`, `genererPdfDepuisFenetreDediee` |
| `lib/fenetreImpression.js` | remplace la fenêtre Electron cachée : Chromium sans interface (playwright-core), images `belvie-media://` intégrées en `data:` avant rendu |

Dépendances : `ficheTechnique` → `modelesMesures`, `descriptionTechnique` ; lu par `besoins`
(recette), `revisionsFiche` (instantané), `commandes.besoinsMatieres`.

## 5. API

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| POST | `/api/ficheTechnique/getOrCreateByArticleId` | `articleId` | `ficheTechnique.getOrCreateByArticleId` |
| GET | `/api/ficheTechnique/get` | `ficheId` | `ficheTechnique.get` |
| GET | `/api/ficheTechnique/listAll` | — | `ficheTechnique.listAll` |
| POST | `/api/ficheTechnique/updateNotes` | `ficheId`, `notes` | `ficheTechnique.updateNotes` |
| POST | `/api/ficheTechnique/updateDescriptionTechnique` | `ficheId`, `html` | `ficheTechnique.updateDescriptionTechnique` |
| POST | `/api/ficheTechnique/updateCoupe` | `ficheId`, `coupeId` | `ficheTechnique.updateCoupe` |
| POST | `/api/ficheTechnique/validerFiche` | `ficheId` | `ficheTechnique.validerFiche` |
| POST | `/api/ficheTechnique/archiverFiche` | `ficheId` | `ficheTechnique.archiverFiche` |
| POST | `/api/ficheTechnique/addCroquis` | `ficheId`, `sourcePath`, `options` | `ficheTechnique.addCroquis` |
| POST | `/api/ficheTechnique/updateCroquis` | `croquisId`, `patch` | `ficheTechnique.updateCroquis` |
| POST | `/api/ficheTechnique/deleteCroquis` | `croquisId` | `ficheTechnique.deleteCroquis` |
| POST | `/api/ficheTechnique/reorderCroquis` | `ficheId`, `orderedIds` | `ficheTechnique.reorderCroquis` |
| POST | `/api/ficheTechnique/addAnnotation` | `croquisId`, `payload` | `ficheTechnique.addAnnotation` |
| POST | `/api/ficheTechnique/updateAnnotation` | `annotationId`, `patch` | `ficheTechnique.updateAnnotation` |
| POST | `/api/ficheTechnique/deleteAnnotation` | `annotationId` | `ficheTechnique.deleteAnnotation` |
| GET | `/api/ficheTechnique/searchMesuresCatalogue` | `query`, `limit` | `ficheTechnique.searchMesuresCatalogue` |
| POST | `/api/ficheTechnique/addMesureLigne` | `ficheId`, `nom`, `options` | `ficheTechnique.addMesureLigne` |
| POST | `/api/ficheTechnique/updateMesureLigne` | `ficheId`, `mesureCatalogueId`, `patch` | `ficheTechnique.updateMesureLigne` |
| POST | `/api/ficheTechnique/removeMesureLigne` | `ficheId`, `mesureCatalogueId` | `ficheTechnique.removeMesureLigne` |
| POST | `/api/ficheTechnique/reorderMesuresLignes` | `ficheId`, `orderedIds` | `ficheTechnique.reorderMesuresLignes` |
| GET | `/api/ficheTechnique/searchTaillesCatalogue` | `query`, `limit` | `ficheTechnique.searchTaillesCatalogue` |
| POST | `/api/ficheTechnique/addTaille` | `ficheId`, `nom` | `ficheTechnique.addTaille` |
| GET | `/api/ficheTechnique/tailleAValeurs` | `ftTailleId` | `ficheTechnique.tailleAValeurs` |
| POST | `/api/ficheTechnique/confirmerTailles` | `ficheId` | `ficheTechnique.confirmerTailles` |
| POST | `/api/ficheTechnique/removeTaille` | `ficheId`, `ftTailleId` | `ficheTechnique.removeTaille` |
| POST | `/api/ficheTechnique/reorderTailles` | `ficheId`, `orderedIds` | `ficheTechnique.reorderTailles` |
| POST | `/api/ficheTechnique/setValeur` | `ficheId`, `mesureCatalogueId`, `ftTailleId`, `valeur` | `ficheTechnique.setValeur` |
| POST | `/api/ficheTechnique/ensureMesuresGenerees` | `ficheId` | `ficheTechnique.ensureMesuresGenerees` |
| GET | `/api/ficheTechnique/getMesuresStatut` | `ficheId` | `ficheTechnique.getMesuresStatut` |
| GET | `/api/ficheTechnique/mesuresSuggerees` | `ficheId` | `ficheTechnique.mesuresSuggerees` |
| GET | `/api/ficheTechnique/mesuresManquantes` | `ficheId` | `ficheTechnique.mesuresManquantes` |
| POST | `/api/ficheTechnique/ajouterMesuresManquantes` | `ficheId`, `mesures` | `ficheTechnique.ajouterMesuresManquantes` |
| POST | `/api/ficheTechnique/creerTableauMesures` | `ficheId`, `mesures` | `ficheTechnique.creerTableauMesures` |
| POST | `/api/ficheTechnique/reinitialiserChoixMesures` | `ficheId` | `ficheTechnique.reinitialiserChoixMesures` |
| POST | `/api/ficheTechnique/taillesDisponibles` | `ficheId` | `ficheTechnique.taillesDisponibles` |
| POST | `/api/ficheTechnique/selectionnerTaille` | `ficheId`, `grilleValeurId` | `ficheTechnique.selectionnerTaille` |
| POST | `/api/ficheTechnique/ajouterTailleExceptionnelle` | `ficheId`, `nom` | `ficheTechnique.ajouterTailleExceptionnelle` |
| POST | `/api/ficheTechnique/analyserChangementGrille` | `ficheId`, `grilleId` | `ficheTechnique.analyserChangementGrille` |
| POST | `/api/ficheTechnique/definirGrille` | `ficheId`, `grilleId`, `options` | `ficheTechnique.definirGrille` |
| POST | `/api/ficheTechnique/intervallesGradation` | `ficheId`, `mesureId` | `ficheTechnique.intervallesGradation` |
| POST | `/api/ficheTechnique/setGradation` | `ficheId`, `mesureId`, `departId`, `arriveeId`, `valeur` | `ficheTechnique.setGradation` |
| POST | `/api/ficheTechnique/simulerGradation` | `ficheId`, `mesureId`, `refId` | `ficheTechnique.simulerGradation` |
| POST | `/api/ficheTechnique/appliquerGradation` | `ficheId`, `mesureId`, `refId`, `mode` | `ficheTechnique.appliquerGradation` |
| POST | `/api/ficheTechnique/appliquerModele` | `ficheId`, `modeleId` | `ficheTechnique.appliquerModele` |
| POST | `/api/ficheTechnique/construireManuellement` | `ficheId` | `ficheTechnique.construireManuellement` |
| GET | `/api/ficheTechnique/searchAccessoiresCatalogue` | `query`, `limit`, `famille` | `ficheTechnique.searchAccessoiresCatalogue` |
| POST | `/api/ficheTechnique/addAccessoire` | `ficheId`, `payload` | `ficheTechnique.addAccessoire` |
| POST | `/api/ficheTechnique/updateAccessoire` | `accessoireId`, `patch` | `ficheTechnique.updateAccessoire` |
| POST | `/api/ficheTechnique/setAccessoirePhoto` | `accessoireId`, `sourcePath` | `ficheTechnique.setAccessoirePhoto` |
| POST | `/api/ficheTechnique/deleteAccessoire` | `accessoireId` | `ficheTechnique.deleteAccessoire` |
| POST | `/api/ficheTechnique/reorderAccessoires` | `ficheId`, `orderedIds` | `ficheTechnique.reorderAccessoires` |
| GET | `/api/ficheTechnique/listFournitureCouleurs` | `ftAccessoireId` | `ficheTechnique.listFournitureCouleurs` |
| POST | `/api/ficheTechnique/addFournitureCouleur` | `ftAccessoireId`, `payload` | `ficheTechnique.addFournitureCouleur` |
| POST | `/api/ficheTechnique/updateFournitureCouleur` | `id`, `patch` | `ficheTechnique.updateFournitureCouleur` |
| POST | `/api/ficheTechnique/deleteFournitureCouleur` | `id` | `ficheTechnique.deleteFournitureCouleur` |
| GET | `/api/ficheTechnique/searchMatieresCatalogue` | `query`, `limit` | `ficheTechnique.searchMatieresCatalogue` |
| GET | `/api/ficheTechnique/listMatiereCouleurs` | `matiereCatalogueId` | `ficheTechnique.listMatiereCouleurs` |
| POST | `/api/ficheTechnique/createMatiereCouleur` | `matiereCatalogueId`, `payload` | `ficheTechnique.createMatiereCouleur` |
| POST | `/api/ficheTechnique/addMatiere` | `ficheId`, `payload` | `ficheTechnique.addMatiere` |
| POST | `/api/ficheTechnique/updateMatiere` | `ftMatiereId`, `patch` | `ficheTechnique.updateMatiere` |
| POST | `/api/ficheTechnique/deleteMatiere` | `ftMatiereId` | `ficheTechnique.deleteMatiere` |
| POST | `/api/ficheTechnique/reorderMatieres` | `ficheId`, `orderedIds` | `ficheTechnique.reorderMatieres` |
| GET | `/api/ficheTechnique/listMatieres` | `ficheId` | `ficheTechnique.listMatieres` |
| POST | `/api/ficheTechnique/addMatiereCouleur` | `ftMatiereId`, `payload` | `ficheTechnique.addMatiereCouleur` |
| POST | `/api/ficheTechnique/updateMatiereCouleur` | `ftMatiereCouleurId`, `patch` | `ficheTechnique.updateMatiereCouleur` |
| POST | `/api/ficheTechnique/deleteMatiereCouleur` | `ftMatiereCouleurId` | `ficheTechnique.deleteMatiereCouleur` |
| POST | `/api/ficheTechnique/setConsommationTaille` | `ftMatiereId`, `ftTailleId`, `valeur` | `ficheTechnique.setConsommationTaille` |
| GET | `/api/ficheTechnique/listConsommationsTaille` | `ftMatiereId` | `ficheTechnique.listConsommationsTaille` |

Routes spéciales : `GET /api/ficheTechnique/telechargerPdf?ficheId=…&suggestedName=…` (PDF en
téléchargement) ; `pickCroquis` et `pickAccessoirePhoto` sont des sélecteurs de fichier côté
navigateur, suivis de `POST /api/fichiers`. Les routes de révision (`apercuModification`,
`rouvrirPourModification`, `listRevisions`, `getRevision`) sont décrites dans
[revisions-et-recettes-figees.md](revisions-et-recettes-figees.md).

## 6. Interface

`apps/web/src/modules/ficheTechnique/` : `FichesTechniquesPage.tsx` (liste), `FicheTechniquePage.tsx`
(onglets), `FTCreationFlow.tsx`, `FTInfosTab.tsx`, `FTMatieresTab.tsx`, `FTFournituresTab.tsx`,
`FTMesuresTab.tsx` (+ `MesureCell.tsx`, `FTGradationRow.tsx`, `FTCreerTableau.tsx`,
`FTTaillesSelector.tsx`), `FTCroquisTab.tsx`, `FTDescriptionTab.tsx` (+ `descriptionEditeur.ts`,
`descriptionCollage.ts`, `descriptionRendu.ts`), `FTApercuTab.tsx`, `FTChamps.tsx`.

## 7. Tests

`apps/api/test/differentiel/scenario-productions.test.js` (« productions et fiches techniques :
ancien = nouveau ») construit une fiche complète et la valide ; la fiche sert aussi de base aux
scénarios de `scenario-appro-finance.test.js`. Le balayage des lectures
(`balayage-lectures.js`) appelle toutes les routes `GET` de la fiche sur une copie de la base réelle.

## 8. Points ouverts / dette technique

- RV1 → RV7 (contrôle avant validation) : 🟦 non livrés — `validerFiche` vérifie seulement que la
  fiche est en brouillon.
- RF4, RH2, RH3, RH5, RH6 : 🟦 ; RF5 (B1), B5 : 🟨 ; §1.9 : 🟨.
- §12.4 : `electron/db/ficheTechnique.js` (code mort de la version Electron) n'existe plus dans la
  version web — dette close. Le sélecteur de couleurs lit le catalogue global et non les couleurs
  de l'article. Erreurs de type TypeScript résiduelles dans les écrans de gradations, mesures et
  sélecteur de tailles (`FTGradationRow.tsx`, `FTMesuresTab.tsx`, `FTTaillesSelector.tsx` : fonctions
  absentes du type `BelvieApi` de `global.d.ts`, bien qu'elles existent dans l'API).
- *Constat* : les gardes de compatibilité (`tableRevisionsPresente`, `colonneRevisionPresente`,
  `colonneConsoColorisPresente`) servaient aux bases SQLite pas encore migrées ; avec le schéma
  PostgreSQL unique, elles sont toujours vraies et peuvent être retirées.
