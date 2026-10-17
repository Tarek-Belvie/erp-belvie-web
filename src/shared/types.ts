export type Statut = "brouillon" | "validee" | "en_production" | "controle_qualite" | "terminee" | "annulee";
export type Priorite = "haute" | "normale" | "faible";
export type ListeType = "produit" | "couleur" | "responsable" | "atelier" | "taille" | "saison" | "rayon" | "operateur" | "coupe" | "pointure" | "categorie";
export type TypeProduction = "nouveau" | "reassort";

export const TYPE_PRODUCTION_LABELS: Record<TypeProduction, string> = {
  nouveau: "Nouvel article",
  reassort: "Réassort",
};
export type TypeEvenementHistorique =
  | "validation" | "lancement" | "entree_controle_qualite" | "fin_production"
  | "annulation" | "blocage" | "deblocage" | "archivage" | "desarchivage";

export const STATUT_LABELS: Record<Statut, string> = {
  brouillon: "Brouillon",
  validee: "Validée",
  en_production: "En production",
  controle_qualite: "Contrôle qualité",
  terminee: "Terminée",
  annulee: "Annulée",
};

// Correspondance statut -> classe CSS de badge (.v2-badge-*), pilotée par les tokens de couleur
// définis une seule fois dans src/styles/global.css. À réutiliser partout où un statut est
// affiché (liste, fiche, dashboard, filtres, statistiques...) pour garantir la même identité
// visuelle dans tout l'ERP.
export const STATUT_BADGE_CLASS: Record<Statut, string> = {
  brouillon: "v2-badge-brouillon",
  validee: "v2-badge-validee",
  en_production: "v2-badge-en-production",
  controle_qualite: "v2-badge-controle-qualite",
  terminee: "v2-badge-terminee",
  annulee: "v2-badge-annulee",
};

export const PRIORITE_LABELS: Record<Priorite, string> = {
  haute: "Haute",
  normale: "Normale",
  faible: "Faible",
};

export const EVENEMENT_LABELS: Record<TypeEvenementHistorique, string> = {
  validation: "Commande validée",
  lancement: "Production lancée",
  entree_controle_qualite: "Entrée en contrôle qualité",
  fin_production: "Production terminée",
  annulation: "Commande annulée",
  blocage: "Commande bloquée",
  deblocage: "Commande débloquée",
  archivage: "Commande archivée",
  desarchivage: "Commande désarchivée",
};

export const EVENEMENT_ICONS: Record<TypeEvenementHistorique, string> = {
  validation: "✅",
  lancement: "🚀",
  entree_controle_qualite: "🔍",
  fin_production: "🏁",
  annulation: "🛑",
  blocage: "⛔",
  deblocage: "🔓",
  archivage: "📦",
  desarchivage: "📤",
};

// Transition de statut associée à chaque événement, pour affichage "ancien → nouveau" dans
// l'historique. Non renseigné = pas de changement de statut pour ce type d'événement
// (blocage/déblocage/archivage/désarchivage n'affectent qu'un indicateur, pas le statut).
export const EVENEMENT_TRANSITIONS: Partial<Record<TypeEvenementHistorique, { de?: Statut; vers?: Statut }>> = {
  validation: { de: "brouillon", vers: "validee" },
  lancement: { de: "validee", vers: "en_production" },
  entree_controle_qualite: { de: "en_production", vers: "controle_qualite" },
  fin_production: { de: "controle_qualite", vers: "terminee" },
  annulation: { vers: "annulee" },
};

export interface Etape {
  id: number;
  cle: string;
  libelle: string;
  pourcentage: number;
  ordre: number;
  optionnelle: number;
  actif: number;
}

export interface ListeValeur {
  id: number;
  type: ListeType;
  nom: string;
  nom_normalise: string;
  code: string | null;
  ordre: number | null;
  responsable_nom: string | null;
  actif: number;
  created_at: string;
}

export interface ArticlePhoto {
  id: number;
  article_id: number;
  photo_path: string;
  photo_thumb_path: string;
  est_principale: number;
  ordre: number;
}

export interface Article {
  /** Nom commercial de CET article (« T-shirt oversize »), distinct du type générique porté par
   *  produit_id. Obligatoire à la création depuis l'étape D1 ; repris du nom du produit pour les
   *  articles antérieurs, donc jamais vide. */
  designation?: string | null;
  /** COALESCE(designation, produit) : le libellé à afficher partout. */
  nom_affiche?: string;
  id: number;
  uuid: string;
  produit_id: number | null;
  produit: string; // "Non catégorisé" si produit_id est vide (voir COALESCE côté backend)
  saison_id: number | null;
  saison: string | null;
  saison_code: string | null;
  annee_collection: number | null;
  rayon_id: number | null;
  rayon: string | null;
  rayon_code: string | null;
  categorie_id: number | null;
  categorie: string | null;
  abreviation: string | null;
  numero_sequentiel: number | null;
  reference_principale: string | null;
  prix_vente_envisage: number | null;
  nb_commandes_nouveau: number; // 0 = aucune commande initiale encore créée pour cet article
  nb_productions: number; // total commandes (nouveau + réassorts) liées à cet article
  derniere_reference_production: string | null;
  max_numero_reassort: number | null;
  created_at: string;
  updated_at: string;
  photos: ArticlePhoto[];
}

export interface ArticlePayload {
  produit_id: number;
  saison_id: number;
  annee_collection: number;
  rayon_id: number;
  abreviation: string;
}

export interface CommandeLigne {
  id?: number;
  couleur_id: number;
  couleur?: string;
  couleur_reference?: string | null;
  taille_id: number | null;
  taille?: string | null;
  quantite: number;
}

export interface HistoriqueEvenement {
  id: number;
  type_evenement: TypeEvenementHistorique;
  operateur_id: number | null;
  motif: string | null;
  survenu_le: string;
}

export interface Commande {
  id: number;
  uuid: string;
  numero: string | null;
  article_id: number;
  article_reference_principale: string | null;
  produit_id: number;
  produit: string;
  saison_id: number | null;
  saison: string | null;
  annee_collection: number | null;
  rayon_id: number | null;
  rayon: string | null;
  type_production: TypeProduction;
  numero_reassort: number | null;
  reference_production: string | null;
  responsable: string;
  atelier_id: number;
  atelier: string;
  quantite_totale: number;
  nb_couleurs: number;
  nb_tailles: number;
  photo_path: string | null;
  photo_thumb_path: string | null;
  date_lancement: string;
  date_fin_prevue: string;
  etape_id: number;
  etape_libelle: string;
  etape_pourcentage: number;
  etape_ordre: number;
  etape_cle: string;
  statut: Statut;
  priorite: Priorite;
  bloquee: number;
  blocage_motif: string | null;
  bloquee_le: string | null;
  bloquee_par_id: number | null;
  debloquee_le: string | null;
  debloquee_par_id: number | null;
  valide_le: string | null;
  valide_par_id: number | null;
  lance_le: string | null;
  lance_par_id: number | null;
  controle_qualite_le: string | null;
  controle_qualite_par_id: number | null;
  terminee_le: string | null;
  terminee_par_id: number | null;
  annulee_le: string | null;
  annulee_par_id: number | null;
  annulation_motif: string | null;
  archived_le: string | null;
  archived_par_id: number | null;
  desarchive_le: string | null;
  desarchive_par_id: number | null;
  commentaires: string | null;
  archived: number;
  est_demo: number;
  created_at: string;
  updated_at: string;
  lignes?: CommandeLigne[];
  historique?: HistoriqueEvenement[];
}

export interface CommandePayload {
  article_id: number;
  type_production?: TypeProduction;
  responsable_nom: string;
  atelier_id: number;
  date_lancement: string;
  date_fin_prevue: string;
  etape_id: number;
  priorite: Priorite;
  commentaires?: string | null;
  lignes: { couleur_id: number; taille_id: number | null; quantite: number; reference_libre?: string | null }[];
}

export interface Entreprise {
  id: 1;
  nom_commercial: string | null;
  raison_sociale: string | null;
  matricule_fiscal: string | null;
  registre_commerce: string | null;
  identifiant_tva: string | null;
  adresse: string | null;
  ville: string | null;
  code_postal: string | null;
  pays: string | null;
  telephone: string | null;
  email: string | null;
  site_web: string | null;
  banque: string | null;
  agence_bancaire: string | null;
  rib: string | null;
  swift_bic: string | null;
  taux_tva_defaut: number | null;
  logo_path: string | null;
  created_at: string;
  updated_at: string;
}

export type EntreprisePayload = Partial<Omit<Entreprise, "id" | "created_at" | "updated_at">>;

export type EtatWizardEntreprise = "never_shown" | "postponed" | "completed";

export interface BcPfLigne {
  id: number;
  bc_pf_id: number;
  couleur_nom: string;
  couleur_reference: string | null;
  taille_nom: string | null;
  quantite: number;
}

export type BcPfStatut = "brouillon" | "valide" | "lance" | "remplace" | "annule";

export const BC_STATUT_LABELS: Record<BcPfStatut, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
  lance: "Lancé",
  remplace: "Remplacé",
  annule: "Annulé",
};

export interface BcPfRef {
  id: number;
  numero: string;
  statut: BcPfStatut;
}

export interface BcPf {
  id: number;
  uuid: string;
  numero: string;
  commande_id: number;
  atelier_id: number | null;
  statut: BcPfStatut;
  remplace_bc_pf_id: number | null;
  motif_remplacement: string | null;

  commande_numero: string | null;
  article_nom: string | null;
  article_reference: string | null;
  type_production: TypeProduction | null;
  atelier_nom: string | null;
  responsable_nom: string | null;
  saison_nom: string | null;
  date_limite_production: string | null;
  priorite: Priorite | null;
  photo_snapshot_path: string | null;

  entreprise_nom_commercial: string | null;
  entreprise_raison_sociale: string | null;
  entreprise_matricule_fiscal: string | null;
  entreprise_registre_commerce: string | null;
  entreprise_adresse: string | null;
  entreprise_telephone: string | null;
  entreprise_email: string | null;
  entreprise_banque: string | null;
  entreprise_agence_bancaire: string | null;
  entreprise_rib: string | null;
  entreprise_logo_snapshot_path: string | null;

  notes_atelier: string | null;
  observations_internes: string | null;

  commande_synced_at: string | null;
  created_at: string;
  updated_at: string;
  validated_at: string | null;
  launched_at: string | null;

  lignes?: BcPfLigne[];
  remplace_par?: BcPfRef | null;
  remplace_qui?: BcPfRef | null;
  remplace_numero?: string | null;
}

export type BcPfPayload = Partial<Pick<BcPf, "notes_atelier" | "observations_internes">>;

export interface GrilleTailleValeur {
  id: number;
  grille_id: number;
  valeur: string;
  valeur_normalisee: string;
  ordre: number;
  actif: number;
}

export interface GrilleTaille {
  id: number;
  nom: string;
  nom_normalise: string;
  actif: number;
  created_at: string;
  valeurs: GrilleTailleValeur[];
}

export interface DeclinaisonType {
  id: number;
  code: string;
  nom: string;
  affichage_couleur: number;
  ordre: number;
  actif: number;
  created_at: string;
  nb_valeurs?: number;
}

export interface DeclinaisonValeur {
  id: number;
  declinaison_type_id: number;
  valeur: string;
  valeur_normalisee: string;
  couleur_hex: string | null;
  ordre: number;
  actif: number;
  created_at: string;
}

export interface ArticleDeclinaisonType extends DeclinaisonType {
  association_id: number;
}

export interface ArticleVarianteValeur {
  declinaison_type_id: number;
  type_nom: string;
  type_code: string;
  declinaison_valeur_id: number;
  valeur: string;
  couleur_hex: string | null;
}

export interface ArticleVariante {
  id: number;
  article_id: number;
  sku: string | null;
  code_barres: string | null;
  reference_interne: string | null;
  actif: number;
  created_at: string;
  updated_at: string;
  valeurs: ArticleVarianteValeur[];
}

export interface ImpactConfigurationDeclinaisons {
  total_attendu: number;
  conservees: number;
  a_reactiver: number;
  a_reactiver_ids: number[];
  nouvelles: number;
  obsoletes: number;
  obsoletes_ids: number[];
  deja_utilisees_ailleurs: number;
}

export interface ResultatGenerationVariantes {
  total_attendu: number;
  deja_existantes: number;
  creees: number;
  total: number;
  variantes: ArticleVariante[];
}

// --- Fiche Technique Produit ---

export type FicheTechniqueStatut = "brouillon" | "validee" | "archivee";

export interface FicheTechnique {
  id: number;
  article_id: number;
  statut: FicheTechniqueStatut;
  coupe_id: number | null;
  coupe_nom: string | null;
  notes: string | null;
  /** Description technique rédigée par le bureau d'études : HTML restreint à sept balises
   *  (p, h3, ul, ol, li, strong, br), sans aucun attribut. Assaini à l'enregistrement par
   *  electron/ipc/descriptionTechnique.js. Distinct de `notes`, qui reste du texte libre. */
  description_technique: string | null;
  validated_at: string | null;
  archived_at: string | null;
  /** Numéro de la version VALIDÉE en vigueur (V1, V2, V3…). Attribué automatiquement à chaque
   *  validation qui suit une modification : l'utilisateur n'a rien à saisir. Absent des bases
   *  qui n'ont pas encore reçu la migration des révisions. */
  revision?: number;
  /** Motif de la dernière demande de modification, conservé pour l'historique. */
  revision_motif?: string | null;
  created_at: string;
  updated_at: string;
  croquis?: FTCroquis[];
  grille?: FTGrille;
  accessoires?: FTAccessoire[];
  matieres?: FTMatiere[];
  // Présents uniquement sur les items renvoyés par listAll() :
  produit?: string;
  reference_principale?: string | null;
  saison?: string | null;
  nb_croquis?: number;
  nb_mesures?: number;
  nb_accessoires?: number;
  nb_matieres?: number;
}

export type FTVue = "face" | "dos" | "detail" | "autre";
export const FT_VUE_LABELS: Record<FTVue, string> = { face: "Face", dos: "Dos", detail: "Détail", autre: "Autre" };

export interface FTAnnotation {
  id: number;
  croquis_id: number;
  ancre_x: number;
  ancre_y: number;
  label_x: number;
  label_y: number;
  texte: string;
  style_fleche: "droite" | "courbe" | "coudee";
  couleur: string;
  epaisseur: number;
  orientation_texte: "horizontal" | "vertical";
  visible_impression: number;
  ordre: number;
}

export interface FTCroquis {
  id: number;
  fiche_id: number;
  vue: FTVue;
  vue_personnalisee: string | null;
  image_path: string;
  legende: string | null;
  ordre: number;
  created_at: string;
  annotations: FTAnnotation[];
}

export interface MesureCatalogue {
  id: number;
  nom: string;
  nom_normalise: string;
  ordre: number;
  actif: number;
}

export interface FTMesureLigne {
  /** Libellé propre à CETTE fiche. null = suit le catalogue. `nom` est déjà le résultat de
   *  COALESCE(nom_local, mesures_catalogue.nom) : renommer ici n'affecte aucune autre fiche. */
  nom_local?: string | null;
  /** Libellé du catalogue global, pour pouvoir y revenir. */
  nom_catalogue?: string;
  id: number; // = mesure_catalogue_id
  nom: string;
  repere: string | null;
  unite: string | null;
  tolerance_plus: string | null;
  tolerance_moins: string | null;
  commentaire: string | null;
  ordre: number;
}

export interface FTTaille {
  id: number; // ft_taille_id, local à la fiche
  nom: string;
  grille_valeur_id: number | null;
  ordre: number;
}

export interface FTMesureValeur {
  mesure_catalogue_id: number;
  ft_taille_id: number;
  valeur: string | null;
}

export interface FTGrille {
  lignes: FTMesureLigne[];
  tailles: FTTaille[];
  valeurs: FTMesureValeur[];
}

export interface AccessoireCatalogue {
  id: number;
  nom: string;
  /** Famille proposée par défaut lorsque cette désignation est choisie. Préremplissage, pas
   *  contrainte : la famille reste modifiable sur la ligne créée. */
  famille?: FTFournitureFamille;
  nom_normalise: string;
  ordre: number;
  actif: number;
}

export interface TailleCatalogue {
  id: number;
  nom: string;
  nom_normalise: string;
  ordre: number;
  actif: number;
}

/** Famille d'une fourniture : Habillage & Branding, ou Composants de confection. */
export type FTFournitureFamille = "habillage" | "composant";

/** FOURNITURE de la fiche technique (l'onglet s'appelle Fournitures ; la table reste
 *  ft_accessoires, et la propriété `fiche.accessoires` conserve son nom).
 *
 *  La fiche décrit CE QU'IL FAUT UTILISER et EN QUELLE QUANTITÉ par pièce. Elle ne porte ni prix,
 *  ni fournisseur, ni quantité achetée : chez qui on achète et à quel prix relève de
 *  Finance/Achats, et une fourniture peut changer de fournisseur sans que la définition
 *  technique du produit change.
 *
 *  Seul `nom` est obligatoire. Couleur, taille/dimension, référence, emplacement et photo restent
 *  facultatifs selon la fourniture. */
export interface FTFourniture {
  id: number;
  fiche_id: number;
  accessoire_catalogue_id: number | null;
  famille: FTFournitureFamille;
  nom: string;
  /** Utilisation / emplacement sur le vêtement — surtout pertinent pour les composants. */
  emplacement: string | null;
  /** Référence unique de la fourniture. Remplace les anciennes reference_interne et
   *  reference_fournisseur, qui n'avaient aucun usage métier distinct dans le code. */
  reference: string | null;
  /** Couleur DESCRIPTIVE de la fourniture elle-même ("zip noir"). Pour une variation selon la
   *  couleur du produit (pantalon Beige -> cordon Beige), voir FTFournitureCouleur. */
  couleur: string | null;
  /** "18 cm", "40 mm", "#5" — d'où le libellé Taille / Dimension plutôt que Taille. */
  taille_dimension: string | null;
  /** Consommation PAR PIÈCE, et non quantité totale : c'est ce qui permettra de calculer le
   *  besoin depuis une commande (600 pantalons x 0,85 m = 510 m). */
  consommation_par_piece: number | null;
  /** Texte LIBRE (pièce, m, cm, paire, jeu, bobine...), sans CHECK contrairement aux matières. */
  unite: string | null;
  photo_path: string | null;
  description: string | null;
  ordre: number;
  /** Déclinaisons par couleur produit, jointes par listAccessoires. Tableau vide = la fourniture
   *  est la même pour toutes les couleurs, et le besoin est calculé toutes couleurs confondues.
   *  Facultatif : les écritures (addAccessoire, updateAccessoire) rendent la ligne seule. */
  couleurs?: FTFournitureCouleur[];
}

/** Alias de compatibilité : `fiche.accessoires` reste typé, et le code existant qui référence
 *  FTAccessoire continue de compiler. */
export type FTAccessoire = FTFourniture;

/** Variante d'une fourniture selon la COULEUR PRODUIT (pantalon Noir -> cordon Noir).
 *  couleur_produit_id pointe listes_valeurs, jamais declinaison_valeurs : c'est le référentiel
 *  des quantités réelles de commande_lignes. */
export interface FTFournitureCouleur {
  id: number;
  ft_accessoire_id: number;
  couleur_produit_id: number;
  /** Texte LIBRE, contrairement au coloris d'une matière qui pointe un catalogue : un zip noir
   *  n'a pas de nuancier fournisseur à référencer. Null = « coloris à préciser ». */
  couleur_fourniture: string | null;
  reference: string | null;
  /** Facultative. Vide, la consommation de la ligne s'applique ; renseignée, elle prime pour
   *  cette couleur (règle couleur du moteur de besoins). Jamais remplacée par zéro. */
  consommation_par_piece: number | null;
  /** Joint depuis listes_valeurs, en lecture seule. */
  couleur_produit_nom: string;
}

/** Variante d'une fourniture selon la TAILLE (S -> zip 60 cm, XL -> zip 64 cm).
 *  Préparée en base, non exposée dans l'interface V1. ft_taille_id désigne une colonne de
 *  ft_tailles, locale à la fiche — comme FTMesureValeur. */
export interface FTFournitureTaille {
  id: number;
  ft_accessoire_id: number;
  ft_taille_id: number;
  taille_dimension: string | null;
  consommation_par_piece: number | null;
}

// --- Matières de la fiche technique ---

export type FTMatiereUnite = "kg" | "m" | "piece" | "lot";
export type FTMatiereModeConsommation = "moyenne" | "par_taille";

/** Coloris d'une matière du catalogue : "Noir 001" / réf. "MOL-320-N01". Partagé entre toutes
 *  les fiches qui utilisent cette matière — à ne pas confondre avec la référence du coloris
 *  PRODUIT, qui reste commande_lignes.reference_libre (ex. "NOIR-01"). */
export interface MatiereCouleur {
  id: number;
  matiere_catalogue_id: number;
  code: string | null;
  libelle: string;
  libelle_normalise: string;
  reference: string | null;
  ordre: number | null;
  actif: number;
  created_at: string;
}

/** Correspondance couleur produit -> coloris matière, pour une matière d'une fiche.
 *  couleur_produit_id pointe listes_valeurs (type 'couleur'), le référentiel utilisé par les
 *  quantités réelles de commande_lignes. matiere_couleur_id est nullable : la couleur produit
 *  peut être déclarée avant que le coloris fournisseur ne soit arrêté. */
export interface FTMatiereCouleur {
  id: number;
  ft_matiere_id: number;
  couleur_produit_id: number;
  matiere_couleur_id: number | null;
  // Ajoutés par la jointure de listMatieres(), jamais stockés :
  couleur_produit_nom: string;
  matiere_couleur_libelle: string | null;
  matiere_couleur_code: string | null;
  matiere_couleur_reference: string | null;
}

/** Consommation d'une matière pour UNE taille de la fiche. Préparée en base, non exposée dans
 *  l'interface de cette V1. ft_taille_id désigne une colonne de ft_tailles (locale à la fiche),
 *  comme FTMesureValeur — jamais une valeur de grille. */
export interface FTMatiereConsoTaille {
  id: number;
  ft_matiere_id: number;
  ft_taille_id: number;
  consommation_technique: number | null;
  taille_nom: string;
  ordre: number;
}

/** Une matière de la recette. La fiche décrit la consommation PAR PIÈCE : ni quantité totale
 *  (calculée plus tard depuis la commande de production), ni prix (qui appartient à Finance et
 *  varie par fournisseur, par achat et dans le temps). */
export interface FTMatiere {
  id: number;
  fiche_id: number;
  matiere_catalogue_id: number | null;
  nom: string;
  utilisation: string | null;
  composition: string | null;
  grammage: string | null;
  unite: FTMatiereUnite;
  consommation_technique: number | null;
  perte_pourcent: number;
  mode_consommation: FTMatiereModeConsommation;
  ordre: number;
  /** TOUJOURS calculée par le processus principal, jamais stockée en base :
   *  consommation_technique × (1 + perte_pourcent / 100). Lecture seule. */
  consommation_budgetee: number | null;
  catalogue_unite_defaut: string | null;
  couleurs: FTMatiereCouleur[];
  consommations_taille: FTMatiereConsoTaille[];
}

// --- Besoins matières d'une commande de production ---

/** Besoin d'UNE matière pour UNE couleur produit. `besoin` est la valeur NON arrondie :
 *  pieces × consommation budgétée. L'arrondi appartient à l'affichage. */
export interface BesoinMatiereLigne {
  couleur_produit_id: number;
  couleur_nom: string;
  coloris_matiere: string | null;
  coloris_code: string | null;
  coloris_reference: string | null;
  pieces: number;
  /** false = couleur prévue dans la fiche mais absente de la commande. Cas normal, besoin nul,
   *  aucune alerte — à ne pas confondre avec couleurs_sans_correspondance, qui est l'anomalie. */
  commandee: boolean;
  besoin: number | null;
}

export interface BesoinMatiere {
  ft_matiere_id: number;
  nom: string;
  utilisation: string | null;
  unite: FTMatiereUnite;
  mode_consommation: FTMatiereModeConsommation;
  consommation_technique: number | null;
  perte_pourcent: number;
  consommation_budgetee: number | null;
  lignes: BesoinMatiereLigne[];
  total: number | null;
  /** true = pas de consommation technique saisie : la matière est listée mais non chiffrable. */
  incomplete: boolean;
}

/** Projection calculée à la volée, jamais stockée. `fiche_statut` est informatif : le calcul
 *  fonctionne aussi sur une fiche en brouillon, justement pour anticiper les achats. */
export interface BesoinsMatieres {
  commande_id: number;
  fiche_id: number | null;
  fiche_statut: FicheTechniqueStatut | null;
  matieres: BesoinMatiere[];
  /** ANOMALIE : couleurs commandées sans correspondance dans la fiche. Leur besoin est
   *  incalculable, donc la matière risque de ne jamais être achetée. */
  couleurs_sans_correspondance: { couleur_id: number; couleur_nom: string; pieces: number }[];
  total_general: number | null;
}

/** Une pastille de taille affichée dans la fiche. Générée dynamiquement depuis la grille : la
 *  valeur peut être une lettre (S, 2XL), un nombre (29, 38) ou tout autre texte — l'interface ne
 *  fait AUCUNE distinction et n'écrit aucune taille en dur. */
export interface PastilleTaille {
  valeur: string;
  grille_valeur_id: number | null;
  selectionnee: boolean;
  ft_taille_id: number | null;
  /** true = taille de la fiche sans correspondance dans la grille active (taille exceptionnelle,
   *  valeur désactivée depuis, ou fiche historique sans grille). Toujours affichée : sans cela,
   *  une colonne réelle du tableau disparaîtrait de l'écran. */
  hors_grille: boolean;
}

export interface GrilleTailles { id: number; nom: string; actif: number; nb_valeurs?: number; }

/** origine : d'où vient la grille retenue.
 *  'fiche' = choix explicite | 'produit' = produit_grille_taille | 'suggestion' = déduite sans
 *  ambiguïté des autres fiches du même produit | 'ambigu' = plusieurs grilles en usage, donc
 *  AUCUNE suggestion | 'aucune' = rien à proposer. */
export interface TaillesDisponibles {
  grille: GrilleTailles | null;
  origine: "fiche" | "produit" | "suggestion" | "ambigu" | "aucune";
  suggestions: GrilleTailles[];
  grilles: GrilleTailles[];
  pastilles: PastilleTaille[];
}

/** Effet d'un changement de grille, calculé SANS rien modifier, pour afficher une confirmation
 *  précise avant toute suppression. */
export interface AnalyseChangementGrille {
  conservees: { ft_taille_id: number; nom: string; grille_valeur_id: number; nb_valeurs: number }[];
  retirees: { ft_taille_id: number; nom: string; nb_valeurs: number }[];
  valeurs_perdues: number;
}

/** Écart entre DEUX tailles consécutives, pour une mesure. Les deux extrémités sont explicites :
 *  avec la seule taille d'arrivée, supprimer une taille intermédiaire faisait changer un
 *  intervalle de sens en silence (S→M et M→L devenaient « S→L »). valeur = null signifie
 *  intervalle NON RENSEIGNÉ — à ne pas confondre avec 0, qui voudrait dire « aucun écart ». */
export interface IntervalleGradation {
  taille_depart_id: number;
  depart_nom: string;
  taille_arrivee_id: number;
  arrivee_nom: string;
  valeur: number | null;
}

/** Résultat calculé SANS rien écrire, pour prévisualiser « Appliquer la gradation ». */
export interface SimulationGradation {
  possible: boolean;
  raison: string | null;
  cellules: { ft_taille_id: number; taille_nom: string; valeur: string; existante: string | null }[];
  /** Intervalles sans gradation ayant STOPPÉ la propagation : on ne franchit jamais un trou. */
  intervalles_manquants: string[];
  reference?: { ft_taille_id: number; taille_nom: string };
  /** Nombre de cellules déjà remplies qui seraient remplacées en mode « tout ». */
  ecrasables?: number;
}

// --- Modèles de tableaux de mesures (Paramètres) ---

export interface ModeleMesuresLigne {
  id: number;
  mesure_catalogue_id: number;
  nom: string;
  repere: string | null;
  unite: string | null;
  tolerance_plus: string | null;
  tolerance_moins: string | null;
  ordre: number;
}

export interface ModeleMesures {
  id: number;
  nom: string;
  produit_id: number;
  actif: number;
  lignes: ModeleMesuresLigne[];
}

export type MesuresEtat = "non_genere" | "genere_depuis_modele" | "construit_manuellement";

export interface MesuresStatut {
  taillesConfirmees: boolean;
  etat: MesuresEtat;
  grille: FTGrille;
  modeleUtilise: ModeleMesures | null;
  modelesDisponibles: ModeleMesures[];
}

export interface ModeleMesuresResume {
  id: number;
  nom: string;
  produit_id: number;
  actif: number;
  nb_lignes: number;
}

/** Jeu de mesures de départ. Défini en JavaScript (modelesMesures.js), JAMAIS écrit en base au
 *  démarrage : il ne devient des lignes réelles que sur clic de l'utilisateur, et chaque ligne
 *  reste ensuite modifiable, supprimable et réordonnable comme une ligne saisie à la main. */
export interface ModeleStandard {
  cle: string;
  label: string;
  /** Regroupement d'affichage : Hauts en maille, Chemises, Vestes, Bas. */
  famille?: string;
  nb_mesures: number;
}

/** Particularité technique venant compléter un jeu de base (capuche, bord-côte, ceinture
 *  élastiquée). Ce n'est PAS une catégorie : une veste à capuche reste une veste. Le complément
 *  s'ajoute par-dessus le tableau existant sans rien remplacer. */
export interface ComplementStandard {
  cle: string;
  label: string;
  nb_mesures: number;
  /** Clés des jeux de base auxquels ce complément s'applique. */
  cible: string[];
}

export interface ModeleMesuresProduitStatut {
  produit_id: number;
  produit_nom: string;
  modeles: ModeleMesuresResume[];
}


export type PlanningStatut =
  | "idee" | "a_etudier" | "prototype" | "echantillon" | "a_modifier" | "valide"
  | "a_produire" | "en_production" | "production_terminee" | "shooting_a_preparer"
  | "pret_au_lancement" | "lance" | "annule";

export const PLANNING_STATUT_LABELS: Record<PlanningStatut, string> = {
  idee: "Idée",
  a_etudier: "À étudier",
  prototype: "Prototype",
  echantillon: "Échantillon",
  a_modifier: "À modifier",
  valide: "Validé",
  a_produire: "À produire",
  en_production: "En production",
  production_terminee: "Production terminée",
  shooting_a_preparer: "Shooting à préparer",
  pret_au_lancement: "Prêt au lancement",
  lance: "Lancé",
  annule: "Annulé",
};

export interface PlanningArticle {
  id: number;
  uuid: string;
  article_id: number | null;
  nom_provisoire: string | null;
  reference_provisoire: string | null;
  produit_id: number | null;
  rayon_id: number | null;
  photo_path: string | null;
  photo_thumb_path: string | null;
  categorie_id: number | null;
  categorie_nom: string | null;
  saison_id: number | null;
  saison_nom: string | null;
  annee_collection: number | null;
  mois_prevu_production: string; // 'AAAA-MM'
  mois_prevu_reception: string | null; // 'AAAA-MM', indépendant de la production
  quantite_previsionnelle: number | null;
  coloris_previsionnels: string | null;
  coloris: string[];
  statut: PlanningStatut;
  atelier_id: number | null;
  atelier_nom: string | null;
  notes: string | null;
  ordre: number;
  produit_cree_le: string | null;
  archived: number;
  created_at: string;
  updated_at: string;
  // Calculés côté backend :
  article_produit_nom: string | null;
  article_reference: string | null;
  nom_affiche: string;
  reference_affichee: string | null;
  photo_affichee: string | null;
  photo_affichee_thumb: string | null;
  est_provisoire: number;
}

export interface PlanningArticlePayload {
  article_id?: number | null;
  nom_provisoire?: string;
  reference_provisoire?: string;
  produit_id?: number | null;
  rayon_id?: number | null;
  categorie_id?: number | null;
  saison_id?: number | null;
  annee_collection?: number | null;
  mois_prevu_production: string;
  mois_prevu_reception?: string | null;
  quantite_previsionnelle?: number | null;
  coloris_previsionnels?: string | null;
  statut?: PlanningStatut;
  atelier_id?: number | null;
  notes?: string;
  forcer?: boolean;
}

export interface PlanningKpis {
  total: number;
  en_developpement: number;
  en_production: number;
  shooting_a_preparer: number;
  pret_au_lancement: number;
  parStatut: Record<string, number>;
}

// ==================================================================================================
// MODULE FINANCE
// ==================================================================================================
export interface MatiereCatalogue {
  id: number;
  nom: string;
  nom_normalise: string;
  unite_defaut: string;
  ordre: number | null;
  actif: number;
  created_at: string;
}

export interface Fournisseur {
  id: number;
  nom: string;
  activite: string | null;
  contact: string | null;
  telephone: string | null;
  email: string | null;
  adresse: string | null;
  conditions_paiement_defaut: string | null; // ancien champ, plus jamais utilisé côté interface
  delai_paiement_jours: number | null;
  delai_fin_de_mois: number; // 0/1
  mode_paiement_defaut: string | null;
  notes: string | null;
  actif: number;
  created_at: string;
  updated_at: string;
}
export interface FournisseurAvecSynthese extends Fournisseur {
  dette_actuelle: number;
  prochaine_echeance: string | null;
  categories_achat: string[];
}

export interface PrixFournisseur {
  id: number;
  fournisseur_id: number;
  matiere_catalogue_id: number | null;
  accessoire_catalogue_id: number | null;
  designation: string;
  unite: string;
  prix_ht: number;
  date_debut_validite: string;
  date_fin_validite: string | null;
  created_at: string;
}

export type CategorieAchat = "matiere" | "fourniture" | "confection" | "impression" | "transport" | "retouche" | "emballage" | "autre";
export const CATEGORIES_ACHAT_LABELS: Record<CategorieAchat, string> = {
  matiere: "Matière", fourniture: "Fourniture", confection: "Confection", impression: "Impression",
  transport: "Transport", retouche: "Retouche", emballage: "Emballage", autre: "Autre",
};

export interface Achat {
  id: number;
  uuid: string;
  fournisseur_id: number;
  commande_id: number | null;
  categorie: CategorieAchat;
  designation: string;
  matiere_catalogue_id: number | null;
  couleur: string | null;
  quantite: number | null;
  unite: string | null;
  montant_engage: number;
  date_engagement: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}
export type StatutAchat = "provisoire" | "paye" | "partiellement_paye" | "a_payer";
export interface AchatDetaille extends Achat {
  fournisseur_nom: string;
  commande_numero: string | null;
  nb_affectations: number;
  facture_reel: number;
  provisoire_restant: number;
  cout_suivi: number;
  paye: number;
  reste_a_payer: number;
  statut: StatutAchat;
}

export interface LotStockDetail {
  achat_id: number;
  date_engagement: string;
  reference: string | null;
  quantite_achetee: number | null;
  quantite_consommee: number;
  disponible: number;
  prix_unitaire_reel: number | null;
}
export interface StockMatiere {
  matiere_catalogue_id: number;
  couleur: string | null;
  achete: number;
  consomme: number;
  disponible: number;
  lots: LotStockDetail[];
}
export interface StockMatiereResume extends StockMatiere {
  nom: string;
  unite: string | null;
  valeur_stock: number;
}
export interface DetailAffectationConsommation {
  affectation_id: number;
  achat_id: number;
  date_engagement: string;
  quantite: number;
  prix_unitaire_reel: number | null;
  cout: number;
}
export interface ResultatConsommationMatiere {
  quantite_consommee: number;
  cout_total: number;
  nb_lots_utilises: number;
  detail: DetailAffectationConsommation[];
}
export interface ComparaisonConsommationLigne {
  categorie: CategorieEstimation;
  theorique: number;
  reel: number;
  ecart_quantite: number;
  ecart_pourcent: number | null;
}

export interface AchatReception { id: number; achat_id: number; date_reception: string; quantite_recue: number | null; reference_bl: string | null; notes: string | null; created_at: string; }
export interface AchatFacture { id: number; achat_id: number; date_facture: string; montant_ht: number; montant_tva: number | null; reference_facture: string | null; created_at: string; }
export interface AchatAffectation { id: number; achat_id: number; commande_id: number; quantite_affectee: number; date_affectation: string; notes: string | null; created_at: string; }
export interface Echeance { id: number; achat_id: number; achat_facture_id: number | null; date_echeance: string; montant: number; notes: string | null; created_at: string; }
export type StatutFactureFournisseur = "payee" | "partiel" | "en_retard" | "a_payer";
export interface FactureFournisseurDetaillee extends AchatFacture {
  achat_designation: string;
  paye: number;
  reste: number;
  statut: StatutFactureFournisseur;
  date_echeance: string | null;
}
export type StatutEcheance = "payee" | "partiellement_payee" | "en_retard" | "a_payer";
export interface EcheanceDetaillee {
  echeance_id: number; achat_id: number; fournisseur_nom: string; document: string;
  date_echeance: string; montant: number; paye: number; reste: number; statut: StatutEcheance;
}

export type TypePaiement = "reglement" | "avance";
export interface Paiement { id: number; fournisseur_id: number; type: TypePaiement; date_paiement: string; montant: number; mode: string | null; reference: string | null; notes: string | null; created_at: string; }
export type StatutAffectationPaiement = "totalement_affecte" | "partiellement_affecte" | "non_affecte";
export interface PaiementDetaille extends Paiement {
  fournisseur_nom: string;
  affecte: number;
  non_affecte: number;
  statut: StatutAffectationPaiement;
}

export type StatutFactureEcheance = "payee" | "partiel" | "en_retard" | "a_payer";
export interface FactureAvecEcheance {
  facture_id: number;
  reference_facture: string | null;
  fournisseur_nom: string;
  date_facture: string;
  date_echeance: string | null;
  montant_ttc: number;
  mode_prevu: string | null;
  paye: number;
  reste: number;
  statut: StatutFactureEcheance;
}
export interface PaiementAffectation { id: number; paiement_id: number; achat_facture_id: number; montant_affecte: number; created_at: string; }
export type StatutFacture = "payee" | "partiellement_payee" | "non_payee";
export interface StatutFactureResultat { facture_id: number; montant_ht: number; paye: number; reste_du: number; statut: StatutFacture; }

export interface CoutAchatResultat { achat_id: number; montant_engage: number; facture_reel: number; provisoire_restant: number; cout_suivi: number; }
export interface CoutCommandeResultat { commande_id: number; facture_reel: number; provisoire_restant: number; cout_suivi: number; nb_achats_directs: number; nb_affectations: number; }
export interface SyntheseCoutCommande extends CoutCommandeResultat { quantite_commercialisable: number; cout_unitaire: number | null; provisoire: boolean; }
export interface DetteFournisseur { fournisseur_id: number; engage: number; facture: number; paye: number; dette_restante: number; engagement_restant: number; credit_non_affecte: number; }

export interface SyntheseGlobaleFinance {
  total_a_payer: number;
  echeances_7j: number;
  echeances_30j: number;
  credit_non_affecte: number;
  cout_provisoire_total: number;
  nb_achats_provisoires: number;
}

export interface ReceptionProduction {
  id: number; commande_id: number; date_reception: string; quantite_recue: number;
  quantite_conforme: number; quantite_a_retoucher: number; quantite_retouchee_recuperee: number;
  quantite_rebut: number; notes: string | null; created_at: string; updated_at: string;
}

// ==================================================================================================
// ESTIMATIONS DE COÛT
// ==================================================================================================
export type CategorieEstimation = "matiere" | "fourniture" | "habillage" | "emballage" | "transport" | "confection" | "impression" | "retouche" | "autre";
export const CATEGORIES_ESTIMATION_LABELS: Record<CategorieEstimation, string> = {
  matiere: "Matière", fourniture: "Fourniture", habillage: "Habillage", emballage: "Emballage",
  transport: "Transport", confection: "Confection", impression: "Impression", retouche: "Retouche", autre: "Autre",
};
export type ModeCalculEstimation = "consommation_prix" | "unitaire_direct" | "montant_global";

export interface PosteCoutPredefini {
  id: number;
  categorie: CategorieEstimation;
  designation: string;
  unite_defaut: string | null;
  mode_calcul_defaut: ModeCalculEstimation;
  quantite_defaut: number | null;
  ajouter_automatiquement: number;
  ordre: number;
  actif: number;
  created_at: string;
}

export interface Estimation {
  id: number;
  article_id: number;
  quantite_prevue: number | null;
  created_at: string;
  updated_at: string;
}

export interface EstimationLigne {
  id: number;
  estimation_id: number;
  categorie: CategorieEstimation;
  designation: string;
  mode_calcul: ModeCalculEstimation;
  quantite: number | null;
  unite: string | null;
  prix_unitaire_ht: number | null;
  montant_global_ht: number | null;
  taux_tva: number | null;
  ordre: number;
  created_at: string;
  updated_at: string;
}
export interface EstimationLigneAvecCout extends EstimationLigne {
  cout_ht_piece: number;
  cout_ttc_piece: number;
}

export interface SyntheseEstimation {
  estimation_id: number;
  quantite_prevue: number | null;
  lignes: EstimationLigneAvecCout[];
  cout_ht_piece: number;
  cout_ttc_piece: number;
  budget_total_ht: number | null;
  budget_total_ttc: number | null;
  par_categorie: Record<string, number>;
}

export interface SimulationPrixResultat {
  prix_vente: number;
  coefficient: number | null;
  marge_unitaire: number;
  taux_marge: number | null;
  marge_totale_estimee: number | null;
}
export interface EstimationResume {
  article_id: number;
  estimation_id: number;
  quantite_prevue: number | null;
  nb_lignes: number;
  cout_ht_piece: number;
  budget_total_ht: number | null;
}
