const path = require("path");
const fs = require("fs");
const { pathToFileURL } = require("url");
const { app, BrowserWindow, ipcMain, dialog, protocol, net } = require("electron");

// ================================================================================================
// LOT 1 — LE DOSSIER DE DONNÉES EST FIXÉ, AVANT TOUTE AUTRE CHOSE
// ================================================================================================
// Ces deux lignes doivent rester les premières du fichier, avant tout `require` qui pourrait lire
// un chemin. Electron range sinon les données dans `%APPDATA%\<nom de l'application>` — et ce nom
// change entre la version de développement (`belvie-erp`) et la version installée
// (`Belvie ERP`) : la seconde s'ouvrirait sur une base VIDE.
//
// Fixer le dossier ne demande aucune migration : le diagnostic du lot 0 a vérifié sur vos données
// qu'aucun chemin absolu n'est stocké en base. Tous les chemins d'images sont relatifs à ce
// dossier, donc le fixer suffit.
const dossierDonnees = require("./dossierDonnees");
const verrouInstance = require("./verrouInstance");
app.setPath("userData", dossierDonnees.cheminDonnees(app.getPath("appData")));

const { openDatabase, getDb, getDbPath, closeDatabase } = require("./db");
const commandesApi = require("./ipc/commandes");
const entrepriseApi = require("./ipc/entreprise");
const bcPfApi = require("./ipc/bcPf");
const bcPfPdfApi = require("./ipc/bcPfPdf");
const ficheTechniquePdfApi = require("./ipc/ficheTechniquePdf");
const declinaisonsApi = require("./ipc/declinaisons");
const grillesTaillesApi = require("./ipc/grillesTailles");
const ratiosRepartitionApi = require("./ipc/ratiosRepartition");
const besoinsApi = require("./ipc/besoins");
const ficheTechniqueApi = require("./ipc/ficheTechnique");
const revisionsFicheApi = require("./ipc/revisionsFiche");
const bcMpApi = require("./ipc/bcMp");
const preparationApi = require("./ipc/preparationBcMp");
const modelesMesuresApi = require("./ipc/modelesMesures");
const planningApi = require("./ipc/planning");
const financeApi = require("./ipc/finance");
const articlesApi = require("./ipc/articles");
const etapesApi = require("./ipc/etapes");
const listesApi = require("./ipc/listes");
const parametresApi = require("./ipc/parametres");
const systemApi = require("./ipc/system");
const photosApi = require("./ipc/photos");

// Doit être appelé avant app.whenReady(). Sert les photos locales au renderer sans jamais
// exposer de chemin de fichier réel côté interface (approche standard Electron).
protocol.registerSchemesAsPrivileged([
  { scheme: "belvie-media", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

// `app.isPackaged` d'abord : sans lui, une variable NODE_ENV=development restée dans
// l'environnement Windows ferait chercher le serveur de développement à la version INSTALLÉE, qui
// afficherait alors une fenêtre blanche sans la moindre explication.
const isDev = !app.isPackaged && process.env.NODE_ENV === "development";
let mainWindow = null;

// ================================================================================================
// LOT 1 — UNE SEULE INSTANCE À LA FOIS
// ================================================================================================
// Le blocage est assuré par le verrou SYSTÈME d'Electron, pas par un fichier : quand un processus
// meurt — proprement, brutalement ou par coupure de courant — Windows libère ce verrou tout seul.
// Il ne peut pas rester coincé, et il n'y a donc rien à « débloquer » à la main.
//
// Le fichier `instance-ouverte.json` ne sert qu'à EXPLIQUER qui tient le verrou. Il ne décide
// jamais rien : périmé, il ne peut produire qu'un message inexact, jamais un refus de démarrer.
const instanceUnique = app.requestSingleInstanceLock();
if (!instanceUnique) {
  const occupant = verrouInstance.occupantProbable(app.getPath("userData"));
  dialog.showErrorBox("Belvie ERP est déjà ouvert",
    verrouInstance.messageOccupe(occupant, app.getPath("userData")));
  app.quit();
} else {
  // Lancer une seconde fois ramène la fenêtre existante au premier plan, plutôt que de ne rien
  // faire du tout — un double-clic sans effet laisse croire que l'application est plantée.
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function registerMediaProtocol() {
  const userDataDir = photosApi.getUserDataDir();
  protocol.handle("belvie-media", (request) => {
    const url = new URL(request.url);
    const relPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const abs = path.join(userDataDir, relPath);

    // Sécurité : interdit toute sortie du dossier de données (traversée de chemin).
    const rel = path.relative(userDataDir, abs);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return new Response("Interdit", { status: 403 });
    }
    return net.fetch(pathToFileURL(abs).toString());
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1024,
    minHeight: 700,
    title: "Belvie ERP",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

function registerIpcHandlers() {
  // --- Commandes : CRUD de base ---
  ipcMain.handle("commandes:list", () => commandesApi.list(getDb()));
  ipcMain.handle("commandes:get", (_e, id) => commandesApi.get(getDb(), id));
  ipcMain.handle("commandes:create", (_e, payload) => commandesApi.create(getDb(), payload));
  ipcMain.handle("commandes:update", (_e, id, payload) => commandesApi.update(getDb(), id, payload));
  ipcMain.handle("commandes:remove", (_e, id) => commandesApi.remove(getDb(), id));
  ipcMain.handle("commandes:besoinsMatieres", (_e, id) => commandesApi.besoinsMatieres(getDb(), id));

  // --- Commandes : transitions de cycle de vie (chacune atomique côté serveur) ---
  ipcMain.handle("commandes:valider", (_e, id) => commandesApi.validerCommande(getDb(), id));
  ipcMain.handle("commandes:lancerProduction", (_e, id) => commandesApi.lancerProduction(getDb(), id));
  ipcMain.handle("commandes:entrerEnControleQualite", (_e, id) => commandesApi.entrerEnControleQualite(getDb(), id));
  ipcMain.handle("commandes:terminerProduction", (_e, id) => commandesApi.terminerProduction(getDb(), id));
  ipcMain.handle("commandes:annuler", (_e, id, motif) => commandesApi.annulerCommande(getDb(), id, motif));
  ipcMain.handle("commandes:bloquer", (_e, id, motif) => commandesApi.bloquer(getDb(), id, motif));
  ipcMain.handle("commandes:debloquer", (_e, id) => commandesApi.debloquer(getDb(), id));
  ipcMain.handle("commandes:archiver", (_e, id) => commandesApi.archiver(getDb(), id));
  ipcMain.handle("commandes:desarchiver", (_e, id) => commandesApi.desarchiver(getDb(), id));

  // --- Articles ---
  ipcMain.handle("articles:list", (_e, opts) => articlesApi.list(getDb(), opts));
  ipcMain.handle("articles:get", (_e, id) => articlesApi.get(getDb(), id));
  ipcMain.handle("articles:create", (_e, payload) => articlesApi.create(getDb(), payload));
  ipcMain.handle("articles:verifierChangementReference", (_e, id, ref) => articlesApi.verifierChangementReference(getDb(), id, ref));
  ipcMain.handle("articles:preparerDuplication", (_e, id) => articlesApi.preparerDuplication(getDb(), id));
  ipcMain.handle("articles:update", (_e, id, patch) => articlesApi.update(getDb(), id, patch));
  ipcMain.handle("articles:completerReference", (_e, id, payload) => articlesApi.completerReference(getDb(), id, payload));
  ipcMain.handle("articles:ajouterPhoto", (_e, articleId, sourcePath) => articlesApi.ajouterPhoto(getDb(), articleId, sourcePath));
  ipcMain.handle("articles:definirPhotoPrincipale", (_e, photoId) => articlesApi.definirPhotoPrincipale(getDb(), photoId));
  ipcMain.handle("articles:retirerPhoto", (_e, photoId) => articlesApi.retirerPhoto(getDb(), photoId));

  // --- Étapes (paramétrables) ---
  ipcMain.handle("etapes:list", (_e, opts) => etapesApi.list(getDb(), opts));
  ipcMain.handle("etapes:update", (_e, id, payload) => etapesApi.update(getDb(), id, payload));
  ipcMain.handle("etapes:create", (_e, payload) => etapesApi.create(getDb(), payload));

  // --- Listes administrables : produits, couleurs, responsables, ateliers, tailles, saisons, rayons, opérateurs ---
  ipcMain.handle("listes:list", (_e, type, opts) => listesApi.list(getDb(), type, opts));
  ipcMain.handle("listes:create", (_e, type, nom, opts) => listesApi.create(getDb(), type, nom, opts));
  ipcMain.handle("listes:update", (_e, id, patch) => listesApi.update(getDb(), id, patch));

  // --- Paramètres (opérateur actif sur ce poste, etc.) ---
  ipcMain.handle("parametres:getOperateurActif", () => parametresApi.getOperateurActif(getDb()));
  ipcMain.handle("parametres:setOperateurActif", (_e, operateurId) => parametresApi.setOperateurActif(getDb(), operateurId));

  // --- Photo (sélection de fichier générique, utilisée par le formulaire Article) ---
  ipcMain.handle("photos:pick", () => photosApi.pickImage(mainWindow));

  // --- Entreprise (informations réutilisées par les futurs documents) ---
  ipcMain.handle("entreprise:get", () => entrepriseApi.get(getDb()));
  ipcMain.handle("entreprise:save", (_e, payload) => entrepriseApi.save(getDb(), payload));
  ipcMain.handle("entreprise:pickLogo", () => photosApi.pickImage(mainWindow, "Choisir le logo de l'entreprise"));
  ipcMain.handle("entreprise:setLogo", (_e, sourcePath) => entrepriseApi.setLogo(getDb(), sourcePath));
  ipcMain.handle("entreprise:removeLogo", () => entrepriseApi.removeLogo(getDb()));
  ipcMain.handle("entreprise:getEtatWizard", () => entrepriseApi.getEtatWizard(getDb()));
  ipcMain.handle("entreprise:setEtatWizard", (_e, etat) => entrepriseApi.setEtatWizard(getDb(), etat));

  // --- BC PF (Bon de Commande Produits Finis) ---
  ipcMain.handle("bcPf:getByCommandeId", (_e, commandeId) => bcPfApi.getByCommandeId(getDb(), commandeId));
  ipcMain.handle("bcPf:listForCommande", (_e, commandeId) => bcPfApi.listForCommande(getDb(), commandeId));
  ipcMain.handle("bcPf:get", (_e, id) => bcPfApi.get(getDb(), id));
  ipcMain.handle("bcPf:creer", (_e, commandeId) => bcPfApi.creerBcPf(getDb(), commandeId));
  ipcMain.handle("bcPf:update", (_e, id, patch) => bcPfApi.updateBrouillonDoc(getDb(), id, patch));
  ipcMain.handle("bcPf:mettreAJourDepuisCommande", (_e, id) => bcPfApi.mettreAJourDepuisCommande(getDb(), id));
  ipcMain.handle("bcPf:valider", (_e, id) => bcPfApi.validerBcPf(getDb(), id));
  ipcMain.handle("bcPf:remplacer", (_e, id, motif) => bcPfApi.remplacerBcPf(getDb(), id, motif));
  // Génère le PDF depuis une fenêtre Electron entièrement dédiée à l'impression (voir
  // electron/ipc/bcPfPdf.js) — jamais depuis la fenêtre principale, pour ne plus dépendre du
  // rendu de la modale/du viewer écran ni des effets de bord de printToPDF sur webContents actifs.
  ipcMain.handle("bcPf:telechargerPdf", async (_e, id, suggestedName) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer le bon de commande en PDF",
      defaultPath: suggestedName || "bon-de-commande.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const bc = bcPfApi.get(getDb(), id);
    if (!bc) throw new Error("Bon de commande introuvable.");
    const entreprise = entrepriseApi.get(getDb());
    const html = bcPfPdfApi.buildBcPfHtml(bc, entreprise);
    await bcPfPdfApi.genererPdfDepuisFenetreDediee(html, filePath);

    return { canceled: false, filePath };
  });

  // --- Déclinaisons génériques ---
  ipcMain.handle("declinaisons:listTypes", (_e, options) => declinaisonsApi.listTypes(getDb(), options));
  ipcMain.handle("declinaisons:createType", (_e, nom, options) => declinaisonsApi.createType(getDb(), nom, options));
  ipcMain.handle("declinaisons:updateType", (_e, id, patch) => declinaisonsApi.updateType(getDb(), id, patch));
  ipcMain.handle("declinaisons:reorderTypes", (_e, orderedIds) => declinaisonsApi.reorderTypes(getDb(), orderedIds));
  ipcMain.handle("declinaisons:listValeurs", (_e, typeId, options) => declinaisonsApi.listValeurs(getDb(), typeId, options));
  ipcMain.handle("declinaisons:createValeur", (_e, typeId, valeur, options) => declinaisonsApi.createValeur(getDb(), typeId, valeur, options));
  ipcMain.handle("declinaisons:updateValeur", (_e, id, patch) => declinaisonsApi.updateValeur(getDb(), id, patch));
  ipcMain.handle("declinaisons:reorderValeurs", (_e, typeId, orderedIds) => declinaisonsApi.reorderValeurs(getDb(), typeId, orderedIds));
  ipcMain.handle("declinaisons:getArticleTypes", (_e, articleId) => declinaisonsApi.getArticleDeclinaisonTypes(getDb(), articleId));
  ipcMain.handle("declinaisons:getArticleValeurs", (_e, articleId) => declinaisonsApi.getArticleDeclinaisonValeurs(getDb(), articleId));
  ipcMain.handle("declinaisons:setArticleTypes", (_e, articleId, typeIds) => declinaisonsApi.setArticleDeclinaisonTypes(getDb(), articleId, typeIds));
  ipcMain.handle("declinaisons:articleHasVariantes", (_e, articleId) => declinaisonsApi.articleHasVariantes(getDb(), articleId));
  ipcMain.handle("declinaisons:previsualiserImpact", (_e, articleId, selections) => declinaisonsApi.previsualiserImpact(getDb(), articleId, selections));
  ipcMain.handle("declinaisons:appliquerConfiguration", (_e, articleId, typeIds, selections) => declinaisonsApi.appliquerConfiguration(getDb(), articleId, typeIds, selections));
  ipcMain.handle("declinaisons:listVariantes", (_e, articleId, options) => declinaisonsApi.listVariantes(getDb(), articleId, options));
  ipcMain.handle("declinaisons:getVariante", (_e, id) => declinaisonsApi.getVariante(getDb(), id));
  ipcMain.handle("declinaisons:genererVariantes", (_e, articleId, selections) => declinaisonsApi.genererVariantes(getDb(), articleId, selections));
  ipcMain.handle("declinaisons:updateVariante", (_e, id, patch) => declinaisonsApi.updateVariante(getDb(), id, patch));
  ipcMain.handle("declinaisons:deleteVariante", (_e, id) => declinaisonsApi.deleteVariante(getDb(), id));

  // --- Grilles de tailles ---
  ipcMain.handle("grillesTailles:list", (_e, options) => grillesTaillesApi.listGrilles(getDb(), options));
  ipcMain.handle("grillesTailles:get", (_e, grilleId) => grillesTaillesApi.getGrille(getDb(), grilleId));
  ipcMain.handle("grillesTailles:creer", (_e, nom) => grillesTaillesApi.creerGrille(getDb(), nom));
  ipcMain.handle("grillesTailles:renommer", (_e, grilleId, nom) => grillesTaillesApi.renommerGrille(getDb(), grilleId, nom));
  ipcMain.handle("grillesTailles:setActive", (_e, grilleId, actif) => grillesTaillesApi.setGrilleActive(getDb(), grilleId, actif));
  ipcMain.handle("grillesTailles:supprimer", (_e, grilleId) => grillesTaillesApi.supprimerGrille(getDb(), grilleId));
  ipcMain.handle("grillesTailles:ajouterValeur", (_e, grilleId, valeur) => grillesTaillesApi.ajouterValeur(getDb(), grilleId, valeur));
  ipcMain.handle("grillesTailles:modifierValeur", (_e, grilleId, valeurId, valeur) => grillesTaillesApi.modifierValeur(getDb(), grilleId, valeurId, valeur));
  ipcMain.handle("grillesTailles:supprimerValeur", (_e, grilleId, valeurId) => grillesTaillesApi.supprimerValeur(getDb(), grilleId, valeurId));
  ipcMain.handle("grillesTailles:reordonnerValeurs", (_e, grilleId, orderedIds) => grillesTaillesApi.reordonnerValeurs(getDb(), grilleId, orderedIds));
  ipcMain.handle("grillesTailles:getPourProduit", (_e, produitId) => grillesTaillesApi.getGrillePourProduit(getDb(), produitId));
  ipcMain.handle("grillesTailles:setPourProduit", (_e, produitId, grilleId) => grillesTaillesApi.setGrillePourProduit(getDb(), produitId, grilleId));

  // --- Ratios de répartition (proportions par taille, réutilisables d'une commande à l'autre) ---
  ipcMain.handle("ratiosRepartition:listPourGrille", (_e, grilleId) => ratiosRepartitionApi.listPourGrille(getDb(), grilleId));
  ipcMain.handle("ratiosRepartition:enregistrer", (_e, payload) => ratiosRepartitionApi.enregistrer(getDb(), payload));
  ipcMain.handle("ratiosRepartition:supprimer", (_e, ratioId) => ratiosRepartitionApi.supprimer(getDb(), ratioId));

  // --- Approvisionnement : besoins et consommations (étape 1, LECTURE SEULE) ---
  // Le préfixe est volontairement "approvisionnement" et non "besoins" : un canal
  // "commandes:besoinsMatieres" existe déjà par ailleurs, et deux noms voisins pour deux calculs
  // différents seraient la meilleure façon d'appeler le mauvais un jour.
  // La liste des commandes passe toujours par "commandes:list", qui existe déjà. Le second canal
  // ci-dessous ne liste rien : il indique, pour des identifiants déjà obtenus, où en est
  // l'approvisionnement — ce que seul le moteur de besoins peut dire, et ce qui permet de trier et
  // de filtrer la liste sans ouvrir chaque commande.
  // Ces deux handlers n'écrivent rien. La simulation ne touche jamais la commande : elle se
  // contente de remplacer les quantités le temps d'un calcul.
  ipcMain.handle("approvisionnement:calculerBesoins", (_e, commandeId, options) =>
    besoinsApi.calculerPourCommande(getDb(), commandeId, options));
  ipcMain.handle("approvisionnement:etatsApprovisionnement", (_e, commandeIds) =>
    besoinsApi.etatsApprovisionnement(getDb(), commandeIds));

  // --- Bons de commande matières premières (MP1 : brouillons seulement) ---
  // Aucun de ces canaux n'écrit dans `achats` ni dans aucune table financière. La création des
  // engagements appartient à MP3 et sera livrée séparément.
  // Préparation : regroupement des besoins de plusieurs productions. LECTURE SEULE.
  ipcMain.handle("bcMp:regrouper", (_e, commandeIds) => preparationApi.regrouper(getDb(), commandeIds));
  ipcMain.handle("bcMp:creerLot", (_e, bons) => bcMpApi.creerLot(getDb(), bons));
  ipcMain.handle("bcMp:enregistrerPreparation", (_e, payload) => bcMpApi.enregistrerPreparation(getDb(), payload));
  ipcMain.handle("bcMp:creer", (_e, payload) => bcMpApi.creer(getDb(), payload));
  ipcMain.handle("bcMp:get", (_e, bonId) => bcMpApi.get(getDb(), bonId));
  ipcMain.handle("bcMp:list", (_e, filtres) => bcMpApi.list(getDb(), filtres));
  ipcMain.handle("bcMp:mettreAJour", (_e, bonId, patch) => bcMpApi.mettreAJour(getDb(), bonId, patch));
  ipcMain.handle("bcMp:supprimer", (_e, bonId) => bcMpApi.supprimer(getDb(), bonId));
  ipcMain.handle("bcMp:ajouterLigne", (_e, bonId, ligne) => bcMpApi.ajouterLigne(getDb(), bonId, ligne));
  ipcMain.handle("bcMp:mettreAJourLigne", (_e, ligneId, patch) => bcMpApi.mettreAJourLigne(getDb(), ligneId, patch));
  ipcMain.handle("bcMp:supprimerLigne", (_e, ligneId) => bcMpApi.supprimerLigne(getDb(), ligneId));

  // --- Fiche Technique Produit ---
  ipcMain.handle("ficheTechnique:pickCroquis", () => photosApi.pickImage(mainWindow, "Choisir un croquis technique"));
  ipcMain.handle("ficheTechnique:pickAccessoirePhoto", () => photosApi.pickImage(mainWindow, "Choisir une photo d'accessoire"));
  ipcMain.handle("ficheTechnique:getOrCreateByArticleId", (_e, articleId) => ficheTechniqueApi.getOrCreateByArticleId(getDb(), articleId));
  ipcMain.handle("ficheTechnique:get", (_e, ficheId) => ficheTechniqueApi.get(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:listAll", () => ficheTechniqueApi.listAll(getDb()));
  ipcMain.handle("ficheTechnique:updateNotes", (_e, ficheId, notes) => ficheTechniqueApi.updateNotes(getDb(), ficheId, notes));
  ipcMain.handle("ficheTechnique:updateDescriptionTechnique", (_e, ficheId, html) => ficheTechniqueApi.updateDescriptionTechnique(getDb(), ficheId, html));
  ipcMain.handle("ficheTechnique:updateCoupe", (_e, ficheId, coupeId) => ficheTechniqueApi.updateCoupe(getDb(), ficheId, coupeId));
  ipcMain.handle("ficheTechnique:validerFiche", (_e, ficheId) => ficheTechniqueApi.validerFiche(getDb(), ficheId));

  // --- Révisions : rouvrir une fiche validée sans toucher aux productions déjà décidées ---
  // L'aperçu est une LECTURE : il dit ce que la réouverture va protéger, avant de la lancer.
  // La réouverture, elle, est une transaction unique — tout ou rien (voir revisionsFiche.js).
  ipcMain.handle("ficheTechnique:apercuModification", (_e, ficheId) =>
    revisionsFicheApi.apercuModification(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:rouvrirPourModification", (_e, ficheId, options) =>
    revisionsFicheApi.rouvrirPourModification(getDb(), ficheId, options));
  ipcMain.handle("ficheTechnique:listRevisions", (_e, ficheId) =>
    revisionsFicheApi.listRevisions(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:getRevision", (_e, revisionId) =>
    revisionsFicheApi.getRevision(getDb(), revisionId));
  ipcMain.handle("ficheTechnique:archiverFiche", (_e, ficheId) => ficheTechniqueApi.archiverFiche(getDb(), ficheId));

  ipcMain.handle("ficheTechnique:addCroquis", (_e, ficheId, sourcePath, options) => ficheTechniqueApi.addCroquis(getDb(), ficheId, sourcePath, options));
  ipcMain.handle("ficheTechnique:updateCroquis", (_e, croquisId, patch) => ficheTechniqueApi.updateCroquis(getDb(), croquisId, patch));
  ipcMain.handle("ficheTechnique:deleteCroquis", (_e, croquisId) => ficheTechniqueApi.deleteCroquis(getDb(), croquisId));
  ipcMain.handle("ficheTechnique:reorderCroquis", (_e, ficheId, orderedIds) => ficheTechniqueApi.reorderCroquis(getDb(), ficheId, orderedIds));

  ipcMain.handle("ficheTechnique:addAnnotation", (_e, croquisId, payload) => ficheTechniqueApi.addAnnotation(getDb(), croquisId, payload));
  ipcMain.handle("ficheTechnique:updateAnnotation", (_e, annotationId, patch) => ficheTechniqueApi.updateAnnotation(getDb(), annotationId, patch));
  ipcMain.handle("ficheTechnique:deleteAnnotation", (_e, annotationId) => ficheTechniqueApi.deleteAnnotation(getDb(), annotationId));

  ipcMain.handle("ficheTechnique:searchMesuresCatalogue", (_e, query, limit) => ficheTechniqueApi.searchMesuresCatalogue(getDb(), query, limit));
  ipcMain.handle("ficheTechnique:addMesureLigne", (_e, ficheId, nom, options) => ficheTechniqueApi.addMesureLigne(getDb(), ficheId, nom, options));
  ipcMain.handle("ficheTechnique:updateMesureLigne", (_e, ficheId, mesureCatalogueId, patch) => ficheTechniqueApi.updateMesureLigne(getDb(), ficheId, mesureCatalogueId, patch));
  ipcMain.handle("ficheTechnique:removeMesureLigne", (_e, ficheId, mesureCatalogueId) => ficheTechniqueApi.removeMesureLigne(getDb(), ficheId, mesureCatalogueId));
  ipcMain.handle("ficheTechnique:reorderMesuresLignes", (_e, ficheId, orderedIds) => ficheTechniqueApi.reorderMesuresLignes(getDb(), ficheId, orderedIds));

  ipcMain.handle("ficheTechnique:searchTaillesCatalogue", (_e, query, limit) => ficheTechniqueApi.searchTaillesCatalogue(getDb(), query, limit));
  ipcMain.handle("ficheTechnique:addTaille", (_e, ficheId, nom) => ficheTechniqueApi.addTaille(getDb(), ficheId, nom));
  ipcMain.handle("ficheTechnique:tailleAValeurs", (_e, ftTailleId) => ficheTechniqueApi.tailleAValeurs(getDb(), ftTailleId));
  ipcMain.handle("ficheTechnique:removeTaille", (_e, ficheId, ftTailleId) => ficheTechniqueApi.removeTaille(getDb(), ficheId, ftTailleId));
  ipcMain.handle("ficheTechnique:reorderTailles", (_e, ficheId, orderedIds) => ficheTechniqueApi.reorderTailles(getDb(), ficheId, orderedIds));
  ipcMain.handle("ficheTechnique:confirmerTailles", (_e, ficheId) => ficheTechniqueApi.confirmerTailles(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:setValeur", (_e, ficheId, mesureCatalogueId, ftTailleId, valeur) => ficheTechniqueApi.setValeur(getDb(), ficheId, mesureCatalogueId, ftTailleId, valeur));
  ipcMain.handle("ficheTechnique:ensureMesuresGenerees", (_e, ficheId) => ficheTechniqueApi.ensureMesuresGenerees(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:getMesuresStatut", (_e, ficheId) => ficheTechniqueApi.getMesuresStatut(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:mesuresSuggerees", (_e, ficheId) => ficheTechniqueApi.mesuresSuggerees(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:mesuresManquantes", (_e, ficheId) => ficheTechniqueApi.mesuresManquantes(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:ajouterMesuresManquantes", (_e, ficheId, mesures) => ficheTechniqueApi.ajouterMesuresManquantes(getDb(), ficheId, mesures));
  ipcMain.handle("ficheTechnique:creerTableauMesures", (_e, ficheId, mesures) => ficheTechniqueApi.creerTableauMesures(getDb(), ficheId, mesures));
  ipcMain.handle("ficheTechnique:reinitialiserChoixMesures", (_e, ficheId) => ficheTechniqueApi.reinitialiserChoixMesures(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:taillesDisponibles", (_e, ficheId) => ficheTechniqueApi.taillesDisponibles(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:selectionnerTaille", (_e, ficheId, grilleValeurId) => ficheTechniqueApi.selectionnerTaille(getDb(), ficheId, grilleValeurId));
  ipcMain.handle("ficheTechnique:ajouterTailleExceptionnelle", (_e, ficheId, nom) => ficheTechniqueApi.ajouterTailleExceptionnelle(getDb(), ficheId, nom));
  ipcMain.handle("ficheTechnique:analyserChangementGrille", (_e, ficheId, grilleId) => ficheTechniqueApi.analyserChangementGrille(getDb(), ficheId, grilleId));
  ipcMain.handle("ficheTechnique:definirGrille", (_e, ficheId, grilleId, options) => ficheTechniqueApi.definirGrille(getDb(), ficheId, grilleId, options));
  ipcMain.handle("ficheTechnique:intervallesGradation", (_e, ficheId, mesureId) => ficheTechniqueApi.intervallesGradation(getDb(), ficheId, mesureId));
  ipcMain.handle("ficheTechnique:setGradation", (_e, ficheId, mesureId, departId, arriveeId, valeur) => ficheTechniqueApi.setGradation(getDb(), ficheId, mesureId, departId, arriveeId, valeur));
  ipcMain.handle("ficheTechnique:simulerGradation", (_e, ficheId, mesureId, refId) => ficheTechniqueApi.simulerGradation(getDb(), ficheId, mesureId, refId));
  ipcMain.handle("ficheTechnique:appliquerGradation", (_e, ficheId, mesureId, refId, mode) => ficheTechniqueApi.appliquerGradation(getDb(), ficheId, mesureId, refId, mode));
  ipcMain.handle("ficheTechnique:appliquerModele", (_e, ficheId, modeleId) => ficheTechniqueApi.appliquerModele(getDb(), ficheId, modeleId));
  ipcMain.handle("ficheTechnique:construireManuellement", (_e, ficheId) => ficheTechniqueApi.construireManuellement(getDb(), ficheId));

  // --- Modèles de tableaux de mesures (Paramètres) ---
  ipcMain.handle("modelesMesures:listProduitsAvecStatut", () => modelesMesuresApi.listProduitsAvecStatut(getDb()));
  ipcMain.handle("modelesMesures:listByProduitId", (_e, produitId, options) => modelesMesuresApi.listByProduitId(getDb(), produitId, options));
  ipcMain.handle("modelesMesures:getById", (_e, modeleId) => modelesMesuresApi.getById(getDb(), modeleId));
  ipcMain.handle("modelesMesures:create", (_e, produitId, nom) => modelesMesuresApi.create(getDb(), produitId, nom));
  ipcMain.handle("modelesMesures:dupliquer", (_e, modeleId, nouveauNom) => modelesMesuresApi.dupliquer(getDb(), modeleId, nouveauNom));
  ipcMain.handle("modelesMesures:updateNom", (_e, modeleId, nom) => modelesMesuresApi.updateNom(getDb(), modeleId, nom));
  ipcMain.handle("modelesMesures:setActif", (_e, modeleId, actif) => modelesMesuresApi.setActif(getDb(), modeleId, actif));
  ipcMain.handle("modelesMesures:deleteModele", (_e, modeleId) => modelesMesuresApi.deleteModele(getDb(), modeleId));
  ipcMain.handle("modelesMesures:addLigne", (_e, modeleId, nom, options) => modelesMesuresApi.addLigne(getDb(), modeleId, nom, options));
  ipcMain.handle("modelesMesures:updateLigne", (_e, modeleId, ligneId, patch) => modelesMesuresApi.updateLigne(getDb(), modeleId, ligneId, patch));
  ipcMain.handle("modelesMesures:removeLigne", (_e, modeleId, ligneId) => modelesMesuresApi.removeLigne(getDb(), modeleId, ligneId));
  ipcMain.handle("modelesMesures:reorderLignes", (_e, modeleId, orderedLigneIds) => modelesMesuresApi.reorderLignes(getDb(), modeleId, orderedLigneIds));
  ipcMain.handle("modelesMesures:listModelesStandards", () => modelesMesuresApi.listModelesStandards());
  ipcMain.handle("modelesMesures:chargerModeleStandard", (_e, modeleId, cle) => modelesMesuresApi.chargerModeleStandard(getDb(), modeleId, cle));
  ipcMain.handle("modelesMesures:listComplementsStandards", (_e, cleBase) => modelesMesuresApi.listComplementsStandards(cleBase));
  ipcMain.handle("modelesMesures:chargerComplementStandard", (_e, modeleId, cle) => modelesMesuresApi.chargerComplementStandard(getDb(), modeleId, cle));

  // --- Planification ---
  ipcMain.handle("planning:list", (_e, filtres) => planningApi.list(getDb(), filtres));
  ipcMain.handle("planning:get", (_e, id) => planningApi.get(getDb(), id));
  ipcMain.handle("planning:kpis", () => planningApi.kpis(getDb()));
  ipcMain.handle("planning:creer", (_e, payload) => planningApi.creer(getDb(), payload));
  ipcMain.handle("planning:mettreAJour", (_e, id, patch) => planningApi.mettreAJour(getDb(), id, patch));
  ipcMain.handle("planning:deplacer", (_e, id, champ, nouveauMois, orderedIds, forcer) => planningApi.deplacer(getDb(), id, champ, nouveauMois, orderedIds, forcer));
  ipcMain.handle("planning:reordonner", (_e, mois, orderedIds) => planningApi.reordonner(getDb(), mois, orderedIds));
  ipcMain.handle("planning:ajouterPhoto", (_e, id, sourcePath, forcer) => planningApi.ajouterPhoto(getDb(), id, sourcePath, forcer));
  ipcMain.handle("planning:retirerPhoto", (_e, id, forcer) => planningApi.retirerPhoto(getDb(), id, forcer));
  ipcMain.handle("planning:retirerDuPlanning", (_e, id) => planningApi.retirerDuPlanning(getDb(), id));
  ipcMain.handle("planning:supprimerProvisoire", (_e, id) => planningApi.supprimerProvisoire(getDb(), id));
  ipcMain.handle("planning:convertirEnProduit", (_e, id, payloadArticle) => planningApi.convertirEnProduit(getDb(), id, payloadArticle));

  // --- Finance ---
  ipcMain.handle("finance:creerFournisseur", (_e, payload) => financeApi.creerFournisseur(getDb(), payload));
  ipcMain.handle("finance:mettreAJourFournisseur", (_e, id, patch) => financeApi.mettreAJourFournisseur(getDb(), id, patch));
  ipcMain.handle("finance:listFournisseurs", (_e, options) => financeApi.listFournisseurs(getDb(), options));
  ipcMain.handle("finance:getFournisseur", (_e, id) => financeApi.getFournisseur(getDb(), id));

  ipcMain.handle("finance:ajouterPrixFournisseur", (_e, payload) => financeApi.ajouterPrixFournisseur(getDb(), payload));
  ipcMain.handle("finance:listPrixFournisseur", (_e, fournisseurId, options) => financeApi.listPrixFournisseur(getDb(), fournisseurId, options));
  ipcMain.handle("finance:prixEnVigueur", (_e, criteres) => financeApi.prixEnVigueur(getDb(), criteres));

  ipcMain.handle("finance:creerAchat", (_e, payload) => financeApi.creerAchat(getDb(), payload));
  ipcMain.handle("finance:getAchat", (_e, id) => financeApi.getAchat(getDb(), id));
  ipcMain.handle("finance:listAchats", (_e, filtres) => financeApi.listAchats(getDb(), filtres));

  ipcMain.handle("finance:ajouterReceptionAchat", (_e, achatId, payload) => financeApi.ajouterReceptionAchat(getDb(), achatId, payload));
  ipcMain.handle("finance:listReceptionsAchat", (_e, achatId) => financeApi.listReceptionsAchat(getDb(), achatId));

  ipcMain.handle("finance:ajouterFactureAchat", (_e, achatId, payload) => financeApi.ajouterFactureAchat(getDb(), achatId, payload));
  ipcMain.handle("finance:listFacturesAchat", (_e, achatId) => financeApi.listFacturesAchat(getDb(), achatId));
  ipcMain.handle("finance:getFacture", (_e, id) => financeApi.getFacture(getDb(), id));
  ipcMain.handle("finance:statutFacture", (_e, id) => financeApi.statutFacture(getDb(), id));

  ipcMain.handle("finance:coutAchat", (_e, achatId) => financeApi.coutAchat(getDb(), achatId));

  ipcMain.handle("finance:affecterAchat", (_e, payload) => financeApi.affecterAchat(getDb(), payload));
  ipcMain.handle("finance:quantiteDisponibleAchat", (_e, achatId) => financeApi.quantiteDisponibleAchat(getDb(), achatId));
  ipcMain.handle("finance:listAffectationsAchat", (_e, achatId) => financeApi.listAffectationsAchat(getDb(), achatId));
  ipcMain.handle("finance:coutAffectation", (_e, affectationId) => financeApi.coutAffectation(getDb(), affectationId));

  ipcMain.handle("finance:coutCommande", (_e, commandeId) => financeApi.coutCommande(getDb(), commandeId));
  ipcMain.handle("finance:syntheseCoutCommande", (_e, commandeId) => financeApi.syntheseCoutCommande(getDb(), commandeId));

  ipcMain.handle("finance:creerPaiement", (_e, payload) => financeApi.creerPaiement(getDb(), payload));
  ipcMain.handle("finance:listPaiementsFournisseur", (_e, fournisseurId) => financeApi.listPaiementsFournisseur(getDb(), fournisseurId));
  ipcMain.handle("finance:affecterPaiement", (_e, payload) => financeApi.affecterPaiement(getDb(), payload));
  ipcMain.handle("finance:creditNonAffecte", (_e, paiementId) => financeApi.creditNonAffecte(getDb(), paiementId));
  ipcMain.handle("finance:detteFournisseur", (_e, fournisseurId) => financeApi.detteFournisseur(getDb(), fournisseurId));

  ipcMain.handle("finance:ajouterEcheance", (_e, achatId, payload) => financeApi.ajouterEcheance(getDb(), achatId, payload));
  ipcMain.handle("finance:listEcheances", (_e, filtres) => financeApi.listEcheances(getDb(), filtres));
  ipcMain.handle("finance:calculerEcheanceSuggeree", (_e, dateFacture, delaiJours, delaiFinDeMois) => financeApi.calculerEcheanceSuggeree(dateFacture, delaiJours, delaiFinDeMois));
  ipcMain.handle("finance:listFacturesFournisseur", (_e, fournisseurId) => financeApi.listFacturesFournisseur(getDb(), fournisseurId));

  ipcMain.handle("finance:ajouterReceptionProduction", (_e, commandeId, payload) => financeApi.ajouterReceptionProduction(getDb(), commandeId, payload));
  ipcMain.handle("finance:enregistrerRetoucheReussie", (_e, receptionId, quantite) => financeApi.enregistrerRetoucheReussie(getDb(), receptionId, quantite));
  ipcMain.handle("finance:listReceptionsProduction", (_e, commandeId) => financeApi.listReceptionsProduction(getDb(), commandeId));
  ipcMain.handle("finance:quantiteCommercialisableCommande", (_e, commandeId) => financeApi.quantiteCommercialisableCommande(getDb(), commandeId));
  ipcMain.handle("finance:syntheseGlobale", () => financeApi.syntheseGlobale(getDb()));
  ipcMain.handle("finance:listEcheancesDetaillees", (_e, filtres) => financeApi.listEcheancesDetaillees(getDb(), filtres));
  ipcMain.handle("finance:listFournisseursAvecSynthese", (_e, options) => financeApi.listFournisseursAvecSynthese(getDb(), options));
  ipcMain.handle("finance:listAchatsDetailles", (_e, filtres) => financeApi.listAchatsDetailles(getDb(), filtres));
  ipcMain.handle("finance:listMatieresCatalogue", () => financeApi.listMatieresCatalogue(getDb()));
  ipcMain.handle("finance:trouverOuCreerMatiereCatalogue", (_e, nom, uniteDefaut) => financeApi.trouverOuCreerMatiereCatalogue(getDb(), nom, uniteDefaut));

  ipcMain.handle("finance:getOuCreerEstimation", (_e, articleId) => financeApi.getOuCreerEstimation(getDb(), articleId));
  ipcMain.handle("finance:mettreAJourEstimation", (_e, estimationId, patch) => financeApi.mettreAJourEstimation(getDb(), estimationId, patch));
  ipcMain.handle("finance:supprimerEstimation", (_e, estimationId) => financeApi.supprimerEstimation(getDb(), estimationId));
  ipcMain.handle("finance:ajouterLigneEstimation", (_e, estimationId, payload) => financeApi.ajouterLigneEstimation(getDb(), estimationId, payload));
  ipcMain.handle("finance:mettreAJourLigneEstimation", (_e, ligneId, patch) => financeApi.mettreAJourLigneEstimation(getDb(), ligneId, patch));
  ipcMain.handle("finance:supprimerLigneEstimation", (_e, ligneId) => financeApi.supprimerLigneEstimation(getDb(), ligneId));
  ipcMain.handle("finance:listLignesEstimation", (_e, estimationId) => financeApi.listLignesEstimation(getDb(), estimationId));
  ipcMain.handle("finance:syntheseEstimation", (_e, estimationId) => financeApi.syntheseEstimation(getDb(), estimationId));
  ipcMain.handle("finance:simulationPrix", (_e, coutUnitaireHt, params, quantiteCommercialisable) => financeApi.simulationPrix(coutUnitaireHt, params, quantiteCommercialisable));
  ipcMain.handle("finance:listEstimationsResume", () => financeApi.listEstimationsResume(getDb()));
  ipcMain.handle("finance:mettreAJourPrixVenteEnvisage", (_e, articleId, prix) => financeApi.mettreAJourPrixVenteEnvisage(getDb(), articleId, prix));
  ipcMain.handle("finance:stockDisponibleMatiere", (_e, matiereCatalogueId, couleur) => financeApi.stockDisponibleMatiere(getDb(), matiereCatalogueId, couleur));
  ipcMain.handle("finance:affecterConsommationMatiere", (_e, payload) => financeApi.affecterConsommationMatiere(getDb(), payload));
  ipcMain.handle("finance:syntheseStockMatiere", () => financeApi.syntheseStockMatiere(getDb()));
  ipcMain.handle("finance:comparaisonConsommationCommande", (_e, commandeId) => financeApi.comparaisonConsommationCommande(getDb(), commandeId));
  ipcMain.handle("finance:listFacturesAvecEcheances", (_e, filtres) => financeApi.listFacturesAvecEcheances(getDb(), filtres));
  ipcMain.handle("finance:listPaiementsEtAvances", () => financeApi.listPaiementsEtAvances(getDb()));
  ipcMain.handle("finance:listPostesCout", (_e, options) => financeApi.listPostesCout(getDb(), options));
  ipcMain.handle("finance:rechercherPostesCout", (_e, requete, limite, categorie) => financeApi.rechercherPostesCout(getDb(), requete, limite, categorie));
  ipcMain.handle("finance:creerPosteCout", (_e, payload) => financeApi.creerPosteCout(getDb(), payload));
  ipcMain.handle("finance:mettreAJourPosteCout", (_e, id, patch) => financeApi.mettreAJourPosteCout(getDb(), id, patch));
  ipcMain.handle("finance:supprimerPosteCout", (_e, id) => financeApi.supprimerPosteCout(getDb(), id));

  ipcMain.handle("ficheTechnique:searchAccessoiresCatalogue", (_e, query, limit, famille) => ficheTechniqueApi.searchAccessoiresCatalogue(getDb(), query, limit, famille));
  ipcMain.handle("ficheTechnique:addAccessoire", (_e, ficheId, payload) => ficheTechniqueApi.addAccessoire(getDb(), ficheId, payload));
  ipcMain.handle("ficheTechnique:updateAccessoire", (_e, accessoireId, patch) => ficheTechniqueApi.updateAccessoire(getDb(), accessoireId, patch));
  ipcMain.handle("ficheTechnique:setAccessoirePhoto", (_e, accessoireId, sourcePath) => ficheTechniqueApi.setAccessoirePhoto(getDb(), accessoireId, sourcePath));
  ipcMain.handle("ficheTechnique:deleteAccessoire", (_e, accessoireId) => ficheTechniqueApi.deleteAccessoire(getDb(), accessoireId));
  ipcMain.handle("ficheTechnique:reorderAccessoires", (_e, ficheId, orderedIds) => ficheTechniqueApi.reorderAccessoires(getDb(), ficheId, orderedIds));
  ipcMain.handle("ficheTechnique:listFournitureCouleurs", (_e, ftAccessoireId) => ficheTechniqueApi.listFournitureCouleurs(getDb(), ftAccessoireId));
  ipcMain.handle("ficheTechnique:addFournitureCouleur", (_e, ftAccessoireId, payload) => ficheTechniqueApi.addFournitureCouleur(getDb(), ftAccessoireId, payload));
  ipcMain.handle("ficheTechnique:updateFournitureCouleur", (_e, id, patch) => ficheTechniqueApi.updateFournitureCouleur(getDb(), id, patch));
  ipcMain.handle("ficheTechnique:deleteFournitureCouleur", (_e, id) => ficheTechniqueApi.deleteFournitureCouleur(getDb(), id));

  ipcMain.handle("ficheTechnique:searchMatieresCatalogue", (_e, query, limit) => ficheTechniqueApi.searchMatieresCatalogue(getDb(), query, limit));
  ipcMain.handle("ficheTechnique:listMatiereCouleurs", (_e, matiereCatalogueId) => ficheTechniqueApi.listMatiereCouleurs(getDb(), matiereCatalogueId));
  ipcMain.handle("ficheTechnique:createMatiereCouleur", (_e, matiereCatalogueId, payload) => ficheTechniqueApi.createMatiereCouleur(getDb(), matiereCatalogueId, payload));
  ipcMain.handle("ficheTechnique:addMatiere", (_e, ficheId, payload) => ficheTechniqueApi.addMatiere(getDb(), ficheId, payload));
  ipcMain.handle("ficheTechnique:updateMatiere", (_e, ftMatiereId, patch) => ficheTechniqueApi.updateMatiere(getDb(), ftMatiereId, patch));
  ipcMain.handle("ficheTechnique:deleteMatiere", (_e, ftMatiereId) => ficheTechniqueApi.deleteMatiere(getDb(), ftMatiereId));
  ipcMain.handle("ficheTechnique:reorderMatieres", (_e, ficheId, orderedIds) => ficheTechniqueApi.reorderMatieres(getDb(), ficheId, orderedIds));
  ipcMain.handle("ficheTechnique:listMatieres", (_e, ficheId) => ficheTechniqueApi.listMatieres(getDb(), ficheId));
  ipcMain.handle("ficheTechnique:addMatiereCouleur", (_e, ftMatiereId, payload) => ficheTechniqueApi.addMatiereCouleur(getDb(), ftMatiereId, payload));
  ipcMain.handle("ficheTechnique:updateMatiereCouleur", (_e, ftMatiereCouleurId, patch) => ficheTechniqueApi.updateMatiereCouleur(getDb(), ftMatiereCouleurId, patch));
  ipcMain.handle("ficheTechnique:deleteMatiereCouleur", (_e, ftMatiereCouleurId) => ficheTechniqueApi.deleteMatiereCouleur(getDb(), ftMatiereCouleurId));
  ipcMain.handle("ficheTechnique:setConsommationTaille", (_e, ftMatiereId, ftTailleId, valeur) => ficheTechniqueApi.setConsommationTaille(getDb(), ftMatiereId, ftTailleId, valeur));
  ipcMain.handle("ficheTechnique:listConsommationsTaille", (_e, ftMatiereId) => ficheTechniqueApi.listConsommationsTaille(getDb(), ftMatiereId));

  // PDF de la fiche technique. Même principe que le bon de commande : le document est construit
  // dans une fenêtre dédiée (voir ficheTechniquePdf.js), jamais capturé depuis l'écran — la
  // pagination ne dépend donc ni de la taille de la fenêtre ni de l'onglet affiché.
  ipcMain.handle("ficheTechnique:telechargerPdf", async (_e, ficheId, suggestedName) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: "Enregistrer la fiche technique en PDF",
      defaultPath: suggestedName || "fiche-technique.pdf",
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (canceled || !filePath) return { canceled: true };

    const db = getDb();
    const fiche = ficheTechniqueApi.get(db, ficheId);
    if (!fiche) throw new Error("Fiche technique introuvable.");
    const article = articlesApi.get(db, fiche.article_id);
    if (!article) throw new Error("Article introuvable.");
    const entreprise = entrepriseApi.get(db);

    const html = ficheTechniquePdfApi.buildFicheTechniqueHtml(fiche, article, entreprise);
    await ficheTechniquePdfApi.genererPdfDepuisFenetreDediee(html, filePath);

    return { canceled: false, filePath };
  });
  // Lancer un BC est une action manuelle distincte : elle marque le document comme lancé, PUIS
  // propose de faire passer la commande ERP en production si ce n'est pas déjà le cas — jamais
  // l'inverse (le passage en production de la commande ne lance jamais un BC automatiquement).
  ipcMain.handle("bcPf:lancer", (_e, id) => {
    const db = getDb();
    const bc = bcPfApi.lancerBcPf(db, id);
    try {
      const commande = commandesApi.get(db, bc.commande_id);
      if (commande && commande.statut === "validee") {
        commandesApi.lancerProduction(db, bc.commande_id);
      }
    } catch (err) {
      console.error("BC lancé, mais le passage automatique de la commande en production a échoué :", err);
    }
    return bcPfApi.get(db, id);
  });

  // --- Système : sauvegarde / restauration / export / démonstration ---
  // La sauvegarde est COMPLÈTE depuis le lot 2 : base, toutes les images, documents et
  // paramètres, avec manifeste et vérification. Voir electron/ipc/sauvegarde.js.
  ipcMain.handle("system:backup", (_e, options) => systemApi.backup(getDb(), mainWindow, options));
  ipcMain.handle("system:backupAvantOperation", (_e, motif) => systemApi.backupAvantOperation(getDb(), motif));
  ipcMain.handle("system:verifierSauvegarde", (_e, dossier) => systemApi.verifierSauvegarde(mainWindow, dossier));
  ipcMain.handle("system:essaiRestauration", (_e, source, cible) => systemApi.essaiRestauration(mainWindow, source, cible));
  ipcMain.handle("system:listerSauvegardes", (_e, dossier) => systemApi.listerSauvegardes(mainWindow, dossier));
  ipcMain.handle("system:dossierExterne", () => ({ dossier: systemApi.lireDossierExterne(getDb()) }));
  ipcMain.handle("system:choisirDossierExterne", async () => {
    const d = await systemApi.choisirDossier(mainWindow, "Choisir l'emplacement de vos sauvegardes complètes");
    if (!d) return { canceled: true };
    return Object.assign({ canceled: false }, systemApi.definirDossierExterne(getDb(), d));
  });
  ipcMain.handle("system:oublierDossierExterne", () => systemApi.definirDossierExterne(getDb(), null));
  ipcMain.handle("system:restore", (_e, options) =>
    systemApi.restore(mainWindow, { getDbPath, closeDatabase, openDatabase }, options)
  );
  ipcMain.handle("system:exportFile", (_e, format) => systemApi.exportFile(getDb(), mainWindow, format));
  ipcMain.handle("system:loadDemoData", () => systemApi.loadDemoData(getDb()));
  ipcMain.handle("system:clearDemoData", () => systemApi.clearDemoData(getDb()));
}

app.whenReady().then(() => {
  // Seconde instance : le verrou a déjà affiché son message et demandé la fermeture. On ne touche
  // à rien — surtout pas à la base, que l'autre instance est en train d'utiliser.
  if (!instanceUnique) return;

  // Le SECOND garde, indépendant du verrou système, et vérifié AVANT d'ouvrir la base : il vit
  // dans le dossier de données partagé, donc il couvre les deux versions quoi qu'il arrive.
  // Il ne bloque que si le processus inscrit est réellement vivant — une marque laissée par une
  // application coupée ne bloque rien.
  const occupation = verrouInstance.verifierOccupation(app.getPath("userData"));
  if (occupation.occupe) {
    dialog.showErrorBox("Belvie ERP est déjà ouvert",
      verrouInstance.messageOccupe(occupation.occupant, app.getPath("userData")));
    app.quit();
    return;
  }

  // 7. Les handlers IPC et l'interface ne démarrent qu'après une initialisation
  //    complète et réussie de la base (tables + migration + vérification + index).
  try {
    openDatabase();
  } catch (err) {
    console.error("Échec de l'initialisation de la base de données :", err);
    dialog.showErrorBox(
      "Belvie ERP — Erreur au démarrage",
      "Impossible d'initialiser la base de données locale.\n\n" +
        (err && err.message ? err.message : String(err)) +
        "\n\nLe fichier de données n'a pas été modifié ni supprimé. " +
        "Fermez l'application et contactez le support avant de relancer si le problème persiste."
    );
    app.quit();
    return;
  }

  // La marque d'instance est posée APRÈS l'ouverture de la base : tant que la base n'est pas
  // ouverte, il n'y a rien à protéger.
  const marque = verrouInstance.poser(app.getPath("userData"), {
    mode: app.isPackaged ? "installee" : "developpement",
    version: app.getVersion(),
    executable: process.execPath,
  });
  if (marque.precedent_perime) {
    console.log("[instance] La fermeture precedente ne s'est pas faite proprement (marque laissee "
      + "par le processus " + (marque.precedent && marque.precedent.pid) + "). Sans consequence.");
  }

  // Deux dossiers de données ? On CONSTATE, on affiche, et on ne touche à rien.
  try {
    const analyse = dossierDonnees.analyser(app.getPath("appData"), systemApi.ouvrirBaseLecture);
    if (analyse.conflit) {
      console.log("[donnees] Second dossier de donnees detecte : "
        + analyse.autres_avec_donnees.map((d) => d.dossier).join(", "));
      dialog.showMessageBoxSync(mainWindow, {
        type: analyse.inversion ? "warning" : "info",
        title: "Belvie ERP — deux dossiers de données",
        message: "Deux dossiers de données ont été trouvés",
        detail: dossierDonnees.messageConflit(analyse),
        buttons: ["J'ai compris"],
      });
    }
  } catch (err) {
    // Un constat raté ne doit jamais empêcher l'application de s'ouvrir.
    console.error("[donnees] Verification des dossiers impossible :", err && err.message);
  }

  registerMediaProtocol();
  registerIpcHandlers();
  createWindow();
  installerGardeFermeture();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ------------------------------------------------------------------------------------------------
// Protection contre la perte de saisie à la fermeture
// ------------------------------------------------------------------------------------------------
// Le renderer pousse en continu le nombre de modifications non encore enregistrées (cellules du
// tableau de mesures en cours de frappe ou d'écriture). Un simple compteur poussé, plutôt qu'une
// interrogation au moment de fermer : pas d'aller-retour à faire dans l'urgence, pas de course.
let modificationsEnAttente = 0;
// Passe à true une fois que l'utilisateur a tranché : évite de reposer la question en boucle,
// la fermeture relançant l'événement "close".
let fermetureAutorisee = false;

ipcMain.on("app:setModificationsEnAttente", (_e, n) => {
  modificationsEnAttente = Number(n) || 0;
});

// Tente d'enregistrer ce qui reste, puis répond. Le renderer se contente de retirer le focus de la
// cellule active, ce qui déclenche son onBlur donc sa sauvegarde — exactement le chemin normal,
// aucun code d'écriture parallèle.
function demanderEnregistrementAvantFermeture(fenetre) {
  return new Promise((resolve) => {
    let repondu = false;
    const fini = (restant) => { if (!repondu) { repondu = true; resolve(restant); } };
    ipcMain.once("app:pretAFermer", (_e, restant) => fini(Number(restant) || 0));
    fenetre.webContents.send("app:enregistrerAvantFermeture");
    // Si le renderer ne répond pas (page bloquée, erreur JS), on n'attend pas indéfiniment :
    // mieux vaut poser la question à l'utilisateur que de figer la fermeture sans explication.
    setTimeout(() => fini(modificationsEnAttente), 2500);
  });
}

function installerGardeFermeture() {
  if (!mainWindow) return;
  mainWindow.on("close", async (event) => {
    if (fermetureAutorisee || modificationsEnAttente === 0) return; // fermeture normale
    event.preventDefault();

    // 1) On tente d'abord d'enregistrer : dans l'immense majorité des cas, il s'agit simplement
    //    d'une cellule encore active dont la saisie n'a pas été validée. Rien à demander.
    const restant = await demanderEnregistrementAvantFermeture(mainWindow);
    if (restant === 0) {
      fermetureAutorisee = true;
      mainWindow.close();
      return;
    }

    // 2) Il reste des modifications non enregistrées (écriture en échec, fiche verrouillée...).
    //    On ne ferme jamais en silence, et on ne bloque jamais sans explication.
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: "warning",
      buttons: ["Annuler", "Fermer sans enregistrer"],
      defaultId: 0,
      cancelId: 0,
      title: "Modifications non enregistrées",
      message: restant === 1
        ? "Une modification n'a pas pu être enregistrée."
        : `${restant} modifications n'ont pas pu être enregistrées.`,
      detail: "Elles seront perdues si vous fermez maintenant. Annulez pour revenir à la fiche et corriger le problème signalé en rouge.",
    });

    if (response === 1) {
      fermetureAutorisee = true;
      mainWindow.close();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// Sauvegarde automatique locale à la fermeture (5 dernières conservées, voir electron/ipc/system.js).
// La sauvegarde manuelle depuis Paramètres reste disponible en plus de celle-ci.
let quitting = false;
app.on("before-quit", async (event) => {
  if (quitting) return;
  event.preventDefault();
  quitting = true;
  try {
    await systemApi.autoBackup(getDb());
  } catch (err) {
    console.error("Échec de la sauvegarde automatique :", err);
  } finally {
    // La marque d'instance est retirée en dernier, et seulement si c'est la nôtre.
    try { verrouInstance.liberer(app.getPath("userData")); } catch (_) { /* sans conséquence */ }
    app.quit();
  }
});
