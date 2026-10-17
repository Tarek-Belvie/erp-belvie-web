// ================================================================================================
// REGISTRE DES ROUTES DE L'API — source unique.
//
// Une ligne = une fonction métier exposée. Le même registre sert à :
//   * monter les routes Express (src/routes/index.js) ;
//   * générer le client du navigateur (apps/web/src/api/routes.generated.ts) ;
//   * générer la documentation de l'API (docs/api.md).
//   → après toute modification : `npm run generer --workspace apps/api`.
//
// Convention HTTP (identique pour toutes les routes, pour qu'on n'ait jamais à deviner) :
//   lecture: true  → GET  /api/<espace>/<methode>?<param>=<valeur JSON>…   (transaction READ ONLY)
//   lecture: false → POST /api/<espace>/<methode>   corps JSON { <param>: valeur, … }
//   réponse        → 200 { resultat }  |  400 { erreur } (règle métier)  |  401/403  |  500
//
// « espace » et « methode » reprennent exactement les noms de window.api.<espace>.<methode> de
// l'ancienne application Electron : les écrans n'ont pas eu à changer.
// Les routes qui ne sont pas un simple appel (fichiers, PDF, export) sont dans speciales.js.
// ================================================================================================
const articles = require("../modules/articles");
const bcMp = require("../modules/bcMp");
const bcPf = require("../modules/bcPf");
const besoins = require("../modules/besoins");
const commandes = require("../modules/commandes");
const declinaisons = require("../modules/declinaisons");
const entreprise = require("../modules/entreprise");
const etapes = require("../modules/etapes");
const ficheTechnique = require("../modules/ficheTechnique");
const finance = require("../modules/finance");
const grillesTailles = require("../modules/grillesTailles");
const listes = require("../modules/listes");
const modelesMesures = require("../modules/modelesMesures");
const parametres = require("../modules/parametres");
const planning = require("../modules/planning");
const preparationBcMp = require("../modules/preparationBcMp");
const ratiosRepartition = require("../modules/ratiosRepartition");
const revisionsFiche = require("../modules/revisionsFiche");
const system = require("../modules/system");

const routes = [
  // ---------------------------------------------------------------- commandes
  { espace: "commandes", methode: "list", lecture: true, params: [], appel: (db) => commandes.list(db) },
  { espace: "commandes", methode: "get", lecture: true, params: ["id"], appel: (db, id) => commandes.get(db, id) },
  { espace: "commandes", methode: "create", lecture: false, params: ["payload"], appel: (db, payload) => commandes.create(db, payload) },
  { espace: "commandes", methode: "update", lecture: false, params: ["id", "payload"], appel: (db, id, payload) => commandes.update(db, id, payload) },
  { espace: "commandes", methode: "remove", lecture: false, params: ["id"], appel: (db, id) => commandes.remove(db, id) },
  { espace: "commandes", methode: "besoinsMatieres", lecture: false, params: ["id"], appel: (db, id) => commandes.besoinsMatieres(db, id) },
  { espace: "commandes", methode: "valider", lecture: false, params: ["id"], appel: (db, id) => commandes.validerCommande(db, id) },
  { espace: "commandes", methode: "lancerProduction", lecture: false, params: ["id"], appel: (db, id) => commandes.lancerProduction(db, id) },
  { espace: "commandes", methode: "entrerEnControleQualite", lecture: false, params: ["id"], appel: (db, id) => commandes.entrerEnControleQualite(db, id) },
  { espace: "commandes", methode: "terminerProduction", lecture: false, params: ["id"], appel: (db, id) => commandes.terminerProduction(db, id) },
  { espace: "commandes", methode: "annuler", lecture: false, params: ["id", "motif"], appel: (db, id, motif) => commandes.annulerCommande(db, id, motif) },
  { espace: "commandes", methode: "bloquer", lecture: false, params: ["id", "motif"], appel: (db, id, motif) => commandes.bloquer(db, id, motif) },
  { espace: "commandes", methode: "debloquer", lecture: false, params: ["id"], appel: (db, id) => commandes.debloquer(db, id) },
  { espace: "commandes", methode: "archiver", lecture: false, params: ["id"], appel: (db, id) => commandes.archiver(db, id) },
  { espace: "commandes", methode: "desarchiver", lecture: false, params: ["id"], appel: (db, id) => commandes.desarchiver(db, id) },
  // ---------------------------------------------------------------- articles
  { espace: "articles", methode: "list", lecture: true, params: ["opts"], appel: (db, opts) => articles.list(db, opts) },
  { espace: "articles", methode: "get", lecture: true, params: ["id"], appel: (db, id) => articles.get(db, id) },
  { espace: "articles", methode: "create", lecture: false, params: ["payload"], appel: (db, payload) => articles.create(db, payload) },
  { espace: "articles", methode: "update", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => articles.update(db, id, patch) },
  { espace: "articles", methode: "verifierChangementReference", lecture: true, params: ["id", "ref"], appel: (db, id, ref) => articles.verifierChangementReference(db, id, ref) },
  { espace: "articles", methode: "preparerDuplication", lecture: true, params: ["id"], appel: (db, id) => articles.preparerDuplication(db, id) },
  { espace: "articles", methode: "completerReference", lecture: false, params: ["id", "payload"], appel: (db, id, payload) => articles.completerReference(db, id, payload) },
  { espace: "articles", methode: "ajouterPhoto", lecture: false, params: ["articleId", "sourcePath"], appel: (db, articleId, sourcePath) => articles.ajouterPhoto(db, articleId, sourcePath) },
  { espace: "articles", methode: "definirPhotoPrincipale", lecture: false, params: ["photoId"], appel: (db, photoId) => articles.definirPhotoPrincipale(db, photoId) },
  { espace: "articles", methode: "retirerPhoto", lecture: false, params: ["photoId"], appel: (db, photoId) => articles.retirerPhoto(db, photoId) },
  // ---------------------------------------------------------------- etapes
  { espace: "etapes", methode: "list", lecture: true, params: ["opts"], appel: (db, opts) => etapes.list(db, opts) },
  { espace: "etapes", methode: "update", lecture: false, params: ["id", "payload"], appel: (db, id, payload) => etapes.update(db, id, payload) },
  { espace: "etapes", methode: "create", lecture: false, params: ["payload"], appel: (db, payload) => etapes.create(db, payload) },
  // ---------------------------------------------------------------- listes
  { espace: "listes", methode: "list", lecture: true, params: ["type", "opts"], appel: (db, type, opts) => listes.list(db, type, opts) },
  { espace: "listes", methode: "create", lecture: false, params: ["type", "nom", "opts"], appel: (db, type, nom, opts) => listes.create(db, type, nom, opts) },
  { espace: "listes", methode: "update", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => listes.update(db, id, patch) },
  // ---------------------------------------------------------------- parametres
  { espace: "parametres", methode: "getOperateurActif", lecture: true, params: [], appel: (db) => parametres.getOperateurActif(db) },
  { espace: "parametres", methode: "setOperateurActif", lecture: false, params: ["operateurId"], appel: (db, operateurId) => parametres.setOperateurActif(db, operateurId) },
  // ---------------------------------------------------------------- photos
  // SPÉCIAL : photos:pick → voir routes/speciales.js
  // ---------------------------------------------------------------- entreprise
  { espace: "entreprise", methode: "get", lecture: true, params: [], appel: (db) => entreprise.get(db) },
  { espace: "entreprise", methode: "save", lecture: false, params: ["payload"], appel: (db, payload) => entreprise.save(db, payload) },
  // SPÉCIAL : entreprise:pickLogo → voir routes/speciales.js
  { espace: "entreprise", methode: "setLogo", lecture: false, params: ["sourcePath"], appel: (db, sourcePath) => entreprise.setLogo(db, sourcePath) },
  { espace: "entreprise", methode: "removeLogo", lecture: false, params: [], appel: (db) => entreprise.removeLogo(db) },
  { espace: "entreprise", methode: "getEtatWizard", lecture: true, params: [], appel: (db) => entreprise.getEtatWizard(db) },
  { espace: "entreprise", methode: "setEtatWizard", lecture: false, params: ["etat"], appel: (db, etat) => entreprise.setEtatWizard(db, etat) },
  // ---------------------------------------------------------------- bcPf
  { espace: "bcPf", methode: "getByCommandeId", lecture: true, params: ["commandeId"], appel: (db, commandeId) => bcPf.getByCommandeId(db, commandeId) },
  { espace: "bcPf", methode: "listForCommande", lecture: true, params: ["commandeId"], appel: (db, commandeId) => bcPf.listForCommande(db, commandeId) },
  { espace: "bcPf", methode: "get", lecture: true, params: ["id"], appel: (db, id) => bcPf.get(db, id) },
  { espace: "bcPf", methode: "creer", lecture: false, params: ["commandeId"], appel: (db, commandeId) => bcPf.creerBcPf(db, commandeId) },
  { espace: "bcPf", methode: "update", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => bcPf.updateBrouillonDoc(db, id, patch) },
  { espace: "bcPf", methode: "mettreAJourDepuisCommande", lecture: false, params: ["id"], appel: (db, id) => bcPf.mettreAJourDepuisCommande(db, id) },
  { espace: "bcPf", methode: "valider", lecture: false, params: ["id"], appel: (db, id) => bcPf.validerBcPf(db, id) },
  // SPÉCIAL : bcPf:lancer → voir routes/speciales.js
  { espace: "bcPf", methode: "remplacer", lecture: false, params: ["id", "motif"], appel: (db, id, motif) => bcPf.remplacerBcPf(db, id, motif) },
  // SPÉCIAL : bcPf:telechargerPdf → voir routes/speciales.js
  // ---------------------------------------------------------------- declinaisons
  { espace: "declinaisons", methode: "listTypes", lecture: true, params: ["options"], appel: (db, options) => declinaisons.listTypes(db, options) },
  { espace: "declinaisons", methode: "createType", lecture: false, params: ["nom", "options"], appel: (db, nom, options) => declinaisons.createType(db, nom, options) },
  { espace: "declinaisons", methode: "updateType", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => declinaisons.updateType(db, id, patch) },
  { espace: "declinaisons", methode: "reorderTypes", lecture: false, params: ["orderedIds"], appel: (db, orderedIds) => declinaisons.reorderTypes(db, orderedIds) },
  { espace: "declinaisons", methode: "listValeurs", lecture: true, params: ["typeId", "options"], appel: (db, typeId, options) => declinaisons.listValeurs(db, typeId, options) },
  { espace: "declinaisons", methode: "createValeur", lecture: false, params: ["typeId", "valeur", "options"], appel: (db, typeId, valeur, options) => declinaisons.createValeur(db, typeId, valeur, options) },
  { espace: "declinaisons", methode: "updateValeur", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => declinaisons.updateValeur(db, id, patch) },
  { espace: "declinaisons", methode: "reorderValeurs", lecture: false, params: ["typeId", "orderedIds"], appel: (db, typeId, orderedIds) => declinaisons.reorderValeurs(db, typeId, orderedIds) },
  { espace: "declinaisons", methode: "getArticleTypes", lecture: true, params: ["articleId"], appel: (db, articleId) => declinaisons.getArticleDeclinaisonTypes(db, articleId) },
  { espace: "declinaisons", methode: "getArticleValeurs", lecture: true, params: ["articleId"], appel: (db, articleId) => declinaisons.getArticleDeclinaisonValeurs(db, articleId) },
  { espace: "declinaisons", methode: "setArticleTypes", lecture: false, params: ["articleId", "typeIds"], appel: (db, articleId, typeIds) => declinaisons.setArticleDeclinaisonTypes(db, articleId, typeIds) },
  { espace: "declinaisons", methode: "articleHasVariantes", lecture: true, params: ["articleId"], appel: (db, articleId) => declinaisons.articleHasVariantes(db, articleId) },
  { espace: "declinaisons", methode: "previsualiserImpact", lecture: true, params: ["articleId", "selections"], appel: (db, articleId, selections) => declinaisons.previsualiserImpact(db, articleId, selections) },
  { espace: "declinaisons", methode: "appliquerConfiguration", lecture: false, params: ["articleId", "typeIds", "selections"], appel: (db, articleId, typeIds, selections) => declinaisons.appliquerConfiguration(db, articleId, typeIds, selections) },
  { espace: "declinaisons", methode: "listVariantes", lecture: true, params: ["articleId", "options"], appel: (db, articleId, options) => declinaisons.listVariantes(db, articleId, options) },
  { espace: "declinaisons", methode: "getVariante", lecture: true, params: ["id"], appel: (db, id) => declinaisons.getVariante(db, id) },
  { espace: "declinaisons", methode: "genererVariantes", lecture: false, params: ["articleId", "selections"], appel: (db, articleId, selections) => declinaisons.genererVariantes(db, articleId, selections) },
  { espace: "declinaisons", methode: "updateVariante", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => declinaisons.updateVariante(db, id, patch) },
  { espace: "declinaisons", methode: "deleteVariante", lecture: false, params: ["id"], appel: (db, id) => declinaisons.deleteVariante(db, id) },
  // ---------------------------------------------------------------- grillesTailles
  { espace: "grillesTailles", methode: "list", lecture: true, params: ["options"], appel: (db, options) => grillesTailles.listGrilles(db, options) },
  { espace: "grillesTailles", methode: "get", lecture: true, params: ["grilleId"], appel: (db, grilleId) => grillesTailles.getGrille(db, grilleId) },
  { espace: "grillesTailles", methode: "creer", lecture: false, params: ["nom"], appel: (db, nom) => grillesTailles.creerGrille(db, nom) },
  { espace: "grillesTailles", methode: "renommer", lecture: false, params: ["grilleId", "nom"], appel: (db, grilleId, nom) => grillesTailles.renommerGrille(db, grilleId, nom) },
  { espace: "grillesTailles", methode: "setActive", lecture: false, params: ["grilleId", "actif"], appel: (db, grilleId, actif) => grillesTailles.setGrilleActive(db, grilleId, actif) },
  { espace: "grillesTailles", methode: "supprimer", lecture: false, params: ["grilleId"], appel: (db, grilleId) => grillesTailles.supprimerGrille(db, grilleId) },
  { espace: "grillesTailles", methode: "ajouterValeur", lecture: false, params: ["grilleId", "valeur"], appel: (db, grilleId, valeur) => grillesTailles.ajouterValeur(db, grilleId, valeur) },
  { espace: "grillesTailles", methode: "modifierValeur", lecture: false, params: ["grilleId", "valeurId", "valeur"], appel: (db, grilleId, valeurId, valeur) => grillesTailles.modifierValeur(db, grilleId, valeurId, valeur) },
  { espace: "grillesTailles", methode: "supprimerValeur", lecture: false, params: ["grilleId", "valeurId"], appel: (db, grilleId, valeurId) => grillesTailles.supprimerValeur(db, grilleId, valeurId) },
  { espace: "grillesTailles", methode: "reordonnerValeurs", lecture: false, params: ["grilleId", "orderedIds"], appel: (db, grilleId, orderedIds) => grillesTailles.reordonnerValeurs(db, grilleId, orderedIds) },
  { espace: "grillesTailles", methode: "getPourProduit", lecture: true, params: ["produitId"], appel: (db, produitId) => grillesTailles.getGrillePourProduit(db, produitId) },
  { espace: "grillesTailles", methode: "setPourProduit", lecture: false, params: ["produitId", "grilleId"], appel: (db, produitId, grilleId) => grillesTailles.setGrillePourProduit(db, produitId, grilleId) },
  // ---------------------------------------------------------------- ratiosRepartition
  { espace: "ratiosRepartition", methode: "listPourGrille", lecture: true, params: ["grilleId"], appel: (db, grilleId) => ratiosRepartition.listPourGrille(db, grilleId) },
  { espace: "ratiosRepartition", methode: "enregistrer", lecture: false, params: ["payload"], appel: (db, payload) => ratiosRepartition.enregistrer(db, payload) },
  { espace: "ratiosRepartition", methode: "supprimer", lecture: false, params: ["ratioId"], appel: (db, ratioId) => ratiosRepartition.supprimer(db, ratioId) },
  // ---------------------------------------------------------------- approvisionnement
  { espace: "approvisionnement", methode: "calculerBesoins", lecture: true, params: ["commandeId", "options"], appel: (db, commandeId, options) => besoins.calculerPourCommande(db, commandeId, options) },
  { espace: "approvisionnement", methode: "etatsApprovisionnement", lecture: true, params: ["commandeIds"], appel: (db, commandeIds) => besoins.etatsApprovisionnement(db, commandeIds) },
  // ---------------------------------------------------------------- bcMp
  { espace: "bcMp", methode: "regrouper", lecture: true, params: ["commandeIds"], appel: (db, commandeIds) => preparationBcMp.regrouper(db, commandeIds) },
  { espace: "bcMp", methode: "creerLot", lecture: false, params: ["bons"], appel: (db, bons) => bcMp.creerLot(db, bons) },
  { espace: "bcMp", methode: "enregistrerPreparation", lecture: false, params: ["payload"], appel: (db, payload) => bcMp.enregistrerPreparation(db, payload) },
  { espace: "bcMp", methode: "creer", lecture: false, params: ["payload"], appel: (db, payload) => bcMp.creer(db, payload) },
  { espace: "bcMp", methode: "get", lecture: true, params: ["bonId"], appel: (db, bonId) => bcMp.get(db, bonId) },
  { espace: "bcMp", methode: "list", lecture: true, params: ["filtres"], appel: (db, filtres) => bcMp.list(db, filtres) },
  { espace: "bcMp", methode: "mettreAJour", lecture: false, params: ["bonId", "patch"], appel: (db, bonId, patch) => bcMp.mettreAJour(db, bonId, patch) },
  { espace: "bcMp", methode: "supprimer", lecture: false, params: ["bonId"], appel: (db, bonId) => bcMp.supprimer(db, bonId) },
  { espace: "bcMp", methode: "ajouterLigne", lecture: false, params: ["bonId", "ligne"], appel: (db, bonId, ligne) => bcMp.ajouterLigne(db, bonId, ligne) },
  { espace: "bcMp", methode: "mettreAJourLigne", lecture: false, params: ["ligneId", "patch"], appel: (db, ligneId, patch) => bcMp.mettreAJourLigne(db, ligneId, patch) },
  { espace: "bcMp", methode: "supprimerLigne", lecture: false, params: ["ligneId"], appel: (db, ligneId) => bcMp.supprimerLigne(db, ligneId) },
  // ---------------------------------------------------------------- ficheTechnique
  // SPÉCIAL : ficheTechnique:pickCroquis → voir routes/speciales.js
  // SPÉCIAL : ficheTechnique:pickAccessoirePhoto → voir routes/speciales.js
  { espace: "ficheTechnique", methode: "getOrCreateByArticleId", lecture: false, params: ["articleId"], appel: (db, articleId) => ficheTechnique.getOrCreateByArticleId(db, articleId) },
  { espace: "ficheTechnique", methode: "get", lecture: true, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.get(db, ficheId) },
  { espace: "ficheTechnique", methode: "listAll", lecture: true, params: [], appel: (db) => ficheTechnique.listAll(db) },
  { espace: "ficheTechnique", methode: "updateNotes", lecture: false, params: ["ficheId", "notes"], appel: (db, ficheId, notes) => ficheTechnique.updateNotes(db, ficheId, notes) },
  { espace: "ficheTechnique", methode: "updateDescriptionTechnique", lecture: false, params: ["ficheId", "html"], appel: (db, ficheId, html) => ficheTechnique.updateDescriptionTechnique(db, ficheId, html) },
  // SPÉCIAL : ficheTechnique:telechargerPdf → voir routes/speciales.js
  { espace: "ficheTechnique", methode: "updateCoupe", lecture: false, params: ["ficheId", "coupeId"], appel: (db, ficheId, coupeId) => ficheTechnique.updateCoupe(db, ficheId, coupeId) },
  { espace: "ficheTechnique", methode: "validerFiche", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.validerFiche(db, ficheId) },
  { espace: "ficheTechnique", methode: "apercuModification", lecture: true, params: ["ficheId"], appel: (db, ficheId) => revisionsFiche.apercuModification(db, ficheId) },
  { espace: "ficheTechnique", methode: "rouvrirPourModification", lecture: false, params: ["ficheId", "options"], appel: (db, ficheId, options) => revisionsFiche.rouvrirPourModification(db, ficheId, options) },
  { espace: "ficheTechnique", methode: "listRevisions", lecture: true, params: ["ficheId"], appel: (db, ficheId) => revisionsFiche.listRevisions(db, ficheId) },
  { espace: "ficheTechnique", methode: "getRevision", lecture: true, params: ["revisionId"], appel: (db, revisionId) => revisionsFiche.getRevision(db, revisionId) },
  { espace: "ficheTechnique", methode: "archiverFiche", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.archiverFiche(db, ficheId) },
  { espace: "ficheTechnique", methode: "addCroquis", lecture: false, params: ["ficheId", "sourcePath", "options"], appel: (db, ficheId, sourcePath, options) => ficheTechnique.addCroquis(db, ficheId, sourcePath, options) },
  { espace: "ficheTechnique", methode: "updateCroquis", lecture: false, params: ["croquisId", "patch"], appel: (db, croquisId, patch) => ficheTechnique.updateCroquis(db, croquisId, patch) },
  { espace: "ficheTechnique", methode: "deleteCroquis", lecture: false, params: ["croquisId"], appel: (db, croquisId) => ficheTechnique.deleteCroquis(db, croquisId) },
  { espace: "ficheTechnique", methode: "reorderCroquis", lecture: false, params: ["ficheId", "orderedIds"], appel: (db, ficheId, orderedIds) => ficheTechnique.reorderCroquis(db, ficheId, orderedIds) },
  { espace: "ficheTechnique", methode: "addAnnotation", lecture: false, params: ["croquisId", "payload"], appel: (db, croquisId, payload) => ficheTechnique.addAnnotation(db, croquisId, payload) },
  { espace: "ficheTechnique", methode: "updateAnnotation", lecture: false, params: ["annotationId", "patch"], appel: (db, annotationId, patch) => ficheTechnique.updateAnnotation(db, annotationId, patch) },
  { espace: "ficheTechnique", methode: "deleteAnnotation", lecture: false, params: ["annotationId"], appel: (db, annotationId) => ficheTechnique.deleteAnnotation(db, annotationId) },
  { espace: "ficheTechnique", methode: "searchMesuresCatalogue", lecture: true, params: ["query", "limit"], appel: (db, query, limit) => ficheTechnique.searchMesuresCatalogue(db, query, limit) },
  { espace: "ficheTechnique", methode: "addMesureLigne", lecture: false, params: ["ficheId", "nom", "options"], appel: (db, ficheId, nom, options) => ficheTechnique.addMesureLigne(db, ficheId, nom, options) },
  { espace: "ficheTechnique", methode: "updateMesureLigne", lecture: false, params: ["ficheId", "mesureCatalogueId", "patch"], appel: (db, ficheId, mesureCatalogueId, patch) => ficheTechnique.updateMesureLigne(db, ficheId, mesureCatalogueId, patch) },
  { espace: "ficheTechnique", methode: "removeMesureLigne", lecture: false, params: ["ficheId", "mesureCatalogueId"], appel: (db, ficheId, mesureCatalogueId) => ficheTechnique.removeMesureLigne(db, ficheId, mesureCatalogueId) },
  { espace: "ficheTechnique", methode: "reorderMesuresLignes", lecture: false, params: ["ficheId", "orderedIds"], appel: (db, ficheId, orderedIds) => ficheTechnique.reorderMesuresLignes(db, ficheId, orderedIds) },
  { espace: "ficheTechnique", methode: "searchTaillesCatalogue", lecture: true, params: ["query", "limit"], appel: (db, query, limit) => ficheTechnique.searchTaillesCatalogue(db, query, limit) },
  { espace: "ficheTechnique", methode: "addTaille", lecture: false, params: ["ficheId", "nom"], appel: (db, ficheId, nom) => ficheTechnique.addTaille(db, ficheId, nom) },
  { espace: "ficheTechnique", methode: "tailleAValeurs", lecture: true, params: ["ftTailleId"], appel: (db, ftTailleId) => ficheTechnique.tailleAValeurs(db, ftTailleId) },
  { espace: "ficheTechnique", methode: "confirmerTailles", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.confirmerTailles(db, ficheId) },
  { espace: "ficheTechnique", methode: "removeTaille", lecture: false, params: ["ficheId", "ftTailleId"], appel: (db, ficheId, ftTailleId) => ficheTechnique.removeTaille(db, ficheId, ftTailleId) },
  { espace: "ficheTechnique", methode: "reorderTailles", lecture: false, params: ["ficheId", "orderedIds"], appel: (db, ficheId, orderedIds) => ficheTechnique.reorderTailles(db, ficheId, orderedIds) },
  { espace: "ficheTechnique", methode: "setValeur", lecture: false, params: ["ficheId", "mesureCatalogueId", "ftTailleId", "valeur"], appel: (db, ficheId, mesureCatalogueId, ftTailleId, valeur) => ficheTechnique.setValeur(db, ficheId, mesureCatalogueId, ftTailleId, valeur) },
  { espace: "ficheTechnique", methode: "ensureMesuresGenerees", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.ensureMesuresGenerees(db, ficheId) },
  { espace: "ficheTechnique", methode: "getMesuresStatut", lecture: true, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.getMesuresStatut(db, ficheId) },
  { espace: "ficheTechnique", methode: "mesuresSuggerees", lecture: true, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.mesuresSuggerees(db, ficheId) },
  { espace: "ficheTechnique", methode: "mesuresManquantes", lecture: true, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.mesuresManquantes(db, ficheId) },
  { espace: "ficheTechnique", methode: "ajouterMesuresManquantes", lecture: false, params: ["ficheId", "mesures"], appel: (db, ficheId, mesures) => ficheTechnique.ajouterMesuresManquantes(db, ficheId, mesures) },
  { espace: "ficheTechnique", methode: "creerTableauMesures", lecture: false, params: ["ficheId", "mesures"], appel: (db, ficheId, mesures) => ficheTechnique.creerTableauMesures(db, ficheId, mesures) },
  { espace: "ficheTechnique", methode: "reinitialiserChoixMesures", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.reinitialiserChoixMesures(db, ficheId) },
  { espace: "ficheTechnique", methode: "taillesDisponibles", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.taillesDisponibles(db, ficheId) },
  { espace: "ficheTechnique", methode: "selectionnerTaille", lecture: false, params: ["ficheId", "grilleValeurId"], appel: (db, ficheId, grilleValeurId) => ficheTechnique.selectionnerTaille(db, ficheId, grilleValeurId) },
  { espace: "ficheTechnique", methode: "ajouterTailleExceptionnelle", lecture: false, params: ["ficheId", "nom"], appel: (db, ficheId, nom) => ficheTechnique.ajouterTailleExceptionnelle(db, ficheId, nom) },
  { espace: "ficheTechnique", methode: "analyserChangementGrille", lecture: false, params: ["ficheId", "grilleId"], appel: (db, ficheId, grilleId) => ficheTechnique.analyserChangementGrille(db, ficheId, grilleId) },
  { espace: "ficheTechnique", methode: "definirGrille", lecture: false, params: ["ficheId", "grilleId", "options"], appel: (db, ficheId, grilleId, options) => ficheTechnique.definirGrille(db, ficheId, grilleId, options) },
  { espace: "ficheTechnique", methode: "intervallesGradation", lecture: false, params: ["ficheId", "mesureId"], appel: (db, ficheId, mesureId) => ficheTechnique.intervallesGradation(db, ficheId, mesureId) },
  { espace: "ficheTechnique", methode: "setGradation", lecture: false, params: ["ficheId", "mesureId", "departId", "arriveeId", "valeur"], appel: (db, ficheId, mesureId, departId, arriveeId, valeur) => ficheTechnique.setGradation(db, ficheId, mesureId, departId, arriveeId, valeur) },
  { espace: "ficheTechnique", methode: "simulerGradation", lecture: false, params: ["ficheId", "mesureId", "refId"], appel: (db, ficheId, mesureId, refId) => ficheTechnique.simulerGradation(db, ficheId, mesureId, refId) },
  { espace: "ficheTechnique", methode: "appliquerGradation", lecture: false, params: ["ficheId", "mesureId", "refId", "mode"], appel: (db, ficheId, mesureId, refId, mode) => ficheTechnique.appliquerGradation(db, ficheId, mesureId, refId, mode) },
  { espace: "ficheTechnique", methode: "appliquerModele", lecture: false, params: ["ficheId", "modeleId"], appel: (db, ficheId, modeleId) => ficheTechnique.appliquerModele(db, ficheId, modeleId) },
  { espace: "ficheTechnique", methode: "construireManuellement", lecture: false, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.construireManuellement(db, ficheId) },
  { espace: "ficheTechnique", methode: "searchAccessoiresCatalogue", lecture: true, params: ["query", "limit", "famille"], appel: (db, query, limit, famille) => ficheTechnique.searchAccessoiresCatalogue(db, query, limit, famille) },
  { espace: "ficheTechnique", methode: "addAccessoire", lecture: false, params: ["ficheId", "payload"], appel: (db, ficheId, payload) => ficheTechnique.addAccessoire(db, ficheId, payload) },
  { espace: "ficheTechnique", methode: "updateAccessoire", lecture: false, params: ["accessoireId", "patch"], appel: (db, accessoireId, patch) => ficheTechnique.updateAccessoire(db, accessoireId, patch) },
  { espace: "ficheTechnique", methode: "setAccessoirePhoto", lecture: false, params: ["accessoireId", "sourcePath"], appel: (db, accessoireId, sourcePath) => ficheTechnique.setAccessoirePhoto(db, accessoireId, sourcePath) },
  { espace: "ficheTechnique", methode: "deleteAccessoire", lecture: false, params: ["accessoireId"], appel: (db, accessoireId) => ficheTechnique.deleteAccessoire(db, accessoireId) },
  { espace: "ficheTechnique", methode: "reorderAccessoires", lecture: false, params: ["ficheId", "orderedIds"], appel: (db, ficheId, orderedIds) => ficheTechnique.reorderAccessoires(db, ficheId, orderedIds) },
  { espace: "ficheTechnique", methode: "listFournitureCouleurs", lecture: true, params: ["ftAccessoireId"], appel: (db, ftAccessoireId) => ficheTechnique.listFournitureCouleurs(db, ftAccessoireId) },
  { espace: "ficheTechnique", methode: "addFournitureCouleur", lecture: false, params: ["ftAccessoireId", "payload"], appel: (db, ftAccessoireId, payload) => ficheTechnique.addFournitureCouleur(db, ftAccessoireId, payload) },
  { espace: "ficheTechnique", methode: "updateFournitureCouleur", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => ficheTechnique.updateFournitureCouleur(db, id, patch) },
  { espace: "ficheTechnique", methode: "deleteFournitureCouleur", lecture: false, params: ["id"], appel: (db, id) => ficheTechnique.deleteFournitureCouleur(db, id) },
  { espace: "ficheTechnique", methode: "searchMatieresCatalogue", lecture: true, params: ["query", "limit"], appel: (db, query, limit) => ficheTechnique.searchMatieresCatalogue(db, query, limit) },
  { espace: "ficheTechnique", methode: "listMatiereCouleurs", lecture: true, params: ["matiereCatalogueId"], appel: (db, matiereCatalogueId) => ficheTechnique.listMatiereCouleurs(db, matiereCatalogueId) },
  { espace: "ficheTechnique", methode: "createMatiereCouleur", lecture: false, params: ["matiereCatalogueId", "payload"], appel: (db, matiereCatalogueId, payload) => ficheTechnique.createMatiereCouleur(db, matiereCatalogueId, payload) },
  { espace: "ficheTechnique", methode: "addMatiere", lecture: false, params: ["ficheId", "payload"], appel: (db, ficheId, payload) => ficheTechnique.addMatiere(db, ficheId, payload) },
  { espace: "ficheTechnique", methode: "updateMatiere", lecture: false, params: ["ftMatiereId", "patch"], appel: (db, ftMatiereId, patch) => ficheTechnique.updateMatiere(db, ftMatiereId, patch) },
  { espace: "ficheTechnique", methode: "deleteMatiere", lecture: false, params: ["ftMatiereId"], appel: (db, ftMatiereId) => ficheTechnique.deleteMatiere(db, ftMatiereId) },
  { espace: "ficheTechnique", methode: "reorderMatieres", lecture: false, params: ["ficheId", "orderedIds"], appel: (db, ficheId, orderedIds) => ficheTechnique.reorderMatieres(db, ficheId, orderedIds) },
  { espace: "ficheTechnique", methode: "listMatieres", lecture: true, params: ["ficheId"], appel: (db, ficheId) => ficheTechnique.listMatieres(db, ficheId) },
  { espace: "ficheTechnique", methode: "addMatiereCouleur", lecture: false, params: ["ftMatiereId", "payload"], appel: (db, ftMatiereId, payload) => ficheTechnique.addMatiereCouleur(db, ftMatiereId, payload) },
  { espace: "ficheTechnique", methode: "updateMatiereCouleur", lecture: false, params: ["ftMatiereCouleurId", "patch"], appel: (db, ftMatiereCouleurId, patch) => ficheTechnique.updateMatiereCouleur(db, ftMatiereCouleurId, patch) },
  { espace: "ficheTechnique", methode: "deleteMatiereCouleur", lecture: false, params: ["ftMatiereCouleurId"], appel: (db, ftMatiereCouleurId) => ficheTechnique.deleteMatiereCouleur(db, ftMatiereCouleurId) },
  { espace: "ficheTechnique", methode: "setConsommationTaille", lecture: false, params: ["ftMatiereId", "ftTailleId", "valeur"], appel: (db, ftMatiereId, ftTailleId, valeur) => ficheTechnique.setConsommationTaille(db, ftMatiereId, ftTailleId, valeur) },
  { espace: "ficheTechnique", methode: "listConsommationsTaille", lecture: true, params: ["ftMatiereId"], appel: (db, ftMatiereId) => ficheTechnique.listConsommationsTaille(db, ftMatiereId) },
  // ---------------------------------------------------------------- modelesMesures
  { espace: "modelesMesures", methode: "listProduitsAvecStatut", lecture: true, params: [], appel: (db) => modelesMesures.listProduitsAvecStatut(db) },
  { espace: "modelesMesures", methode: "listByProduitId", lecture: true, params: ["produitId", "options"], appel: (db, produitId, options) => modelesMesures.listByProduitId(db, produitId, options) },
  { espace: "modelesMesures", methode: "getById", lecture: true, params: ["modeleId"], appel: (db, modeleId) => modelesMesures.getById(db, modeleId) },
  { espace: "modelesMesures", methode: "create", lecture: false, params: ["produitId", "nom"], appel: (db, produitId, nom) => modelesMesures.create(db, produitId, nom) },
  { espace: "modelesMesures", methode: "dupliquer", lecture: false, params: ["modeleId", "nouveauNom"], appel: (db, modeleId, nouveauNom) => modelesMesures.dupliquer(db, modeleId, nouveauNom) },
  { espace: "modelesMesures", methode: "updateNom", lecture: false, params: ["modeleId", "nom"], appel: (db, modeleId, nom) => modelesMesures.updateNom(db, modeleId, nom) },
  { espace: "modelesMesures", methode: "setActif", lecture: false, params: ["modeleId", "actif"], appel: (db, modeleId, actif) => modelesMesures.setActif(db, modeleId, actif) },
  { espace: "modelesMesures", methode: "deleteModele", lecture: false, params: ["modeleId"], appel: (db, modeleId) => modelesMesures.deleteModele(db, modeleId) },
  { espace: "modelesMesures", methode: "addLigne", lecture: false, params: ["modeleId", "nom", "options"], appel: (db, modeleId, nom, options) => modelesMesures.addLigne(db, modeleId, nom, options) },
  { espace: "modelesMesures", methode: "updateLigne", lecture: false, params: ["modeleId", "ligneId", "patch"], appel: (db, modeleId, ligneId, patch) => modelesMesures.updateLigne(db, modeleId, ligneId, patch) },
  { espace: "modelesMesures", methode: "removeLigne", lecture: false, params: ["modeleId", "ligneId"], appel: (db, modeleId, ligneId) => modelesMesures.removeLigne(db, modeleId, ligneId) },
  { espace: "modelesMesures", methode: "reorderLignes", lecture: false, params: ["modeleId", "orderedLigneIds"], appel: (db, modeleId, orderedLigneIds) => modelesMesures.reorderLignes(db, modeleId, orderedLigneIds) },
  { espace: "modelesMesures", methode: "listModelesStandards", lecture: true, params: [], appel: (db) => modelesMesures.listModelesStandards() },
  { espace: "modelesMesures", methode: "chargerModeleStandard", lecture: false, params: ["modeleId", "cle"], appel: (db, modeleId, cle) => modelesMesures.chargerModeleStandard(db, modeleId, cle) },
  { espace: "modelesMesures", methode: "listComplementsStandards", lecture: true, params: ["cleBase"], appel: (db, cleBase) => modelesMesures.listComplementsStandards(cleBase) },
  { espace: "modelesMesures", methode: "chargerComplementStandard", lecture: false, params: ["modeleId", "cle"], appel: (db, modeleId, cle) => modelesMesures.chargerComplementStandard(db, modeleId, cle) },
  // ---------------------------------------------------------------- planning
  { espace: "planning", methode: "list", lecture: true, params: ["filtres"], appel: (db, filtres) => planning.list(db, filtres) },
  { espace: "planning", methode: "get", lecture: true, params: ["id"], appel: (db, id) => planning.get(db, id) },
  { espace: "planning", methode: "kpis", lecture: false, params: [], appel: (db) => planning.kpis(db) },
  { espace: "planning", methode: "creer", lecture: false, params: ["payload"], appel: (db, payload) => planning.creer(db, payload) },
  { espace: "planning", methode: "mettreAJour", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => planning.mettreAJour(db, id, patch) },
  { espace: "planning", methode: "deplacer", lecture: false, params: ["id", "champ", "nouveauMois", "orderedIds", "forcer"], appel: (db, id, champ, nouveauMois, orderedIds, forcer) => planning.deplacer(db, id, champ, nouveauMois, orderedIds, forcer) },
  { espace: "planning", methode: "reordonner", lecture: false, params: ["mois", "orderedIds"], appel: (db, mois, orderedIds) => planning.reordonner(db, mois, orderedIds) },
  { espace: "planning", methode: "ajouterPhoto", lecture: false, params: ["id", "sourcePath", "forcer"], appel: (db, id, sourcePath, forcer) => planning.ajouterPhoto(db, id, sourcePath, forcer) },
  { espace: "planning", methode: "retirerPhoto", lecture: false, params: ["id", "forcer"], appel: (db, id, forcer) => planning.retirerPhoto(db, id, forcer) },
  { espace: "planning", methode: "retirerDuPlanning", lecture: false, params: ["id"], appel: (db, id) => planning.retirerDuPlanning(db, id) },
  { espace: "planning", methode: "supprimerProvisoire", lecture: false, params: ["id"], appel: (db, id) => planning.supprimerProvisoire(db, id) },
  { espace: "planning", methode: "convertirEnProduit", lecture: false, params: ["id", "payloadArticle"], appel: (db, id, payloadArticle) => planning.convertirEnProduit(db, id, payloadArticle) },
  // ---------------------------------------------------------------- finance
  { espace: "finance", methode: "creerFournisseur", lecture: false, params: ["payload"], appel: (db, payload) => finance.creerFournisseur(db, payload) },
  { espace: "finance", methode: "mettreAJourFournisseur", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => finance.mettreAJourFournisseur(db, id, patch) },
  { espace: "finance", methode: "listFournisseurs", lecture: true, params: ["options"], appel: (db, options) => finance.listFournisseurs(db, options) },
  { espace: "finance", methode: "getFournisseur", lecture: true, params: ["id"], appel: (db, id) => finance.getFournisseur(db, id) },
  { espace: "finance", methode: "ajouterPrixFournisseur", lecture: false, params: ["payload"], appel: (db, payload) => finance.ajouterPrixFournisseur(db, payload) },
  { espace: "finance", methode: "listPrixFournisseur", lecture: true, params: ["fournisseurId", "options"], appel: (db, fournisseurId, options) => finance.listPrixFournisseur(db, fournisseurId, options) },
  { espace: "finance", methode: "prixEnVigueur", lecture: true, params: ["criteres"], appel: (db, criteres) => finance.prixEnVigueur(db, criteres) },
  { espace: "finance", methode: "creerAchat", lecture: false, params: ["payload"], appel: (db, payload) => finance.creerAchat(db, payload) },
  { espace: "finance", methode: "getAchat", lecture: true, params: ["id"], appel: (db, id) => finance.getAchat(db, id) },
  { espace: "finance", methode: "listAchats", lecture: true, params: ["filtres"], appel: (db, filtres) => finance.listAchats(db, filtres) },
  { espace: "finance", methode: "ajouterReceptionAchat", lecture: false, params: ["achatId", "payload"], appel: (db, achatId, payload) => finance.ajouterReceptionAchat(db, achatId, payload) },
  { espace: "finance", methode: "listReceptionsAchat", lecture: true, params: ["achatId"], appel: (db, achatId) => finance.listReceptionsAchat(db, achatId) },
  { espace: "finance", methode: "ajouterFactureAchat", lecture: false, params: ["achatId", "payload"], appel: (db, achatId, payload) => finance.ajouterFactureAchat(db, achatId, payload) },
  { espace: "finance", methode: "listFacturesAchat", lecture: true, params: ["achatId"], appel: (db, achatId) => finance.listFacturesAchat(db, achatId) },
  { espace: "finance", methode: "getFacture", lecture: true, params: ["id"], appel: (db, id) => finance.getFacture(db, id) },
  { espace: "finance", methode: "statutFacture", lecture: false, params: ["id"], appel: (db, id) => finance.statutFacture(db, id) },
  { espace: "finance", methode: "coutAchat", lecture: true, params: ["achatId"], appel: (db, achatId) => finance.coutAchat(db, achatId) },
  { espace: "finance", methode: "affecterAchat", lecture: false, params: ["payload"], appel: (db, payload) => finance.affecterAchat(db, payload) },
  { espace: "finance", methode: "quantiteDisponibleAchat", lecture: false, params: ["achatId"], appel: (db, achatId) => finance.quantiteDisponibleAchat(db, achatId) },
  { espace: "finance", methode: "listAffectationsAchat", lecture: true, params: ["achatId"], appel: (db, achatId) => finance.listAffectationsAchat(db, achatId) },
  { espace: "finance", methode: "coutAffectation", lecture: true, params: ["affectationId"], appel: (db, affectationId) => finance.coutAffectation(db, affectationId) },
  { espace: "finance", methode: "coutCommande", lecture: true, params: ["commandeId"], appel: (db, commandeId) => finance.coutCommande(db, commandeId) },
  { espace: "finance", methode: "syntheseCoutCommande", lecture: true, params: ["commandeId"], appel: (db, commandeId) => finance.syntheseCoutCommande(db, commandeId) },
  { espace: "finance", methode: "creerPaiement", lecture: false, params: ["payload"], appel: (db, payload) => finance.creerPaiement(db, payload) },
  { espace: "finance", methode: "listPaiementsFournisseur", lecture: true, params: ["fournisseurId"], appel: (db, fournisseurId) => finance.listPaiementsFournisseur(db, fournisseurId) },
  { espace: "finance", methode: "affecterPaiement", lecture: false, params: ["payload"], appel: (db, payload) => finance.affecterPaiement(db, payload) },
  { espace: "finance", methode: "creditNonAffecte", lecture: false, params: ["paiementId"], appel: (db, paiementId) => finance.creditNonAffecte(db, paiementId) },
  { espace: "finance", methode: "detteFournisseur", lecture: true, params: ["fournisseurId"], appel: (db, fournisseurId) => finance.detteFournisseur(db, fournisseurId) },
  { espace: "finance", methode: "ajouterEcheance", lecture: false, params: ["achatId", "payload"], appel: (db, achatId, payload) => finance.ajouterEcheance(db, achatId, payload) },
  { espace: "finance", methode: "listEcheances", lecture: true, params: ["filtres"], appel: (db, filtres) => finance.listEcheances(db, filtres) },
  { espace: "finance", methode: "calculerEcheanceSuggeree", lecture: true, params: ["dateFacture", "delaiJours", "delaiFinDeMois"], appel: (db, dateFacture, delaiJours, delaiFinDeMois) => finance.calculerEcheanceSuggeree(dateFacture, delaiJours, delaiFinDeMois) },
  { espace: "finance", methode: "listFacturesFournisseur", lecture: true, params: ["fournisseurId"], appel: (db, fournisseurId) => finance.listFacturesFournisseur(db, fournisseurId) },
  { espace: "finance", methode: "ajouterReceptionProduction", lecture: false, params: ["commandeId", "payload"], appel: (db, commandeId, payload) => finance.ajouterReceptionProduction(db, commandeId, payload) },
  { espace: "finance", methode: "enregistrerRetoucheReussie", lecture: false, params: ["receptionId", "quantite"], appel: (db, receptionId, quantite) => finance.enregistrerRetoucheReussie(db, receptionId, quantite) },
  { espace: "finance", methode: "listReceptionsProduction", lecture: true, params: ["commandeId"], appel: (db, commandeId) => finance.listReceptionsProduction(db, commandeId) },
  { espace: "finance", methode: "quantiteCommercialisableCommande", lecture: false, params: ["commandeId"], appel: (db, commandeId) => finance.quantiteCommercialisableCommande(db, commandeId) },
  { espace: "finance", methode: "syntheseGlobale", lecture: true, params: [], appel: (db) => finance.syntheseGlobale(db) },
  { espace: "finance", methode: "listEcheancesDetaillees", lecture: true, params: ["filtres"], appel: (db, filtres) => finance.listEcheancesDetaillees(db, filtres) },
  { espace: "finance", methode: "listFournisseursAvecSynthese", lecture: true, params: ["options"], appel: (db, options) => finance.listFournisseursAvecSynthese(db, options) },
  { espace: "finance", methode: "listAchatsDetailles", lecture: true, params: ["filtres"], appel: (db, filtres) => finance.listAchatsDetailles(db, filtres) },
  { espace: "finance", methode: "listMatieresCatalogue", lecture: true, params: [], appel: (db) => finance.listMatieresCatalogue(db) },
  { espace: "finance", methode: "trouverOuCreerMatiereCatalogue", lecture: false, params: ["nom", "uniteDefaut"], appel: (db, nom, uniteDefaut) => finance.trouverOuCreerMatiereCatalogue(db, nom, uniteDefaut) },
  { espace: "finance", methode: "getOuCreerEstimation", lecture: false, params: ["articleId"], appel: (db, articleId) => finance.getOuCreerEstimation(db, articleId) },
  { espace: "finance", methode: "mettreAJourEstimation", lecture: false, params: ["estimationId", "patch"], appel: (db, estimationId, patch) => finance.mettreAJourEstimation(db, estimationId, patch) },
  { espace: "finance", methode: "supprimerEstimation", lecture: false, params: ["estimationId"], appel: (db, estimationId) => finance.supprimerEstimation(db, estimationId) },
  { espace: "finance", methode: "ajouterLigneEstimation", lecture: false, params: ["estimationId", "payload"], appel: (db, estimationId, payload) => finance.ajouterLigneEstimation(db, estimationId, payload) },
  { espace: "finance", methode: "mettreAJourLigneEstimation", lecture: false, params: ["ligneId", "patch"], appel: (db, ligneId, patch) => finance.mettreAJourLigneEstimation(db, ligneId, patch) },
  { espace: "finance", methode: "supprimerLigneEstimation", lecture: false, params: ["ligneId"], appel: (db, ligneId) => finance.supprimerLigneEstimation(db, ligneId) },
  { espace: "finance", methode: "listLignesEstimation", lecture: true, params: ["estimationId"], appel: (db, estimationId) => finance.listLignesEstimation(db, estimationId) },
  { espace: "finance", methode: "syntheseEstimation", lecture: true, params: ["estimationId"], appel: (db, estimationId) => finance.syntheseEstimation(db, estimationId) },
  { espace: "finance", methode: "simulationPrix", lecture: true, params: ["coutUnitaireHt", "params", "quantiteCommercialisable"], appel: (db, coutUnitaireHt, params, quantiteCommercialisable) => finance.simulationPrix(coutUnitaireHt, params, quantiteCommercialisable) },
  { espace: "finance", methode: "listEstimationsResume", lecture: true, params: [], appel: (db) => finance.listEstimationsResume(db) },
  { espace: "finance", methode: "mettreAJourPrixVenteEnvisage", lecture: false, params: ["articleId", "prix"], appel: (db, articleId, prix) => finance.mettreAJourPrixVenteEnvisage(db, articleId, prix) },
  { espace: "finance", methode: "stockDisponibleMatiere", lecture: true, params: ["matiereCatalogueId", "couleur"], appel: (db, matiereCatalogueId, couleur) => finance.stockDisponibleMatiere(db, matiereCatalogueId, couleur) },
  { espace: "finance", methode: "affecterConsommationMatiere", lecture: false, params: ["payload"], appel: (db, payload) => finance.affecterConsommationMatiere(db, payload) },
  { espace: "finance", methode: "syntheseStockMatiere", lecture: true, params: [], appel: (db) => finance.syntheseStockMatiere(db) },
  { espace: "finance", methode: "comparaisonConsommationCommande", lecture: true, params: ["commandeId"], appel: (db, commandeId) => finance.comparaisonConsommationCommande(db, commandeId) },
  { espace: "finance", methode: "listFacturesAvecEcheances", lecture: true, params: ["filtres"], appel: (db, filtres) => finance.listFacturesAvecEcheances(db, filtres) },
  { espace: "finance", methode: "listPaiementsEtAvances", lecture: true, params: [], appel: (db) => finance.listPaiementsEtAvances(db) },
  { espace: "finance", methode: "listPostesCout", lecture: true, params: ["options"], appel: (db, options) => finance.listPostesCout(db, options) },
  { espace: "finance", methode: "rechercherPostesCout", lecture: true, params: ["requete", "limite", "categorie"], appel: (db, requete, limite, categorie) => finance.rechercherPostesCout(db, requete, limite, categorie) },
  { espace: "finance", methode: "creerPosteCout", lecture: false, params: ["payload"], appel: (db, payload) => finance.creerPosteCout(db, payload) },
  { espace: "finance", methode: "mettreAJourPosteCout", lecture: false, params: ["id", "patch"], appel: (db, id, patch) => finance.mettreAJourPosteCout(db, id, patch) },
  { espace: "finance", methode: "supprimerPosteCout", lecture: false, params: ["id"], appel: (db, id) => finance.supprimerPosteCout(db, id) },
  // ---------------------------------------------------------------- system
  // SPÉCIAL : system:backup → voir routes/speciales.js
  // SPÉCIAL : system:verifierSauvegarde → voir routes/speciales.js
  // SPÉCIAL : system:essaiRestauration → voir routes/speciales.js
  // SPÉCIAL : system:listerSauvegardes → voir routes/speciales.js
  // SPÉCIAL : system:dossierExterne → voir routes/speciales.js
  // SPÉCIAL : system:choisirDossierExterne → voir routes/speciales.js
  // SPÉCIAL : system:oublierDossierExterne → voir routes/speciales.js
  // SPÉCIAL : system:restore → voir routes/speciales.js
  // SPÉCIAL : system:exportFile → voir routes/speciales.js
];
module.exports = routes;
