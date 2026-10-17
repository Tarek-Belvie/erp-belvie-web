# Référence de l'API Belvie ERP

> Document **généré** par `apps/api/scripts/generer.js` à partir du registre `apps/api/src/routes/registre.js`. Ne pas modifier à la main.

## Convention (identique pour toutes les routes)

| | Lecture | Écriture |
|---|---|---|
| Verbe | `GET /api/<espace>/<methode>` | `POST /api/<espace>/<methode>` |
| Paramètres | query string, chaque valeur encodée en JSON : `?id=12&options=%7B%7D` | corps JSON : `{ "id": 12, "payload": { … } }` |
| Base | connexion en lecture seule (aucune écriture possible) | connexion normale |

- Réponse : `200 { "resultat": … }` ; règle métier refusée : `400 { "erreur": "message" }` ; non connecté : `401` ; réservé admin : `403` ; erreur technique : `500`.
- Authentification : cookie de session `belvie_session` (HttpOnly) posé par `POST /api/auth/connexion { email, motDePasse }`.
- Toute requête non-GET doit porter l'en-tête `X-Belvie: 1` (protection CSRF).
- `espace.methode` = exactement `window.api.<espace>.<methode>` côté interface.

## Authentification

| Verbe | Chemin | Corps / paramètres |
|---|---|---|
| POST | `/api/auth/connexion` | `email`, `motDePasse` |
| POST | `/api/auth/deconnexion` | — |
| GET | `/api/auth/moi` | — |
| GET | `/api/sante` | — (sans authentification) |

## Routes spéciales (fichiers, PDF, export, sauvegardes)

| Verbe | Chemin | Paramètres | Rôle |
|---|---|---|---|
| POST | `/api/fichiers` | `fichier (multipart)` | Envoi d'une image ; renvoie { filePath: jeton, fileName, sizeBytes, dataUrl }. Le jeton se passe ensuite à ajouterPhoto / setLogo / addCroquis / setAccessoirePhoto. |
| GET | `/api/bcPf/telechargerPdf` | `id`, `suggestedName` | PDF du bon de commande (téléchargement). |
| GET | `/api/ficheTechnique/telechargerPdf` | `ficheId`, `suggestedName` | PDF de la fiche technique (téléchargement). |
| POST | `/api/bcPf/lancer` | `id` | Lance le BC, puis passe la commande en production si elle est « validée ». |
| GET | `/api/system/exportFile` | `format` | Export des commandes (csv | xlsx), téléchargement. |
| POST | `/api/system/backup` | `options` | Sauvegarde complète sur le serveur (admin). |
| POST | `/api/system/backupAvantOperation` | `motif` | Sauvegarde avant opération (admin). |
| GET | `/api/system/listerSauvegardes` | — | Liste des sauvegardes (admin). |
| GET | `/api/system/verifierSauvegarde` | `dossier` | Vérifie une sauvegarde (admin). |
| GET | `/api/system/telechargerSauvegarde` | `nom`, `fichier` | Télécharge un fichier de sauvegarde (admin). |
| POST | `/api/system/loadDemoData` | — | Charge les données de démonstration (admin). |
| POST | `/api/system/clearDemoData` | — | Retire les données de démonstration (admin). |
| GET | `/api/system/version` | — | Version de l'API. |
| GET | `/media/<chemin>` | — | Fichier image enregistré (photos, logo, croquis). |

## Routes métier (261)

### commandes

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/commandes/list` | — | `modules/commandes.list` |
| GET | `/api/commandes/get` | `id` | `modules/commandes.get` |
| POST | `/api/commandes/create` | `payload` | `modules/commandes.create` |
| POST | `/api/commandes/update` | `id`, `payload` | `modules/commandes.update` |
| POST | `/api/commandes/remove` | `id` | `modules/commandes.remove` |
| POST | `/api/commandes/besoinsMatieres` | `id` | `modules/commandes.besoinsMatieres` |
| POST | `/api/commandes/valider` | `id` | `modules/commandes.validerCommande` |
| POST | `/api/commandes/lancerProduction` | `id` | `modules/commandes.lancerProduction` |
| POST | `/api/commandes/entrerEnControleQualite` | `id` | `modules/commandes.entrerEnControleQualite` |
| POST | `/api/commandes/terminerProduction` | `id` | `modules/commandes.terminerProduction` |
| POST | `/api/commandes/annuler` | `id`, `motif` | `modules/commandes.annulerCommande` |
| POST | `/api/commandes/bloquer` | `id`, `motif` | `modules/commandes.bloquer` |
| POST | `/api/commandes/debloquer` | `id` | `modules/commandes.debloquer` |
| POST | `/api/commandes/archiver` | `id` | `modules/commandes.archiver` |
| POST | `/api/commandes/desarchiver` | `id` | `modules/commandes.desarchiver` |

### articles

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/articles/list` | `opts` | `modules/articles.list` |
| GET | `/api/articles/get` | `id` | `modules/articles.get` |
| POST | `/api/articles/create` | `payload` | `modules/articles.create` |
| POST | `/api/articles/update` | `id`, `patch` | `modules/articles.update` |
| GET | `/api/articles/verifierChangementReference` | `id`, `ref` | `modules/articles.verifierChangementReference` |
| GET | `/api/articles/preparerDuplication` | `id` | `modules/articles.preparerDuplication` |
| POST | `/api/articles/completerReference` | `id`, `payload` | `modules/articles.completerReference` |
| POST | `/api/articles/ajouterPhoto` | `articleId`, `sourcePath` | `modules/articles.ajouterPhoto` |
| POST | `/api/articles/definirPhotoPrincipale` | `photoId` | `modules/articles.definirPhotoPrincipale` |
| POST | `/api/articles/retirerPhoto` | `photoId` | `modules/articles.retirerPhoto` |

### etapes

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/etapes/list` | `opts` | `modules/etapes.list` |
| POST | `/api/etapes/update` | `id`, `payload` | `modules/etapes.update` |
| POST | `/api/etapes/create` | `payload` | `modules/etapes.create` |

### listes

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/listes/list` | `type`, `opts` | `modules/listes.list` |
| POST | `/api/listes/create` | `type`, `nom`, `opts` | `modules/listes.create` |
| POST | `/api/listes/update` | `id`, `patch` | `modules/listes.update` |

### parametres

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/parametres/getOperateurActif` | — | `modules/parametres.getOperateurActif` |
| POST | `/api/parametres/setOperateurActif` | `operateurId` | `modules/parametres.setOperateurActif` |

### entreprise

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/entreprise/get` | — | `modules/entreprise.get` |
| POST | `/api/entreprise/save` | `payload` | `modules/entreprise.save` |
| POST | `/api/entreprise/setLogo` | `sourcePath` | `modules/entreprise.setLogo` |
| POST | `/api/entreprise/removeLogo` | — | `modules/entreprise.removeLogo` |
| GET | `/api/entreprise/getEtatWizard` | — | `modules/entreprise.getEtatWizard` |
| POST | `/api/entreprise/setEtatWizard` | `etat` | `modules/entreprise.setEtatWizard` |

### bcPf

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/bcPf/getByCommandeId` | `commandeId` | `modules/bcPf.getByCommandeId` |
| GET | `/api/bcPf/listForCommande` | `commandeId` | `modules/bcPf.listForCommande` |
| GET | `/api/bcPf/get` | `id` | `modules/bcPf.get` |
| POST | `/api/bcPf/creer` | `commandeId` | `modules/bcPf.creerBcPf` |
| POST | `/api/bcPf/update` | `id`, `patch` | `modules/bcPf.updateBrouillonDoc` |
| POST | `/api/bcPf/mettreAJourDepuisCommande` | `id` | `modules/bcPf.mettreAJourDepuisCommande` |
| POST | `/api/bcPf/valider` | `id` | `modules/bcPf.validerBcPf` |
| POST | `/api/bcPf/remplacer` | `id`, `motif` | `modules/bcPf.remplacerBcPf` |

### declinaisons

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/declinaisons/listTypes` | `options` | `modules/declinaisons.listTypes` |
| POST | `/api/declinaisons/createType` | `nom`, `options` | `modules/declinaisons.createType` |
| POST | `/api/declinaisons/updateType` | `id`, `patch` | `modules/declinaisons.updateType` |
| POST | `/api/declinaisons/reorderTypes` | `orderedIds` | `modules/declinaisons.reorderTypes` |
| GET | `/api/declinaisons/listValeurs` | `typeId`, `options` | `modules/declinaisons.listValeurs` |
| POST | `/api/declinaisons/createValeur` | `typeId`, `valeur`, `options` | `modules/declinaisons.createValeur` |
| POST | `/api/declinaisons/updateValeur` | `id`, `patch` | `modules/declinaisons.updateValeur` |
| POST | `/api/declinaisons/reorderValeurs` | `typeId`, `orderedIds` | `modules/declinaisons.reorderValeurs` |
| GET | `/api/declinaisons/getArticleTypes` | `articleId` | `modules/declinaisons.getArticleDeclinaisonTypes` |
| GET | `/api/declinaisons/getArticleValeurs` | `articleId` | `modules/declinaisons.getArticleDeclinaisonValeurs` |
| POST | `/api/declinaisons/setArticleTypes` | `articleId`, `typeIds` | `modules/declinaisons.setArticleDeclinaisonTypes` |
| GET | `/api/declinaisons/articleHasVariantes` | `articleId` | `modules/declinaisons.articleHasVariantes` |
| GET | `/api/declinaisons/previsualiserImpact` | `articleId`, `selections` | `modules/declinaisons.previsualiserImpact` |
| POST | `/api/declinaisons/appliquerConfiguration` | `articleId`, `typeIds`, `selections` | `modules/declinaisons.appliquerConfiguration` |
| GET | `/api/declinaisons/listVariantes` | `articleId`, `options` | `modules/declinaisons.listVariantes` |
| GET | `/api/declinaisons/getVariante` | `id` | `modules/declinaisons.getVariante` |
| POST | `/api/declinaisons/genererVariantes` | `articleId`, `selections` | `modules/declinaisons.genererVariantes` |
| POST | `/api/declinaisons/updateVariante` | `id`, `patch` | `modules/declinaisons.updateVariante` |
| POST | `/api/declinaisons/deleteVariante` | `id` | `modules/declinaisons.deleteVariante` |

### grillesTailles

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/grillesTailles/list` | `options` | `modules/grillesTailles.listGrilles` |
| GET | `/api/grillesTailles/get` | `grilleId` | `modules/grillesTailles.getGrille` |
| POST | `/api/grillesTailles/creer` | `nom` | `modules/grillesTailles.creerGrille` |
| POST | `/api/grillesTailles/renommer` | `grilleId`, `nom` | `modules/grillesTailles.renommerGrille` |
| POST | `/api/grillesTailles/setActive` | `grilleId`, `actif` | `modules/grillesTailles.setGrilleActive` |
| POST | `/api/grillesTailles/supprimer` | `grilleId` | `modules/grillesTailles.supprimerGrille` |
| POST | `/api/grillesTailles/ajouterValeur` | `grilleId`, `valeur` | `modules/grillesTailles.ajouterValeur` |
| POST | `/api/grillesTailles/modifierValeur` | `grilleId`, `valeurId`, `valeur` | `modules/grillesTailles.modifierValeur` |
| POST | `/api/grillesTailles/supprimerValeur` | `grilleId`, `valeurId` | `modules/grillesTailles.supprimerValeur` |
| POST | `/api/grillesTailles/reordonnerValeurs` | `grilleId`, `orderedIds` | `modules/grillesTailles.reordonnerValeurs` |
| GET | `/api/grillesTailles/getPourProduit` | `produitId` | `modules/grillesTailles.getGrillePourProduit` |
| POST | `/api/grillesTailles/setPourProduit` | `produitId`, `grilleId` | `modules/grillesTailles.setGrillePourProduit` |

### ratiosRepartition

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/ratiosRepartition/listPourGrille` | `grilleId` | `modules/ratiosRepartition.listPourGrille` |
| POST | `/api/ratiosRepartition/enregistrer` | `payload` | `modules/ratiosRepartition.enregistrer` |
| POST | `/api/ratiosRepartition/supprimer` | `ratioId` | `modules/ratiosRepartition.supprimer` |

### approvisionnement

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/approvisionnement/calculerBesoins` | `commandeId`, `options` | `modules/besoins.calculerPourCommande` |
| GET | `/api/approvisionnement/etatsApprovisionnement` | `commandeIds` | `modules/besoins.etatsApprovisionnement` |

### bcMp

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/bcMp/regrouper` | `commandeIds` | `modules/preparationBcMp.regrouper` |
| POST | `/api/bcMp/creerLot` | `bons` | `modules/bcMp.creerLot` |
| POST | `/api/bcMp/enregistrerPreparation` | `payload` | `modules/bcMp.enregistrerPreparation` |
| POST | `/api/bcMp/creer` | `payload` | `modules/bcMp.creer` |
| GET | `/api/bcMp/get` | `bonId` | `modules/bcMp.get` |
| GET | `/api/bcMp/list` | `filtres` | `modules/bcMp.list` |
| POST | `/api/bcMp/mettreAJour` | `bonId`, `patch` | `modules/bcMp.mettreAJour` |
| POST | `/api/bcMp/supprimer` | `bonId` | `modules/bcMp.supprimer` |
| POST | `/api/bcMp/ajouterLigne` | `bonId`, `ligne` | `modules/bcMp.ajouterLigne` |
| POST | `/api/bcMp/mettreAJourLigne` | `ligneId`, `patch` | `modules/bcMp.mettreAJourLigne` |
| POST | `/api/bcMp/supprimerLigne` | `ligneId` | `modules/bcMp.supprimerLigne` |

### ficheTechnique

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| POST | `/api/ficheTechnique/getOrCreateByArticleId` | `articleId` | `modules/ficheTechnique.getOrCreateByArticleId` |
| GET | `/api/ficheTechnique/get` | `ficheId` | `modules/ficheTechnique.get` |
| GET | `/api/ficheTechnique/listAll` | — | `modules/ficheTechnique.listAll` |
| POST | `/api/ficheTechnique/updateNotes` | `ficheId`, `notes` | `modules/ficheTechnique.updateNotes` |
| POST | `/api/ficheTechnique/updateDescriptionTechnique` | `ficheId`, `html` | `modules/ficheTechnique.updateDescriptionTechnique` |
| POST | `/api/ficheTechnique/updateCoupe` | `ficheId`, `coupeId` | `modules/ficheTechnique.updateCoupe` |
| POST | `/api/ficheTechnique/validerFiche` | `ficheId` | `modules/ficheTechnique.validerFiche` |
| GET | `/api/ficheTechnique/apercuModification` | `ficheId` | `modules/revisionsFiche.apercuModification` |
| POST | `/api/ficheTechnique/rouvrirPourModification` | `ficheId`, `options` | `modules/revisionsFiche.rouvrirPourModification` |
| GET | `/api/ficheTechnique/listRevisions` | `ficheId` | `modules/revisionsFiche.listRevisions` |
| GET | `/api/ficheTechnique/getRevision` | `revisionId` | `modules/revisionsFiche.getRevision` |
| POST | `/api/ficheTechnique/archiverFiche` | `ficheId` | `modules/ficheTechnique.archiverFiche` |
| POST | `/api/ficheTechnique/addCroquis` | `ficheId`, `sourcePath`, `options` | `modules/ficheTechnique.addCroquis` |
| POST | `/api/ficheTechnique/updateCroquis` | `croquisId`, `patch` | `modules/ficheTechnique.updateCroquis` |
| POST | `/api/ficheTechnique/deleteCroquis` | `croquisId` | `modules/ficheTechnique.deleteCroquis` |
| POST | `/api/ficheTechnique/reorderCroquis` | `ficheId`, `orderedIds` | `modules/ficheTechnique.reorderCroquis` |
| POST | `/api/ficheTechnique/addAnnotation` | `croquisId`, `payload` | `modules/ficheTechnique.addAnnotation` |
| POST | `/api/ficheTechnique/updateAnnotation` | `annotationId`, `patch` | `modules/ficheTechnique.updateAnnotation` |
| POST | `/api/ficheTechnique/deleteAnnotation` | `annotationId` | `modules/ficheTechnique.deleteAnnotation` |
| GET | `/api/ficheTechnique/searchMesuresCatalogue` | `query`, `limit` | `modules/ficheTechnique.searchMesuresCatalogue` |
| POST | `/api/ficheTechnique/addMesureLigne` | `ficheId`, `nom`, `options` | `modules/ficheTechnique.addMesureLigne` |
| POST | `/api/ficheTechnique/updateMesureLigne` | `ficheId`, `mesureCatalogueId`, `patch` | `modules/ficheTechnique.updateMesureLigne` |
| POST | `/api/ficheTechnique/removeMesureLigne` | `ficheId`, `mesureCatalogueId` | `modules/ficheTechnique.removeMesureLigne` |
| POST | `/api/ficheTechnique/reorderMesuresLignes` | `ficheId`, `orderedIds` | `modules/ficheTechnique.reorderMesuresLignes` |
| GET | `/api/ficheTechnique/searchTaillesCatalogue` | `query`, `limit` | `modules/ficheTechnique.searchTaillesCatalogue` |
| POST | `/api/ficheTechnique/addTaille` | `ficheId`, `nom` | `modules/ficheTechnique.addTaille` |
| GET | `/api/ficheTechnique/tailleAValeurs` | `ftTailleId` | `modules/ficheTechnique.tailleAValeurs` |
| POST | `/api/ficheTechnique/confirmerTailles` | `ficheId` | `modules/ficheTechnique.confirmerTailles` |
| POST | `/api/ficheTechnique/removeTaille` | `ficheId`, `ftTailleId` | `modules/ficheTechnique.removeTaille` |
| POST | `/api/ficheTechnique/reorderTailles` | `ficheId`, `orderedIds` | `modules/ficheTechnique.reorderTailles` |
| POST | `/api/ficheTechnique/setValeur` | `ficheId`, `mesureCatalogueId`, `ftTailleId`, `valeur` | `modules/ficheTechnique.setValeur` |
| POST | `/api/ficheTechnique/ensureMesuresGenerees` | `ficheId` | `modules/ficheTechnique.ensureMesuresGenerees` |
| GET | `/api/ficheTechnique/getMesuresStatut` | `ficheId` | `modules/ficheTechnique.getMesuresStatut` |
| GET | `/api/ficheTechnique/mesuresSuggerees` | `ficheId` | `modules/ficheTechnique.mesuresSuggerees` |
| GET | `/api/ficheTechnique/mesuresManquantes` | `ficheId` | `modules/ficheTechnique.mesuresManquantes` |
| POST | `/api/ficheTechnique/ajouterMesuresManquantes` | `ficheId`, `mesures` | `modules/ficheTechnique.ajouterMesuresManquantes` |
| POST | `/api/ficheTechnique/creerTableauMesures` | `ficheId`, `mesures` | `modules/ficheTechnique.creerTableauMesures` |
| POST | `/api/ficheTechnique/reinitialiserChoixMesures` | `ficheId` | `modules/ficheTechnique.reinitialiserChoixMesures` |
| POST | `/api/ficheTechnique/taillesDisponibles` | `ficheId` | `modules/ficheTechnique.taillesDisponibles` |
| POST | `/api/ficheTechnique/selectionnerTaille` | `ficheId`, `grilleValeurId` | `modules/ficheTechnique.selectionnerTaille` |
| POST | `/api/ficheTechnique/ajouterTailleExceptionnelle` | `ficheId`, `nom` | `modules/ficheTechnique.ajouterTailleExceptionnelle` |
| POST | `/api/ficheTechnique/analyserChangementGrille` | `ficheId`, `grilleId` | `modules/ficheTechnique.analyserChangementGrille` |
| POST | `/api/ficheTechnique/definirGrille` | `ficheId`, `grilleId`, `options` | `modules/ficheTechnique.definirGrille` |
| POST | `/api/ficheTechnique/intervallesGradation` | `ficheId`, `mesureId` | `modules/ficheTechnique.intervallesGradation` |
| POST | `/api/ficheTechnique/setGradation` | `ficheId`, `mesureId`, `departId`, `arriveeId`, `valeur` | `modules/ficheTechnique.setGradation` |
| POST | `/api/ficheTechnique/simulerGradation` | `ficheId`, `mesureId`, `refId` | `modules/ficheTechnique.simulerGradation` |
| POST | `/api/ficheTechnique/appliquerGradation` | `ficheId`, `mesureId`, `refId`, `mode` | `modules/ficheTechnique.appliquerGradation` |
| POST | `/api/ficheTechnique/appliquerModele` | `ficheId`, `modeleId` | `modules/ficheTechnique.appliquerModele` |
| POST | `/api/ficheTechnique/construireManuellement` | `ficheId` | `modules/ficheTechnique.construireManuellement` |
| GET | `/api/ficheTechnique/searchAccessoiresCatalogue` | `query`, `limit`, `famille` | `modules/ficheTechnique.searchAccessoiresCatalogue` |
| POST | `/api/ficheTechnique/addAccessoire` | `ficheId`, `payload` | `modules/ficheTechnique.addAccessoire` |
| POST | `/api/ficheTechnique/updateAccessoire` | `accessoireId`, `patch` | `modules/ficheTechnique.updateAccessoire` |
| POST | `/api/ficheTechnique/setAccessoirePhoto` | `accessoireId`, `sourcePath` | `modules/ficheTechnique.setAccessoirePhoto` |
| POST | `/api/ficheTechnique/deleteAccessoire` | `accessoireId` | `modules/ficheTechnique.deleteAccessoire` |
| POST | `/api/ficheTechnique/reorderAccessoires` | `ficheId`, `orderedIds` | `modules/ficheTechnique.reorderAccessoires` |
| GET | `/api/ficheTechnique/listFournitureCouleurs` | `ftAccessoireId` | `modules/ficheTechnique.listFournitureCouleurs` |
| POST | `/api/ficheTechnique/addFournitureCouleur` | `ftAccessoireId`, `payload` | `modules/ficheTechnique.addFournitureCouleur` |
| POST | `/api/ficheTechnique/updateFournitureCouleur` | `id`, `patch` | `modules/ficheTechnique.updateFournitureCouleur` |
| POST | `/api/ficheTechnique/deleteFournitureCouleur` | `id` | `modules/ficheTechnique.deleteFournitureCouleur` |
| GET | `/api/ficheTechnique/searchMatieresCatalogue` | `query`, `limit` | `modules/ficheTechnique.searchMatieresCatalogue` |
| GET | `/api/ficheTechnique/listMatiereCouleurs` | `matiereCatalogueId` | `modules/ficheTechnique.listMatiereCouleurs` |
| POST | `/api/ficheTechnique/createMatiereCouleur` | `matiereCatalogueId`, `payload` | `modules/ficheTechnique.createMatiereCouleur` |
| POST | `/api/ficheTechnique/addMatiere` | `ficheId`, `payload` | `modules/ficheTechnique.addMatiere` |
| POST | `/api/ficheTechnique/updateMatiere` | `ftMatiereId`, `patch` | `modules/ficheTechnique.updateMatiere` |
| POST | `/api/ficheTechnique/deleteMatiere` | `ftMatiereId` | `modules/ficheTechnique.deleteMatiere` |
| POST | `/api/ficheTechnique/reorderMatieres` | `ficheId`, `orderedIds` | `modules/ficheTechnique.reorderMatieres` |
| GET | `/api/ficheTechnique/listMatieres` | `ficheId` | `modules/ficheTechnique.listMatieres` |
| POST | `/api/ficheTechnique/addMatiereCouleur` | `ftMatiereId`, `payload` | `modules/ficheTechnique.addMatiereCouleur` |
| POST | `/api/ficheTechnique/updateMatiereCouleur` | `ftMatiereCouleurId`, `patch` | `modules/ficheTechnique.updateMatiereCouleur` |
| POST | `/api/ficheTechnique/deleteMatiereCouleur` | `ftMatiereCouleurId` | `modules/ficheTechnique.deleteMatiereCouleur` |
| POST | `/api/ficheTechnique/setConsommationTaille` | `ftMatiereId`, `ftTailleId`, `valeur` | `modules/ficheTechnique.setConsommationTaille` |
| GET | `/api/ficheTechnique/listConsommationsTaille` | `ftMatiereId` | `modules/ficheTechnique.listConsommationsTaille` |

### modelesMesures

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/modelesMesures/listProduitsAvecStatut` | — | `modules/modelesMesures.listProduitsAvecStatut` |
| GET | `/api/modelesMesures/listByProduitId` | `produitId`, `options` | `modules/modelesMesures.listByProduitId` |
| GET | `/api/modelesMesures/getById` | `modeleId` | `modules/modelesMesures.getById` |
| POST | `/api/modelesMesures/create` | `produitId`, `nom` | `modules/modelesMesures.create` |
| POST | `/api/modelesMesures/dupliquer` | `modeleId`, `nouveauNom` | `modules/modelesMesures.dupliquer` |
| POST | `/api/modelesMesures/updateNom` | `modeleId`, `nom` | `modules/modelesMesures.updateNom` |
| POST | `/api/modelesMesures/setActif` | `modeleId`, `actif` | `modules/modelesMesures.setActif` |
| POST | `/api/modelesMesures/deleteModele` | `modeleId` | `modules/modelesMesures.deleteModele` |
| POST | `/api/modelesMesures/addLigne` | `modeleId`, `nom`, `options` | `modules/modelesMesures.addLigne` |
| POST | `/api/modelesMesures/updateLigne` | `modeleId`, `ligneId`, `patch` | `modules/modelesMesures.updateLigne` |
| POST | `/api/modelesMesures/removeLigne` | `modeleId`, `ligneId` | `modules/modelesMesures.removeLigne` |
| POST | `/api/modelesMesures/reorderLignes` | `modeleId`, `orderedLigneIds` | `modules/modelesMesures.reorderLignes` |
| GET | `/api/modelesMesures/listModelesStandards` | — | `modules/modelesMesures.listModelesStandards` |
| POST | `/api/modelesMesures/chargerModeleStandard` | `modeleId`, `cle` | `modules/modelesMesures.chargerModeleStandard` |
| GET | `/api/modelesMesures/listComplementsStandards` | `cleBase` | `modules/modelesMesures.listComplementsStandards` |
| POST | `/api/modelesMesures/chargerComplementStandard` | `modeleId`, `cle` | `modules/modelesMesures.chargerComplementStandard` |

### planning

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| GET | `/api/planning/list` | `filtres` | `modules/planning.list` |
| GET | `/api/planning/get` | `id` | `modules/planning.get` |
| POST | `/api/planning/kpis` | — | `modules/planning.kpis` |
| POST | `/api/planning/creer` | `payload` | `modules/planning.creer` |
| POST | `/api/planning/mettreAJour` | `id`, `patch` | `modules/planning.mettreAJour` |
| POST | `/api/planning/deplacer` | `id`, `champ`, `nouveauMois`, `orderedIds`, `forcer` | `modules/planning.deplacer` |
| POST | `/api/planning/reordonner` | `mois`, `orderedIds` | `modules/planning.reordonner` |
| POST | `/api/planning/ajouterPhoto` | `id`, `sourcePath`, `forcer` | `modules/planning.ajouterPhoto` |
| POST | `/api/planning/retirerPhoto` | `id`, `forcer` | `modules/planning.retirerPhoto` |
| POST | `/api/planning/retirerDuPlanning` | `id` | `modules/planning.retirerDuPlanning` |
| POST | `/api/planning/supprimerProvisoire` | `id` | `modules/planning.supprimerProvisoire` |
| POST | `/api/planning/convertirEnProduit` | `id`, `payloadArticle` | `modules/planning.convertirEnProduit` |

### finance

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| POST | `/api/finance/creerFournisseur` | `payload` | `modules/finance.creerFournisseur` |
| POST | `/api/finance/mettreAJourFournisseur` | `id`, `patch` | `modules/finance.mettreAJourFournisseur` |
| GET | `/api/finance/listFournisseurs` | `options` | `modules/finance.listFournisseurs` |
| GET | `/api/finance/getFournisseur` | `id` | `modules/finance.getFournisseur` |
| POST | `/api/finance/ajouterPrixFournisseur` | `payload` | `modules/finance.ajouterPrixFournisseur` |
| GET | `/api/finance/listPrixFournisseur` | `fournisseurId`, `options` | `modules/finance.listPrixFournisseur` |
| GET | `/api/finance/prixEnVigueur` | `criteres` | `modules/finance.prixEnVigueur` |
| POST | `/api/finance/creerAchat` | `payload` | `modules/finance.creerAchat` |
| GET | `/api/finance/getAchat` | `id` | `modules/finance.getAchat` |
| GET | `/api/finance/listAchats` | `filtres` | `modules/finance.listAchats` |
| POST | `/api/finance/ajouterReceptionAchat` | `achatId`, `payload` | `modules/finance.ajouterReceptionAchat` |
| GET | `/api/finance/listReceptionsAchat` | `achatId` | `modules/finance.listReceptionsAchat` |
| POST | `/api/finance/ajouterFactureAchat` | `achatId`, `payload` | `modules/finance.ajouterFactureAchat` |
| GET | `/api/finance/listFacturesAchat` | `achatId` | `modules/finance.listFacturesAchat` |
| GET | `/api/finance/getFacture` | `id` | `modules/finance.getFacture` |
| POST | `/api/finance/statutFacture` | `id` | `modules/finance.statutFacture` |
| GET | `/api/finance/coutAchat` | `achatId` | `modules/finance.coutAchat` |
| POST | `/api/finance/affecterAchat` | `payload` | `modules/finance.affecterAchat` |
| POST | `/api/finance/quantiteDisponibleAchat` | `achatId` | `modules/finance.quantiteDisponibleAchat` |
| GET | `/api/finance/listAffectationsAchat` | `achatId` | `modules/finance.listAffectationsAchat` |
| GET | `/api/finance/coutAffectation` | `affectationId` | `modules/finance.coutAffectation` |
| GET | `/api/finance/coutCommande` | `commandeId` | `modules/finance.coutCommande` |
| GET | `/api/finance/syntheseCoutCommande` | `commandeId` | `modules/finance.syntheseCoutCommande` |
| POST | `/api/finance/creerPaiement` | `payload` | `modules/finance.creerPaiement` |
| GET | `/api/finance/listPaiementsFournisseur` | `fournisseurId` | `modules/finance.listPaiementsFournisseur` |
| POST | `/api/finance/affecterPaiement` | `payload` | `modules/finance.affecterPaiement` |
| POST | `/api/finance/creditNonAffecte` | `paiementId` | `modules/finance.creditNonAffecte` |
| GET | `/api/finance/detteFournisseur` | `fournisseurId` | `modules/finance.detteFournisseur` |
| POST | `/api/finance/ajouterEcheance` | `achatId`, `payload` | `modules/finance.ajouterEcheance` |
| GET | `/api/finance/listEcheances` | `filtres` | `modules/finance.listEcheances` |
| GET | `/api/finance/calculerEcheanceSuggeree` | `dateFacture`, `delaiJours`, `delaiFinDeMois` | `modules/finance.calculerEcheanceSuggeree` |
| GET | `/api/finance/listFacturesFournisseur` | `fournisseurId` | `modules/finance.listFacturesFournisseur` |
| POST | `/api/finance/ajouterReceptionProduction` | `commandeId`, `payload` | `modules/finance.ajouterReceptionProduction` |
| POST | `/api/finance/enregistrerRetoucheReussie` | `receptionId`, `quantite` | `modules/finance.enregistrerRetoucheReussie` |
| GET | `/api/finance/listReceptionsProduction` | `commandeId` | `modules/finance.listReceptionsProduction` |
| POST | `/api/finance/quantiteCommercialisableCommande` | `commandeId` | `modules/finance.quantiteCommercialisableCommande` |
| GET | `/api/finance/syntheseGlobale` | — | `modules/finance.syntheseGlobale` |
| GET | `/api/finance/listEcheancesDetaillees` | `filtres` | `modules/finance.listEcheancesDetaillees` |
| GET | `/api/finance/listFournisseursAvecSynthese` | `options` | `modules/finance.listFournisseursAvecSynthese` |
| GET | `/api/finance/listAchatsDetailles` | `filtres` | `modules/finance.listAchatsDetailles` |
| GET | `/api/finance/listMatieresCatalogue` | — | `modules/finance.listMatieresCatalogue` |
| POST | `/api/finance/trouverOuCreerMatiereCatalogue` | `nom`, `uniteDefaut` | `modules/finance.trouverOuCreerMatiereCatalogue` |
| POST | `/api/finance/getOuCreerEstimation` | `articleId` | `modules/finance.getOuCreerEstimation` |
| POST | `/api/finance/mettreAJourEstimation` | `estimationId`, `patch` | `modules/finance.mettreAJourEstimation` |
| POST | `/api/finance/supprimerEstimation` | `estimationId` | `modules/finance.supprimerEstimation` |
| POST | `/api/finance/ajouterLigneEstimation` | `estimationId`, `payload` | `modules/finance.ajouterLigneEstimation` |
| POST | `/api/finance/mettreAJourLigneEstimation` | `ligneId`, `patch` | `modules/finance.mettreAJourLigneEstimation` |
| POST | `/api/finance/supprimerLigneEstimation` | `ligneId` | `modules/finance.supprimerLigneEstimation` |
| GET | `/api/finance/listLignesEstimation` | `estimationId` | `modules/finance.listLignesEstimation` |
| GET | `/api/finance/syntheseEstimation` | `estimationId` | `modules/finance.syntheseEstimation` |
| GET | `/api/finance/simulationPrix` | `coutUnitaireHt`, `params`, `quantiteCommercialisable` | `modules/finance.simulationPrix` |
| GET | `/api/finance/listEstimationsResume` | — | `modules/finance.listEstimationsResume` |
| POST | `/api/finance/mettreAJourPrixVenteEnvisage` | `articleId`, `prix` | `modules/finance.mettreAJourPrixVenteEnvisage` |
| GET | `/api/finance/stockDisponibleMatiere` | `matiereCatalogueId`, `couleur` | `modules/finance.stockDisponibleMatiere` |
| POST | `/api/finance/affecterConsommationMatiere` | `payload` | `modules/finance.affecterConsommationMatiere` |
| GET | `/api/finance/syntheseStockMatiere` | — | `modules/finance.syntheseStockMatiere` |
| GET | `/api/finance/comparaisonConsommationCommande` | `commandeId` | `modules/finance.comparaisonConsommationCommande` |
| GET | `/api/finance/listFacturesAvecEcheances` | `filtres` | `modules/finance.listFacturesAvecEcheances` |
| GET | `/api/finance/listPaiementsEtAvances` | — | `modules/finance.listPaiementsEtAvances` |
| GET | `/api/finance/listPostesCout` | `options` | `modules/finance.listPostesCout` |
| GET | `/api/finance/rechercherPostesCout` | `requete`, `limite`, `categorie` | `modules/finance.rechercherPostesCout` |
| POST | `/api/finance/creerPosteCout` | `payload` | `modules/finance.creerPosteCout` |
| POST | `/api/finance/mettreAJourPosteCout` | `id`, `patch` | `modules/finance.mettreAJourPosteCout` |
| POST | `/api/finance/supprimerPosteCout` | `id` | `modules/finance.supprimerPosteCout` |

### system

| Verbe | Chemin | Paramètres | Fonction appelée |
|---|---|---|---|
| POST | `/api/system/backupAvantOperation` | `motif` | `modules/system.backupAvantOperation` |
| POST | `/api/system/loadDemoData` | — | `modules/system.loadDemoData` |
| POST | `/api/system/clearDemoData` | — | `modules/system.clearDemoData` |
