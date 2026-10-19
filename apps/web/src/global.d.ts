import type { BonMp, BonMpResume, Regroupement } from "./modules/approvisionnement/approvisionnementTypes";
import type { Article, ArticleDeclinaisonType, ArticlePayload, ArticlePhoto, ArticleVariante, BcPf, BcPfPayload, Commande, CommandePayload, DeclinaisonType, DeclinaisonValeur, Entreprise, EntreprisePayload, EtatWizardEntreprise, Etape, FicheTechnique, FTAccessoire, FTAnnotation, FTCroquis, FTFournitureCouleur, FTGrille, FTMatiere, FTMatiereCouleur, MatiereCatalogue, MatiereCouleur, GrilleTaille, ImpactConfigurationDeclinaisons, ListeType, ListeValeur, MesureCatalogue, AccessoireCatalogue, TailleCatalogue, MesuresStatut, ModeleMesures, ModeleMesuresProduitStatut, ModeleStandard, PlanningArticle, PlanningArticlePayload, PlanningKpis, ResultatGenerationVariantes,
  Fournisseur, FournisseurAvecSynthese, PrixFournisseur, Achat, AchatDetaille, AchatReception, AchatFacture, AchatAffectation,
  Echeance, EcheanceDetaillee, Paiement, PaiementAffectation, StatutFactureResultat, CoutAchatResultat, CoutCommandeResultat,
  SyntheseCoutCommande, DetteFournisseur, SyntheseGlobaleFinance, ReceptionProduction, FactureFournisseurDetaillee, MatiereCatalogue,
  Estimation, EstimationLigne, SyntheseEstimation, SimulationPrixResultat, EstimationResume,
  PaiementDetaille, FactureAvecEcheance, PosteCoutPredefini, CategorieEstimation,
  StockMatiere, StockMatiereResume, ResultatConsommationMatiere, ComparaisonConsommationLigne } from "./shared/types";

export interface CompleterReferencePayload {
  saison_id: number;
  annee_collection: number;
  rayon_id: number;
  abreviation: string;
}

export interface BelvieApi {
  commandes: {
    list: () => Promise<Commande[]>;
    get: (id: number) => Promise<Commande>;
    create: (payload: CommandePayload) => Promise<Commande>;
    update: (id: number, payload: Partial<CommandePayload>) => Promise<Commande>;
    remove: (id: number) => Promise<{ id: number; deleted: boolean }>;
    valider: (id: number) => Promise<Commande>;
    lancerProduction: (id: number) => Promise<Commande>;
    entrerEnControleQualite: (id: number) => Promise<Commande>;
    terminerProduction: (id: number) => Promise<Commande>;
    annuler: (id: number, motif: string) => Promise<Commande>;
    bloquer: (id: number, motif: string) => Promise<Commande>;
    debloquer: (id: number) => Promise<Commande>;
    archiver: (id: number) => Promise<Commande>;
    desarchiver: (id: number) => Promise<Commande>;
  };
  articles: {
    list: (opts?: { includeIncomplete?: boolean }) => Promise<Article[]>;
    get: (id: number) => Promise<Article>;
    create: (payload: ArticlePayload) => Promise<Article>;
    completerReference: (id: number, payload: CompleterReferencePayload) => Promise<Article>;
    ajouterPhoto: (articleId: number, sourcePath: string) => Promise<ArticlePhoto>;
    definirPhotoPrincipale: (photoId: number) => Promise<ArticlePhoto[]>;
    retirerPhoto: (photoId: number) => Promise<ArticlePhoto[]>;
  };
  etapes: {
    list: (opts?: { includeInactive?: boolean }) => Promise<Etape[]>;
    update: (id: number, payload: { libelle?: string; ordre?: number; optionnelle?: boolean; actif?: boolean }) => Promise<Etape>;
    create: (payload: { libelle: string; ordre?: number; optionnelle?: boolean }) => Promise<Etape>;
  };
  listes: {
    list: (type: ListeType, opts?: { includeInactive?: boolean }) => Promise<ListeValeur[]>;
    create: (type: ListeType, nom: string, opts?: { code?: string; ordre?: number }) => Promise<ListeValeur>;
    update: (id: number, patch: { nom?: string; code?: string; actif?: boolean; ordre?: number; responsable_nom?: string | null }) => Promise<ListeValeur>;
  };
  parametres: {
    getOperateurActif: () => Promise<ListeValeur | null>;
    setOperateurActif: (operateurId: number | null) => Promise<ListeValeur | null>;
  };
  photos: {
    pick: () => Promise<
      | { canceled: true }
      | { canceled: false; error: string }
      | { canceled: false; filePath: string; fileName: string; sizeBytes: number; dataUrl: string }
    >;
  };
  entreprise: {
    get: () => Promise<Entreprise | null>;
    save: (payload: EntreprisePayload) => Promise<Entreprise>;
    pickLogo: () => Promise<
      | { canceled: true }
      | { canceled: false; error: string }
      | { canceled: false; filePath: string; fileName: string; sizeBytes: number; dataUrl: string }
    >;
    setLogo: (sourcePath: string) => Promise<Entreprise>;
    removeLogo: () => Promise<Entreprise>;
    getEtatWizard: () => Promise<EtatWizardEntreprise>;
    setEtatWizard: (etat: "postponed" | "completed") => Promise<string>;
  };
  bcPf: {
    getByCommandeId: (commandeId: number) => Promise<BcPf | null>;
    listForCommande: (commandeId: number) => Promise<BcPf[]>;
    get: (id: number) => Promise<BcPf | null>;
    creer: (commandeId: number) => Promise<BcPf>;
    update: (id: number, patch: BcPfPayload) => Promise<BcPf>;
    mettreAJourDepuisCommande: (id: number) => Promise<BcPf>;
    valider: (id: number) => Promise<BcPf>;
    lancer: (id: number) => Promise<BcPf>;
    remplacer: (id: number, motif: string) => Promise<BcPf>;
    telechargerPdf: (id: number, suggestedName?: string) => Promise<{ canceled: true } | { canceled: false; filePath: string }>;
  };
  declinaisons: {
    listTypes: (options?: { includeInactive?: boolean }) => Promise<DeclinaisonType[]>;
    createType: (nom: string, options?: { affichage_couleur?: boolean }) => Promise<DeclinaisonType>;
    updateType: (id: number, patch: Partial<{ nom: string; affichage_couleur: boolean; actif: boolean }>) => Promise<DeclinaisonType>;
    reorderTypes: (orderedIds: number[]) => Promise<DeclinaisonType[]>;
    listValeurs: (typeId: number, options?: { includeInactive?: boolean }) => Promise<DeclinaisonValeur[]>;
    createValeur: (typeId: number, valeur: string, options?: { couleur_hex?: string }) => Promise<DeclinaisonValeur>;
    updateValeur: (id: number, patch: Partial<{ valeur: string; couleur_hex: string | null; actif: boolean }>) => Promise<DeclinaisonValeur>;
    reorderValeurs: (typeId: number, orderedIds: number[]) => Promise<DeclinaisonValeur[]>;
    getArticleTypes: (articleId: number) => Promise<ArticleDeclinaisonType[]>;
    getArticleValeurs: (articleId: number) => Promise<Array<{ declinaison_type_id: number; declinaison_valeur_id: number; valeur: string; couleur_hex: string | null; ordre: number }>>;
    setArticleTypes: (articleId: number, typeIds: number[]) => Promise<ArticleDeclinaisonType[]>;
    articleHasVariantes: (articleId: number) => Promise<boolean>;
    previsualiserImpact: (articleId: number, selections: Record<number, number[]>) => Promise<ImpactConfigurationDeclinaisons>;
    appliquerConfiguration: (articleId: number, typeIds: number[], selections: Record<number, number[]>) => Promise<{ types: ArticleDeclinaisonType[]; valeurs: any[]; impact: ImpactConfigurationDeclinaisons }>;
    listVariantes: (articleId: number, options?: { includeInactive?: boolean }) => Promise<ArticleVariante[]>;
    getVariante: (id: number) => Promise<ArticleVariante | null>;
    genererVariantes: (articleId: number, selections: Record<number, number[]>) => Promise<ResultatGenerationVariantes>;
    updateVariante: (id: number, patch: Partial<{ sku: string; code_barres: string; reference_interne: string; actif: boolean }>) => Promise<ArticleVariante>;
    deleteVariante: (id: number) => Promise<{ deleted: boolean }>;
  };
  grillesTailles: {
    list: (options?: { activesSeulement?: boolean }) => Promise<GrilleTaille[]>;
    get: (grilleId: number) => Promise<GrilleTaille | null>;
    creer: (nom: string) => Promise<GrilleTaille>;
    renommer: (grilleId: number, nom: string) => Promise<GrilleTaille>;
    setActive: (grilleId: number, actif: boolean) => Promise<GrilleTaille>;
    supprimer: (grilleId: number) => Promise<{ deleted: boolean }>;
    ajouterValeur: (grilleId: number, valeur: string) => Promise<GrilleTaille>;
    modifierValeur: (grilleId: number, valeurId: number, valeur: string) => Promise<GrilleTaille>;
    supprimerValeur: (grilleId: number, valeurId: number) => Promise<GrilleTaille>;
    reordonnerValeurs: (grilleId: number, orderedIds: number[]) => Promise<GrilleTaille>;
    getPourProduit: (produitId: number) => Promise<GrilleTaille | null>;
    setPourProduit: (produitId: number, grilleId: number | null) => Promise<GrilleTaille | null>;
  };
  ficheTechnique: {
    pickCroquis: () => Promise<{ canceled: true } | { canceled: false; filePath: string; fileName: string; dataUrl: string } | { canceled: false; error: string }>;
    pickAccessoirePhoto: () => Promise<{ canceled: true } | { canceled: false; filePath: string; fileName: string; dataUrl: string } | { canceled: false; error: string }>;
    getOrCreateByArticleId: (articleId: number) => Promise<FicheTechnique>;
    get: (ficheId: number) => Promise<FicheTechnique | null>;
    listAll: () => Promise<FicheTechnique[]>;
    updateNotes: (ficheId: number, notes: string | null) => Promise<FicheTechnique>;
    updateCoupe: (ficheId: number, coupeId: number | null) => Promise<FicheTechnique>;
    validerFiche: (ficheId: number) => Promise<FicheTechnique>;
    // --- Révisions : rouvrir une fiche validée sans toucher aux productions déjà décidées ---
    /** Lecture seule : annonce ce que la réouverture protégera, avant de la lancer. */
    apercuModification: (ficheId: number) => Promise<{
      fiche_id: number;
      statut: string;
      revision: number;
      modifiable: boolean;
      productions_a_proteger: { id: number; numero: string | null; statut: string }[];
      productions_deja_protegees: number;
    }>;
    /** Transaction unique : archive, fige les productions en cours, repasse la fiche en brouillon. */
    rouvrirPourModification: (ficheId: number, options?: { motif?: string | null }) => Promise<{
      fiche_id: number;
      revision_archivee: number;
      productions_protegees: { id: number; numero: string | null; statut: string }[];
    }>;
    listRevisions: (ficheId: number) => Promise<{
      id: number; revision: number; motif: string | null;
      validated_at: string | null; archivee_le: string;
      taille_octets: number; productions_figees: number;
    }[]>;
    getRevision: (revisionId: number) => Promise<any>;
    archiverFiche: (ficheId: number) => Promise<FicheTechnique>;
    addCroquis: (ficheId: number, sourcePath: string, options?: { vue?: string; vue_personnalisee?: string; legende?: string }) => Promise<FTCroquis>;
    updateCroquis: (croquisId: number, patch: Partial<{ vue: string; vue_personnalisee: string; legende: string }>) => Promise<FTCroquis>;
    deleteCroquis: (croquisId: number) => Promise<{ deleted: boolean }>;
    reorderCroquis: (ficheId: number, orderedIds: number[]) => Promise<FTCroquis[]>;
    addAnnotation: (croquisId: number, payload: Partial<FTAnnotation> & { ancre_x: number; ancre_y: number; label_x: number; label_y: number; texte: string }) => Promise<FTAnnotation>;
    updateAnnotation: (annotationId: number, patch: Partial<FTAnnotation>) => Promise<FTAnnotation>;
    deleteAnnotation: (annotationId: number) => Promise<{ deleted: boolean }>;
    searchMesuresCatalogue: (query: string, limit?: number) => Promise<MesureCatalogue[]>;
    addMesureLigne: (ficheId: number, nom: string, options?: Partial<{ repere: string; unite: string; tolerance_plus: string; tolerance_moins: string; commentaire: string }>) => Promise<FTGrille>;
    updateMesureLigne: (ficheId: number, mesureCatalogueId: number, patch: Partial<{ repere: string; unite: string; tolerance_plus: string; tolerance_moins: string; commentaire: string }>) => Promise<FTGrille>;
    removeMesureLigne: (ficheId: number, mesureCatalogueId: number) => Promise<FTGrille>;
    reorderMesuresLignes: (ficheId: number, orderedIds: number[]) => Promise<FTGrille>;
    searchTaillesCatalogue: (query: string, limit?: number) => Promise<TailleCatalogue[]>;
    addTaille: (ficheId: number, nom: string) => Promise<FTGrille>;
    tailleAValeurs: (ftTailleId: number) => Promise<boolean>;
    removeTaille: (ficheId: number, ftTailleId: number) => Promise<FTGrille>;
    reorderTailles: (ficheId: number, orderedIds: number[]) => Promise<FTGrille>;
    confirmerTailles: (ficheId: number) => Promise<MesuresStatut>;
    setValeur: (ficheId: number, mesureCatalogueId: number, ftTailleId: number, valeur: string | null) => Promise<FTGrille>;
    ensureMesuresGenerees: (ficheId: number) => Promise<MesuresStatut>;
    getMesuresStatut: (ficheId: number) => Promise<MesuresStatut>;
    appliquerModele: (ficheId: number, modeleId: number) => Promise<MesuresStatut>;
    construireManuellement: (ficheId: number) => Promise<MesuresStatut>;
    // Le troisième argument filtre par famille (habillage | composant) : le handler et le preload
    // l'acceptaient déjà, la déclaration ne le disait pas.
    searchAccessoiresCatalogue: (query: string, limit?: number, famille?: string) => Promise<AccessoireCatalogue[]>;
    addAccessoire: (ficheId: number, payload: Partial<FTAccessoire> & { nom: string }) => Promise<FTAccessoire>;
    updateAccessoire: (accessoireId: number, patch: Partial<FTAccessoire>) => Promise<FTAccessoire>;
    setAccessoirePhoto: (accessoireId: number, sourcePath: string) => Promise<FTAccessoire>;
    deleteAccessoire: (accessoireId: number) => Promise<{ deleted: boolean }>;
    reorderAccessoires: (ficheId: number, orderedIds: number[]) => Promise<FTAccessoire[]>;
    // --- Coloris des fournitures : une fourniture déclinée par couleur produit ---
    // Le payload n'autorise pas couleur_produit_nom : c'est une valeur jointe, en lecture seule.
    listFournitureCouleurs: (ftAccessoireId: number) => Promise<FTFournitureCouleur[]>;
    addFournitureCouleur: (
      ftAccessoireId: number,
      payload: { couleur_produit_id: number; couleur_fourniture?: string | null; reference?: string | null; consommation_par_piece?: number | string | null }
    ) => Promise<FTFournitureCouleur>;
    updateFournitureCouleur: (
      id: number,
      patch: { couleur_produit_id?: number; couleur_fourniture?: string | null; reference?: string | null; consommation_par_piece?: number | string | null }
    ) => Promise<FTFournitureCouleur>;
    deleteFournitureCouleur: (id: number) => Promise<{ deleted: boolean }>;
    // --- Matières de la fiche : l'API existait et fonctionnait, elle n'était simplement pas
    // déclarée ici. Douze erreurs de type dans FTMatieresTab venaient de cet oubli. Aucune
    // signature n'est inventée : chacune reprend celle du preload et du handler.
    searchMatieresCatalogue: (query: string, limit?: number) => Promise<MatiereCatalogue[]>;
    listMatiereCouleurs: (matiereCatalogueId: number) => Promise<MatiereCouleur[]>;
    createMatiereCouleur: (
      matiereCatalogueId: number,
      payload: { libelle: string; code?: string | null; reference?: string | null }
    ) => Promise<MatiereCouleur>;
    addMatiere: (ficheId: number, payload: Partial<FTMatiere> & { nom: string }) => Promise<FTMatiere>;
    updateMatiere: (ftMatiereId: number, patch: Partial<FTMatiere>) => Promise<FTMatiere>;
    deleteMatiere: (ftMatiereId: number) => Promise<{ deleted: boolean }>;
    reorderMatieres: (ficheId: number, orderedIds: number[]) => Promise<FTMatiere[]>;
    listMatieres: (ficheId: number) => Promise<FTMatiere[]>;
    addMatiereCouleur: (
      ftMatiereId: number,
      payload: { couleur_produit_id: number; matiere_couleur_id?: number | null }
    ) => Promise<FTMatiereCouleur>;
    updateMatiereCouleur: (
      ftMatiereCouleurId: number,
      patch: { couleur_produit_id?: number; matiere_couleur_id?: number | null }
    ) => Promise<FTMatiereCouleur>;
    deleteMatiereCouleur: (ftMatiereCouleurId: number) => Promise<{ deleted: boolean }>;
    setConsommationTaille: (ftMatiereId: number, ftTailleId: number, valeur: string | number | null) => Promise<any[]>;
    listConsommationsTaille: (ftMatiereId: number) => Promise<any[]>;
  };
  // --- Approvisionnement : besoins, et bons de commande matieres (MP1 + MP2) ---
  approvisionnement: {
    calculerBesoins: (commandeId: number, options?: { lignes_simulees?: any[] }) => Promise<any>;
    etatsApprovisionnement: (commandeIds: number[]) => Promise<any[]>;
  };
  bcMp: {
    /** Regroupe les besoins de plusieurs productions. LECTURE SEULE : rien n'est enregistre. */
    regrouper: (commandeIds: number[]) => Promise<Regroupement>;
    /** Plusieurs bons, un par fournisseur, dans une seule transaction. */
    creerLot: (bons: any[]) => Promise<BonMp[]>;
    /** Nouveaux bons et ajouts a des brouillons existants, en une seule transaction. */
    enregistrerPreparation: (payload: { nouveaux?: any[]; ajouts?: any[] })
      => Promise<{ crees: BonMp[]; completes: BonMp[] }>;
    creer: (payload: any) => Promise<BonMp>;
    get: (bonId: number) => Promise<BonMp | null>;
    list: (filtres?: { statut?: string; fournisseurId?: number }) => Promise<BonMpResume[]>;
    mettreAJour: (bonId: number, patch: Record<string, unknown>) => Promise<BonMp>;
    supprimer: (bonId: number) => Promise<{ supprime: boolean; numero: string }>;
    ajouterLigne: (bonId: number, ligne: any) => Promise<BonMp>;
    mettreAJourLigne: (ligneId: number, patch: Record<string, unknown>) => Promise<BonMp>;
    supprimerLigne: (ligneId: number) => Promise<BonMp>;
  };
  planning: {
    list: (filtres?: { mois?: string; categorieId?: number; statut?: string; saisonId?: number; anneeCollection?: number; recherche?: string }) => Promise<PlanningArticle[]>;
    get: (id: number) => Promise<PlanningArticle | null>;
    kpis: () => Promise<PlanningKpis>;
    creer: (payload: PlanningArticlePayload) => Promise<PlanningArticle>;
    mettreAJour: (id: number, patch: Partial<PlanningArticlePayload>) => Promise<PlanningArticle>;
    deplacer: (id: number, champ: "mois_prevu_production" | "mois_prevu_reception", nouveauMois: string, orderedIds?: number[], forcer?: boolean) => Promise<PlanningArticle>;
    reordonner: (mois: string, orderedIds: number[]) => Promise<PlanningArticle[]>;
    ajouterPhoto: (id: number, sourcePath: string, forcer?: boolean) => Promise<PlanningArticle>;
    retirerPhoto: (id: number, forcer?: boolean) => Promise<PlanningArticle>;
    retirerDuPlanning: (id: number) => Promise<void>;
    supprimerProvisoire: (id: number) => Promise<void>;
    convertirEnProduit: (id: number, payloadArticle: { produit_id?: number; saison_id?: number; annee_collection?: number; rayon_id?: number; abreviation?: string }) => Promise<{ articleId: number; planning: PlanningArticle }>;
  };
  finance: {
    creerFournisseur: (payload: Partial<Fournisseur>) => Promise<Fournisseur>;
    mettreAJourFournisseur: (id: number, patch: Partial<Fournisseur>) => Promise<Fournisseur>;
    listFournisseurs: (options?: { includeInactive?: boolean }) => Promise<Fournisseur[]>;
    getFournisseur: (id: number) => Promise<Fournisseur | null>;
    ajouterPrixFournisseur: (payload: { fournisseur_id: number; matiere_catalogue_id?: number | null; accessoire_catalogue_id?: number | null; designation: string; unite: string; prix_ht: number; date_debut_validite?: string }) => Promise<PrixFournisseur>;
    listPrixFournisseur: (fournisseurId: number, options?: { includeHistorique?: boolean }) => Promise<PrixFournisseur[]>;
    prixEnVigueur: (criteres: { fournisseurId: number; matiereCatalogueId?: number; accessoireCatalogueId?: number; designation?: string; date?: string }) => Promise<PrixFournisseur | null>;
    creerAchat: (payload: Partial<Achat>) => Promise<Achat>;
    getAchat: (id: number) => Promise<Achat | null>;
    listAchats: (filtres?: { fournisseurId?: number; commandeId?: number; categorie?: string; partageablesUniquement?: boolean }) => Promise<Achat[]>;
    ajouterReceptionAchat: (achatId: number, payload: { date_reception?: string; quantite_recue?: number; reference_bl?: string; notes?: string }) => Promise<AchatReception>;
    listReceptionsAchat: (achatId: number) => Promise<AchatReception[]>;
    ajouterFactureAchat: (achatId: number, payload: { date_facture?: string; montant_ht: number; montant_tva?: number; reference_facture?: string }) => Promise<AchatFacture>;
    listFacturesAchat: (achatId: number) => Promise<AchatFacture[]>;
    getFacture: (id: number) => Promise<AchatFacture | null>;
    statutFacture: (id: number) => Promise<StatutFactureResultat>;
    coutAchat: (achatId: number) => Promise<CoutAchatResultat>;
    affecterAchat: (payload: { achat_id: number; commande_id: number; quantite_affectee: number; date_affectation?: string; notes?: string }) => Promise<AchatAffectation>;
    quantiteDisponibleAchat: (achatId: number) => Promise<number | null>;
    listAffectationsAchat: (achatId: number) => Promise<AchatAffectation[]>;
    coutAffectation: (affectationId: number) => Promise<{ affectation_id: number; part: number; facture_reel: number; provisoire_restant: number; cout_suivi: number }>;
    coutCommande: (commandeId: number) => Promise<CoutCommandeResultat>;
    syntheseCoutCommande: (commandeId: number) => Promise<SyntheseCoutCommande>;
    creerPaiement: (payload: { fournisseur_id: number; type?: "reglement" | "avance"; date_paiement?: string; montant: number; mode?: string; reference?: string; notes?: string }) => Promise<Paiement>;
    listPaiementsFournisseur: (fournisseurId: number) => Promise<Paiement[]>;
    affecterPaiement: (payload: { paiement_id: number; achat_facture_id: number; montant_affecte: number }) => Promise<PaiementAffectation>;
    creditNonAffecte: (paiementId: number) => Promise<number>;
    detteFournisseur: (fournisseurId: number) => Promise<DetteFournisseur>;
    ajouterEcheance: (achatId: number, payload: { date_echeance: string; montant: number; notes?: string; achat_facture_id?: number }) => Promise<Echeance>;
    listEcheances: (filtres?: { avant?: string; apres?: string }) => Promise<Echeance[]>;
    calculerEcheanceSuggeree: (dateFacture: string, delaiJours: number | null, delaiFinDeMois: boolean | number) => Promise<string | null>;
    listFacturesFournisseur: (fournisseurId: number) => Promise<FactureFournisseurDetaillee[]>;
    ajouterReceptionProduction: (commandeId: number, payload: { date_reception?: string; quantite_recue: number; quantite_conforme?: number; quantite_a_retoucher?: number; quantite_rebut?: number; notes?: string }) => Promise<ReceptionProduction>;
    enregistrerRetoucheReussie: (receptionId: number, quantite: number) => Promise<ReceptionProduction>;
    listReceptionsProduction: (commandeId: number) => Promise<ReceptionProduction[]>;
    quantiteCommercialisableCommande: (commandeId: number) => Promise<number>;
    syntheseGlobale: () => Promise<SyntheseGlobaleFinance>;
    listEcheancesDetaillees: (filtres?: { avant?: string; apres?: string }) => Promise<EcheanceDetaillee[]>;
    listFournisseursAvecSynthese: (options?: { includeInactive?: boolean }) => Promise<FournisseurAvecSynthese[]>;
    listAchatsDetailles: (filtres?: { fournisseurId?: number; commandeId?: number; categorie?: string; partageablesUniquement?: boolean }) => Promise<AchatDetaille[]>;
    listMatieresCatalogue: () => Promise<MatiereCatalogue[]>;
    trouverOuCreerMatiereCatalogue: (nom: string, uniteDefaut?: string) => Promise<MatiereCatalogue>;
    getOuCreerEstimation: (articleId: number) => Promise<Estimation>;
    mettreAJourEstimation: (estimationId: number, patch: { quantite_prevue?: number | null }) => Promise<Estimation>;
    supprimerEstimation: (estimationId: number) => Promise<void>;
    ajouterLigneEstimation: (estimationId: number, payload: Partial<EstimationLigne>) => Promise<EstimationLigne>;
    mettreAJourLigneEstimation: (ligneId: number, patch: Partial<EstimationLigne>) => Promise<EstimationLigne>;
    supprimerLigneEstimation: (ligneId: number) => Promise<void>;
    listLignesEstimation: (estimationId: number) => Promise<EstimationLigne[]>;
    syntheseEstimation: (estimationId: number) => Promise<SyntheseEstimation>;
    simulationPrix: (coutUnitaireHt: number, params: { coefficient?: number; prixEnvisage?: number }, quantiteCommercialisable?: number | null) => Promise<SimulationPrixResultat | null>;
    listEstimationsResume: () => Promise<EstimationResume[]>;
    mettreAJourPrixVenteEnvisage: (articleId: number, prix: number | null) => Promise<{ prix_vente_envisage: number | null }>;
    stockDisponibleMatiere: (matiereCatalogueId: number, couleur?: string | null) => Promise<StockMatiere>;
    affecterConsommationMatiere: (payload: { commande_id: number; matiere_catalogue_id: number; couleur?: string | null; quantite_consommee: number; date_affectation?: string; notes?: string }) => Promise<ResultatConsommationMatiere>;
    syntheseStockMatiere: () => Promise<StockMatiereResume[]>;
    comparaisonConsommationCommande: (commandeId: number) => Promise<ComparaisonConsommationLigne[]>;
    listFacturesAvecEcheances: (filtres?: { statutFiltre?: "en_retard" | "7j" | "30j" | "ce_mois" | "toutes" }) => Promise<FactureAvecEcheance[]>;
    listPaiementsEtAvances: () => Promise<PaiementDetaille[]>;
    listPostesCout: (options?: { includeInactifs?: boolean }) => Promise<PosteCoutPredefini[]>;
    rechercherPostesCout: (requete: string, limite?: number, categorie?: CategorieEstimation) => Promise<PosteCoutPredefini[]>;
    creerPosteCout: (payload: Partial<PosteCoutPredefini>) => Promise<PosteCoutPredefini>;
    mettreAJourPosteCout: (id: number, patch: Partial<PosteCoutPredefini>) => Promise<PosteCoutPredefini>;
    supprimerPosteCout: (id: number) => Promise<void>;
  };
  modelesMesures: {
    listProduitsAvecStatut: () => Promise<ModeleMesuresProduitStatut[]>;
    listByProduitId: (produitId: number, options?: { actifsSeulement?: boolean }) => Promise<ModeleMesures[]>;
    getById: (modeleId: number) => Promise<ModeleMesures | null>;
    create: (produitId: number, nom: string) => Promise<ModeleMesures>;
    dupliquer: (modeleId: number, nouveauNom: string) => Promise<ModeleMesures>;
    updateNom: (modeleId: number, nom: string) => Promise<ModeleMesures>;
    setActif: (modeleId: number, actif: boolean) => Promise<ModeleMesures>;
    deleteModele: (modeleId: number) => Promise<{ deleted: boolean }>;
    addLigne: (modeleId: number, nom: string, options?: Partial<{ repere: string; unite: string; tolerance_plus: string; tolerance_moins: string; commentaire: string }>) => Promise<ModeleMesures>;
    updateLigne: (modeleId: number, ligneId: number, patch: Partial<{ repere: string; unite: string; tolerance_plus: string; tolerance_moins: string; commentaire: string }>) => Promise<ModeleMesures>;
    removeLigne: (modeleId: number, ligneId: number) => Promise<ModeleMesures>;
    reorderLignes: (modeleId: number, orderedLigneIds: number[]) => Promise<ModeleMesures>;
    listModelesStandards: () => Promise<ModeleStandard[]>;
    chargerModeleStandard: (modeleId: number, cle: string) => Promise<ModeleMesures>;
  };
  system: {
    /** Sauvegarde COMPLÈTE : base, toutes les images, documents et paramètres, avec manifeste
     *  et vérification immédiate. `memoriser` retient l'emplacement pour les prochaines fois. */
    backup: (options?: { destination?: string; memoriser?: boolean }) => Promise<{
      canceled: boolean; folderPath?: string; manifeste?: any; verification?: RapportSauvegarde;
    }>;
    /** Sauvegarde complète avant une installation ou une migration (exigence n° 3). */
    backupAvantOperation: (motif?: string) => Promise<{
      dossier: string; verification: RapportSauvegarde;
      sur_disque_externe: boolean; avertissement: string | null;
    }>;
    verifierSauvegarde: (dossier?: string) => Promise<{ canceled: boolean; rapport?: RapportSauvegarde }>;
    /** Restauration d'ESSAI dans un dossier isolé : le dossier de données n'est pas touché. */
    essaiRestauration: (source?: string, cible?: string) => Promise<{
      canceled: boolean; ok?: boolean; dossier_essai?: string; fichiers_restaures?: number;
      verification_source?: RapportSauvegarde; verification_essai?: RapportSauvegarde;
    }>;
    listerSauvegardes: (dossier?: string) => Promise<{
      canceled: boolean; dossier?: string;
      sauvegardes?: { nom: string; dossier: string; octets: number; type: string | null;
                      cree_le: string | null; motif: string | null; avec_manifeste: boolean;
                      nb_images: number | null }[];
    }>;
    dossierExterne: () => Promise<{ dossier: string | null }>;
    choisirDossierExterne: () => Promise<{ canceled: boolean; dossier?: string | null }>;
    oublierDossierExterne: () => Promise<{ dossier: string | null }>;
    /** Restauration RÉELLE : vérifie d'abord, puis DÉPLACE les données actuelles au lieu de les
     *  écraser. Refuse une sauvegarde automatique, qui ne contient pas les images. */
    restore: (options?: { dossier?: string; forcer?: boolean }) => Promise<{
      canceled: boolean; restoredFrom?: string; donnees_precedentes?: string;
      elements_deplaces?: string[]; fichiers_restaures?: number; verification?: RapportSauvegarde;
    }>;
    exportFile: (format: "csv" | "xlsx") => Promise<{ canceled: boolean; filePath?: string }>;
    /** « serveur » : sauvegardes complètes faites sur le serveur ; « r2 » : version en ligne,
     *  sauvegardes automatiques de la nuit dans Cloudflare R2. */
    modeSauvegardes: () => Promise<{ mode: "serveur" | "r2" }>;
    /** Version en ligne : lien signé (5 min) pour télécharger une sauvegarde de la nuit. */
    lienSauvegarde: (nom: string) => Promise<{ url: string; nom: string }>;
    loadDemoData: () => Promise<{ commandes: number; articles: number }>;
    clearDemoData: () => Promise<{ removed: number; articlesRemoved: number }>;
  };
}

/** Le résultat des sept contrôles d'une sauvegarde. `ok` est vrai quand aucun n'est en échec ;
 *  « non-effectué » et « sans objet » ne comptent jamais comme une réussite. */
export type RapportSauvegarde = {
  ok: boolean;
  dossier: string;
  type?: string;
  cree_le?: string;
  echecs?: number;
  manifeste?: any;
  controles: { nom: string; etat: "ok" | "echec" | "non-effectue" | "sans-objet"; detail: string | null }[];
};

declare global {
  interface Window {
    api: BelvieApi;
  }
}
