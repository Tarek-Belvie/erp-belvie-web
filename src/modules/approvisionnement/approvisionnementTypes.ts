// Types, libellés et styles partagés par les écrans du module Approvisionnement.
//
// Pourquoi un fichier à part : la liste et la page de détail parlent des mêmes objets. Dupliquer
// les types dans chaque écran, c'est accepter qu'ils divergent le jour où le moteur de calcul
// renverra un champ de plus — et l'écran qui ne l'a pas déclaré ne l'affichera jamais.
//
// Les types décrivent EXACTEMENT ce que renvoie le processus principal (electron/ipc/besoins.js).
// Aucun calcul ici : tout ce qui est chiffré vient du moteur, jamais de l'interface.

export type LigneBesoin = {
  composant_cle: string;
  composant_nom: string;
  type: "matiere" | "fourniture";
  catalogue_id: number | null;
  cible_cle: string;
  cible_libelle: string;
  reference: string | null;
  unite: string | null;
  regles: string[];
  couleurs_produit: string[];
  quantite_production: number;
  besoin_brut: number;
  perte_pourcent: number;
  quantite_necessaire: number;
  quantite_commandee: number;
  quantite_recue: number;
  reste_a_recevoir: number;
  reste_a_commander: number;
  recu_excedentaire: number;
  anomalies: string[];
  /** Part de la production pour laquelle aucune consommation n'a pu être retenue. */
  quantite_production_non_couverte: number;
  /** Les quantités de cette ligne ne couvrent pas toute la production : jamais un total définitif. */
  calcul_incomplet: boolean;
  /** Rien n'a pu être calculé : afficher « 0 » se lirait comme « rien à acheter ». */
  calcul_impossible: boolean;
  couleurs_non_couvertes: string[];
  tailles_non_couvertes: string[];
  /** Quantité déjà posée sur un bon de commande EN BROUILLON. Jamais fondue dans « commandé » :
   *  un brouillon n'engage rien, et confondre les deux ferait disparaître des écrans un
   *  brouillon oublié. */
  quantite_en_preparation: number;
  /** Ce qu'il reste à poser sur un bon, une fois les brouillons déduits. C'est cette quantité
   *  qui évite de commander deux fois la même chose. */
  reste_a_preparer: number;
};

/** D'où vient la recette technique utilisée pour ce calcul. */
export type RecetteInfo = {
  source: "fiche" | "figee" | "figee_illisible";
  fiche_revision_figee: number | null;
  fiche_revision_actuelle: number | null;
  figee_le: string | null;
  figee_motif: string | null;
  revision_en_retard: boolean;
  illisible_raison: string | null;
};

export type ComposantHorsAppro = {
  cle: string;
  type: "matiere" | "fourniture";
  nom: string;
  unite: string | null;
  motif: string | null;
  precision: string | null;
};

export type Resultat = {
  commande: {
    id: number; numero: string | null; statut: string; quantite_totale: number;
    date_lancement: string; date_fin_prevue: string;
  };
  article: {
    id: number; designation: string | null; produit: string | null;
    reference: string | null; saison: string | null; photo_path: string | null;
  };
  fiche: { id: number; statut: string } | null;
  recette: RecetteInfo;
  production_reelle: {
    couleur_id: number; couleur_nom: string | null;
    taille_id: number | null; taille_nom: string | null; quantite: number;
  }[];
  simulation: boolean;
  lignes: LigneBesoin[];
  totaux: {
    lignes: number; lignes_en_anomalie: number; composants: number;
    quantite_production: number; a_commander: number;
    lignes_incompletes: number; lignes_impossibles: number;
    a_preparer: number; lignes_en_preparation: number;
  };
  anomalies: string[];
  calcul_incomplet: boolean;
  libelles_anomalies: Record<string, string>;
  hors_approvisionnement: ComposantHorsAppro[];
  engagements_non_rattaches: {
    achat_id: number; designation: string; categorie: string; couleur: string | null;
    unite: string | null; quantite_affectee: number; quantite_recue: number; raison: string;
  }[];
};

/**
 * La commande telle que la liste en a besoin. Volontairement RÉDUITE : les champs viennent de
 * `api.commandes.list()`, l'API du module Commandes de production, qui ne nous appartient pas.
 * N'en exiger que le minimum, c'est garantir qu'une évolution de ce module ne casse pas cet écran.
 */
export type CommandeAppro = {
  id: number;
  numero: string | null;
  statut: string;
  quantite_totale: number;
  date_lancement: string;
  date_fin_prevue: string;
  priorite: string;
  article_id: number;
  produit: string | null;
  saison: string | null;
  reference: string | null;
  reference_production: string | null;
  photo_path: string | null;
};

/** Ce que renvoie `api.approvisionnement.etatsApprovisionnement([...])`, une entrée par commande. */
export type EtatAppro = {
  commande_id: number;
  erreur: string | null;
  statut: StatutAppro;
  article_designation: string | null;
  nb_lignes: number;
  nb_lignes_a_commander: number;
  nb_lignes_a_recevoir: number;
  nb_lignes_en_anomalie: number;
  couverture_pourcent: number | null;
  engagements_non_rattaches: number;
  calcul_incomplet: boolean;
  nb_lignes_incompletes: number;
  recette_source: "fiche" | "figee" | "figee_illisible" | null;
  revision_en_retard: boolean;
};

export type StatutAppro =
  | "sans_fiche" | "sans_composant" | "a_completer"
  | "a_commander" | "a_recevoir" | "complet" | "erreur";

export const LIBELLES_STATUT_APPRO: Record<StatutAppro, string> = {
  sans_fiche: "Pas de fiche technique",
  sans_composant: "Nomenclature vide",
  a_completer: "Fiche à compléter",
  a_commander: "À commander",
  a_recevoir: "En attente de réception",
  complet: "Approvisionné",
  erreur: "Calcul impossible",
};

export const EXPLICATIONS_STATUT_APPRO: Record<StatutAppro, string> = {
  sans_fiche: "L'article n'a pas de fiche technique : aucun besoin ne peut être calculé.",
  sans_composant: "La fiche technique ne contient ni matière ni fourniture.",
  a_completer: "Des consommations, unités ou coloris manquent dans la fiche technique.",
  a_commander: "Il reste des quantités à commander chez un fournisseur.",
  a_recevoir: "Tout est commandé ; une partie n'est pas encore réceptionnée.",
  complet: "Tout est commandé et réceptionné.",
  erreur: "Le calcul des besoins a échoué pour cette commande.",
};

/** Ordre de gravité — sert au tri « par état d'approvisionnement », du plus urgent au plus sain. */
export const GRAVITE_STATUT_APPRO: Record<StatutAppro, number> = {
  erreur: 0, sans_fiche: 1, sans_composant: 2, a_completer: 3,
  a_commander: 4, a_recevoir: 5, complet: 6,
};

export const PRIORITES_ORDRE: Record<string, number> = { haute: 0, normale: 1, faible: 2 };
export const LIBELLES_PRIORITE: Record<string, string> = {
  haute: "Haute", normale: "Normale", faible: "Faible",
};

export const LIBELLES_STATUT_COMMANDE: Record<string, string> = {
  validee: "Validée", en_production: "En production", controle_qualite: "Contrôle qualité",
};

/**
 * Statuts pour lesquels l'approvisionnement a un sens : la production est décidée, mais pas encore
 * terminée. Un brouillon peut changer du tout au tout ; une commande terminée n'a plus rien à
 * acheter.
 */
export const STATUTS_ELIGIBLES = ["validee", "en_production", "controle_qualite"];

export const LIBELLES_REGLES: Record<string, string> = {
  couleur: "Consommation propre à la couleur",
  taille: "Consommation par taille",
  fixe: "Consommation fixe",
};
export const ABREGE_REGLES: Record<string, string> = { couleur: "couleur", taille: "taille", fixe: "fixe" };

/**
 * Forme courte de chaque anomalie, pour la pastille posée sur la ligne. Un « à compléter »
 * identique partout obligeait à survoler chaque ligne pour savoir ce qui manquait.
 */
export const ABREGE_ANOMALIES: Record<string, string> = {
  consommation_absente: "consommation manquante",
  consommation_invalide: "consommation inutilisable",
  consommation_taille_absente: "consommation par taille incomplète",
  correspondance_couleur_absente: "coloris à définir",
  coloris_non_choisi: "coloris non choisi",
  catalogue_non_relie: "non relié au catalogue",
  unite_absente: "unité manquante",
  perte_invalide: "perte négative, comptée à zéro",
};

/** Où se corrige chaque anomalie. Connaître le défaut sans savoir où le réparer ne sert qu'à moitié. */
export const OU_CORRIGER: Record<string, string> = {
  consommation_absente: "champ « Consommation » de la ligne, onglet Matières ou Nomenclature",
  consommation_invalide: "champ « Consommation » de la ligne : la valeur saisie est négative ou nulle",
  consommation_taille_absente: "consommation taille par taille de la ligne",
  correspondance_couleur_absente: "correspondance des coloris de la ligne",
  coloris_non_choisi: "correspondance de la ligne : la couleur est déclarée, le coloris reste à choisir",
  catalogue_non_relie: "liaison de la ligne au catalogue matières ou fournitures",
  unite_absente: "champ « Unité » de la ligne, onglet Matières ou Nomenclature",
  perte_invalide: "champ « Perte » de la ligne : un pourcentage négatif est ignoré",
};

/**
 * Affichage des unités. `ft_matieres.unite` et `achats.unite` sont contraintes à kg/m/piece/lot
 * par le schéma ; `ft_accessoires.unite` est du texte libre. Seuls les codes connus sont donc
 * traduits, et tout le reste passe tel quel : une unité saisie à la main ne doit jamais être
 * réécrite par l'affichage.
 */
const UNITES_AFFICHEES: Record<string, string> = { piece: "pcs", lot: "lot", kg: "kg", m: "m" };
export function uniteAffichee(unite: string | null | undefined): string | null {
  if (!unite) return null;
  return UNITES_AFFICHEES[unite] || unite;
}

/** Les quatre motifs possibles pour un composant qui ne fait l'objet d'aucun achat. */
export const LIBELLES_HORS_APPRO: Record<string, string> = {
  faconnier: "Fourni par le façonnier",
  client: "Fourni par le client",
  descriptif: "Élément purement descriptif",
  autre: "Autre motif",
};

export function nombre(valeur: number | null | undefined, unite?: string | null) {
  if (valeur == null) return "—";
  const texte = Number(valeur).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
  const u = uniteAffichee(unite);
  return u ? `${texte} ${u}` : texte;
}

/** "2026-10-29" -> "29/10/2026". Aucune conversion de fuseau : c'est une date, pas un instant. */
export function dateFr(iso: string | null | undefined) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).slice(0, 10).split("-");
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

/** Jours restants avant la date de livraison — négatif si la date est passée. */
export function joursRestants(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const cible = new Date(String(iso).slice(0, 10) + "T00:00:00");
  if (isNaN(cible.getTime())) return null;
  const aujourdHui = new Date();
  aujourdHui.setHours(0, 0, 0, 0);
  return Math.round((cible.getTime() - aujourdHui.getTime()) / 86400000);
}

/**
 * Normalise une chaîne pour la recherche : sans accents, sans casse, espaces réduits. Taper
 * « zipee » doit trouver « SWEAT À CAPUCHE ZIPÉE ».
 */
export function normaliserRecherche(texte: string | null | undefined): string {
  return String(texte == null ? "" : texte)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Adapte une commande brute de `api.commandes.list()`. Les noms de champs sont lus avec plusieurs
 * replis : si le module Commandes renomme un champ un jour, la liste perd au pire un libellé,
 * elle ne se vide pas.
 */
export function adapterCommande(brut: any): CommandeAppro | null {
  const id = Number(brut && brut.id);
  if (!Number.isFinite(id)) return null;
  return {
    id,
    numero: brut.numero ?? null,
    statut: String(brut.statut || ""),
    quantite_totale: Number(brut.quantite_totale) || 0,
    date_lancement: brut.date_lancement || "",
    date_fin_prevue: brut.date_fin_prevue || "",
    priorite: String(brut.priorite || "normale"),
    article_id: Number(brut.article_id) || 0,
    produit: brut.produit ?? brut.article_produit ?? null,
    saison: brut.saison ?? brut.article_saison ?? null,
    reference: brut.article_reference_principale ?? brut.article_reference ?? brut.reference_principale ?? null,
    reference_production: brut.reference_production ?? null,
    photo_path: brut.photo_thumb_path ?? brut.photo_path ?? brut.article_photo_path ?? null,
  };
}

// ------------------------------------------------------------------------------------------------
// Styles du module — injectés UNE SEULE FOIS par la page d'accueil du module, pas par chaque écran.
// ------------------------------------------------------------------------------------------------
export const STYLES_APPRO = `
/* La barre d'action de la sélection de productions. Elle reste au-dessus du tableau pendant le
   défilement : sur une longue liste, cocher en bas et devoir remonter pour agir est une corvée. */
.appro-barre-selection {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  margin-bottom: 10px; padding: 9px 12px;
  background: #EEF4EF; border: 1px solid #CFE0D4; border-radius: 8px;
  font-size: 13px; color: #27402F;
}
.appro-liste thead th:first-child, .appro-liste tbody td:first-child { text-align: center; }
.appro-liste input[type="checkbox"] { width: 15px; height: 15px; cursor: pointer; accent-color: #1F3A2E; }

.appro-grille { width: 100%; border-collapse: collapse; }
.appro-grille th {
  background: #1F3A2E; color: #fff; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; padding: 9px 10px; text-align: center; white-space: nowrap; position: sticky; top: 0;
}
.appro-grille th.g, .appro-grille td.g { text-align: left; }
.appro-grille th.n, .appro-grille td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.appro-grille td { font-size: 12.5px; padding: 8px 10px; text-align: center; border-bottom: 1px solid #E4E6DF; }
.appro-grille tbody tr:nth-child(even) { background: #FAFBF7; }
.appro-grille tbody tr.anomalie { background: #FDF6EC; }
.appro-grille tbody tr.anomalie td { border-bottom-color: #EFD9B4; }
.appro-grille .sous { font-size: 11px; color: var(--v2-text-3, #6B6B62); display: block; margin-top: 1px; }

.appro-puce {
  display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 9px;
  background: #EEF0EA; color: #4B4B43; margin-left: 5px; white-space: nowrap;
}
.appro-puce.alerte { background: #FBEAE6; color: #9A3412; }
/* Le calcul incomplet a sa propre couleur : ce n'est pas une donnée manquante de plus, c'est un
   avertissement sur la LECTURE du chiffre voisin. */
.appro-puce.incomplet { background: #FEF3C7; color: #8A5A05; font-weight: 700; }
.appro-reste-fort { font-weight: 700; }

.appro-grille tbody tr.incomplet { background: #FFFBEB; }
.appro-grille tbody tr.incomplet td { border-bottom-color: #EFD9A4; }
/* La cellule numérique est en nowrap pour que les nombres ne se coupent pas. La note, elle, doit
   revenir à la ligne : sinon elle élargit la colonne et pousse « Reste à commander » hors écran. */
.appro-incomplet-note {
  display: block; margin-top: 2px; font-size: 11px; color: #8A5A05;
  white-space: normal; max-width: 190px; margin-left: auto; line-height: 1.35;
}

.appro-bandeau-recette {
  display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap;
  font-size: 12px; color: var(--v2-text-3, #6B6B62);
  border: 1px solid #E0E2DA; border-radius: 8px; padding: 8px 12px; background: #FAFBF7;
}
.appro-bandeau-recette.retard { background: #FEF3C7; border-color: #EFD9A4; color: #7C4A03; }
.appro-bandeau-recette strong { color: var(--v2-text, #23241F); }

.appro-bloc-alerte {
  background: #FDF6EC; border: 1px solid #EFD9B4; border-radius: 8px; padding: 11px 14px;
  font-size: 12.5px; color: #7C4A03; line-height: 1.55;
}

/* --- Liste des articles à approvisionner ----------------------------------------------------- */
.appro-liste td { vertical-align: middle; }
.appro-article-nom { font-weight: 700; font-size: 13.5px; line-height: 1.25; }
.appro-article-ref {
  font-family: 'IBM Plex Mono', monospace; font-size: 11.5px; color: var(--v2-text-2, #5B5C52);
  display: block; margin-top: 2px;
}
.appro-article-meta { font-size: 11.5px; color: var(--v2-text-3, #8A8A82); display: block; margin-top: 2px; }
.appro-echeance-retard { color: #B42318; font-weight: 600; }
.appro-echeance-proche { color: #9A3412; font-weight: 600; }

.appro-etat {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 10px; border-radius: 999px;
  font-size: 11.5px; font-weight: 600; border: 1px solid transparent; white-space: nowrap;
}
.appro-etat-complet      { background: #E7F4EC; color: #116B43; border-color: #BFE3CE; }
.appro-etat-a_recevoir   { background: #E8EEFA; color: #1E40AF; border-color: #C4D2F2; }
.appro-etat-a_commander  { background: #FEF3C7; color: #8A5A05; border-color: #EFD9A4; }
.appro-etat-a_completer  { background: #FBEAE6; color: #9A3412; border-color: #F3CFC4; }
.appro-etat-sans_fiche   { background: #FDE8E8; color: #B42318; border-color: #F4C8C8; }
.appro-etat-sans_composant { background: #EEF0EA; color: #4B4B43; border-color: #DEE1D7; }
.appro-etat-erreur       { background: #FDE8E8; color: #B42318; border-color: #F4C8C8; }
.appro-etat-chargement   { background: #F2F3EE; color: #8A8A82; border-color: #E4E6DC; }
.appro-etat-sous { font-size: 11px; color: var(--v2-text-3, #8A8A82); display: block; margin-top: 3px; }

/* display:block indispensable : c'est un <span>, et une barre de progression inline n'a pas de
   hauteur — elle serait invisible, et la légende parlerait d'un indicateur absent. */
.appro-barre {
  display: block; width: 150px; height: 4px; border-radius: 3px;
  background: #E8EAE2; margin-top: 6px; overflow: hidden;
}
.appro-barre span { display: block; height: 100%; background: #0E9F6E; border-radius: 3px; }

/* --- Simulation ------------------------------------------------------------------------------ */
.appro-sim-grille { display: grid; gap: 7px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
.appro-sim-case { border: 1px solid #E0E2DA; border-radius: 7px; padding: 7px 9px; background: #fff; }
.appro-sim-case label { font-size: 11px; color: var(--v2-text-3, #6B6B62); display: block; margin-bottom: 3px; }
.appro-sim-case input { width: 100%; height: 28px; border: 1px solid #D8D9D0; border-radius: 5px; padding: 0 7px; font-size: 13px; }
`;

// ================================================================================================
// MP2 — préparation des bons de commande matières et fournitures
// ================================================================================================

/** Un fournisseur proposé pour une ligne : soit par un tarif saisi, soit par l'historique. */
export type FournisseurPropose = {
  fournisseur_id: number;
  fournisseur_nom: string;
  /** null quand le fournisseur vient de l'historique : aucun prix n'est reconstitué. */
  prix_ht: number | null;
  unite_tarif: string | null;
  origine: "tarif" | "historique";
  nb_achats: number;
  depuis?: string | null;
  derniere_fois?: string | null;
};

export type Blocage = { code: string; message: string; ou_corriger: string };

/** Une ligne d'achat candidate : le même composant, le même coloris, sur une ou plusieurs
 *  productions. Les quantités sont les sommes ; `productions` garde le détail. */
export type LigneRegroupee = {
  cle: string;
  type: "matiere" | "fourniture";
  catalogue_id: number | null;
  catalogue_non_relie: boolean;
  designation: string;
  cible_cle: string;
  cible_libelle: string;
  reference: string | null;
  unite_fiche: string | null;
  /** Unité d'ACHAT (kg/m/piece/lot), ou null quand elle n'a pas pu être déduite sans risque. */
  unite: string | null;
  unite_a_choisir: boolean;
  anomalies: string[];
  productions: {
    commande_id: number;
    numero: string | null;
    article_designation: string | null;
    quantite_necessaire: number;
    quantite_commandee: number;
    quantite_en_preparation: number;
    reste_a_commander: number;
    /** Part de cette production dans la ligne. C'est le backend qui s'en sert pour répartir. */
    poids: number;
  }[];
  quantite_necessaire: number;
  quantite_commandee: number;
  quantite_en_preparation: number;
  reste_a_commander: number;
  reste_a_preparer: number;
  quantite_inconnue: boolean;
  a_preparer: boolean;
  coloris_requis: boolean;
  coloris_connu: boolean;
  coloris_manquant: boolean;
  bloquant_validation: Blocage[];
  fournisseurs_proposes: FournisseurPropose[];
  fournisseur_propose_id: number | null;
  prix_propose: number | null;
  nb_productions: number;
};

export type Regroupement = {
  productions: {
    commande_id: number;
    numero: string | null;
    statut: string | null;
    article_designation: string | null;
    reference: string | null;
    quantite_totale: number | null;
    date_fin_prevue: string | null;
    recette: RecetteInfo | null;
    nb_lignes: number;
  }[];
  lignes: LigneRegroupee[];
  erreurs: { commande_id: number; message: string }[];
  totaux: {
    nb_productions: number;
    nb_lignes: number;
    nb_a_preparer: number;
    nb_coloris_manquants: number;
    nb_quantite_inconnue: number;
    nb_unite_a_choisir: number;
    nb_catalogue_non_relie: number;
  };
};

export type BonMpResume = {
  id: number;
  numero: string;
  statut: string;
  fournisseur_id: number;
  fournisseur: string | null;
  date_commande: string | null;
  date_livraison_souhaitee: string | null;
  nb_lignes: number;
  total_ht: number;
  lignes_sans_prix: number;
  nb_productions: number;
};

export type LigneBon = {
  id: number;
  bc_mp_id: number;
  type: "matiere" | "fourniture";
  matiere_catalogue_id: number | null;
  accessoire_catalogue_id: number | null;
  designation: string;
  reference: string | null;
  couleur: string | null;
  unite: string | null;
  unite_fiche: string | null;
  conditionnement_libelle: string | null;
  conditionnement_quantite: number;
  nombre_conditionnements: number | null;
  quantite: number;
  prix_unitaire_ht: number | null;
  montant_ht: number | null;
  ordre: number;
  productions: { commande_id: number; commande_numero: string | null; quantite_affectee: number }[];
};

export type BonMp = {
  id: number;
  numero: string;
  statut: string;
  fournisseur_id: number;
  fournisseur_nom_actuel: string | null;
  date_commande: string | null;
  date_livraison_souhaitee: string | null;
  conditions_paiement: string | null;
  notes: string | null;
  observations_internes: string | null;
  lignes: LigneBon[];
  total_ht: number;
  lignes_sans_prix: number;
  commandes_servies: { commande_id: number; numero: string | null; statut: string | null }[];
};

/** Les quatre unités que le schéma des achats accepte. L'unité de la fiche reste affichée à côté :
 *  « bobine » n'est pas une unité d'achat, mais c'est ce que l'atelier lit sur la fiche. */
export const UNITES_ACHAT: { cle: string; label: string }[] = [
  { cle: "m", label: "mètre" },
  { cle: "kg", label: "kilo" },
  { cle: "piece", label: "pièce" },
  { cle: "lot", label: "lot" },
];

export const LIBELLES_STATUT_BON: Record<string, string> = {
  brouillon: "Brouillon",
  valide: "Validé",
  envoye: "Envoyé",
  solde: "Soldé",
  annule: "Annulé",
};

export function euros(valeur: number | null | undefined) {
  if (valeur == null) return "—";
  return Number(valeur).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

/**
 * L'arrondi au conditionnement, proposé et jamais imposé — votre décision 2 de MP1.
 *
 * La même règle existe dans electron/ipc/preparationBcMp.js, qui fait foi. Celle-ci ne sert qu'à
 * AFFICHER la proposition pendant la saisie, sans aller-retour ; rien de ce qu'elle calcule n'est
 * enregistré. Si les deux divergeaient un jour, c'est la quantité saisie qui part en base, pas
 * cette estimation.
 */
export function proposerArrondi(quantite: number, taille: number) {
  if (!(quantite > 0) || !(taille > 0)) return null;
  const exact = quantite / taille;
  const arrondi = Math.ceil(exact - 0.0001);
  const quantiteArrondie = Math.round((arrondi * taille + Number.EPSILON) * 1000) / 1000;
  return {
    nombre_exact: Math.round((exact + Number.EPSILON) * 1000) / 1000,
    nombre_arrondi: arrondi,
    quantite_arrondie: quantiteArrondie,
    supplement: Math.round((quantiteArrondie - quantite + Number.EPSILON) * 1000) / 1000,
    deja_juste: Math.abs(arrondi - exact) < 0.0001,
  };
}

/** Styles propres aux écrans de bons MP. Injectés par la page du module, à côté de STYLES_APPRO :
 *  un second bloc évite de rouvrir le gabarit existant, où un accent grave égaré suffirait à
 *  empêcher l'application de démarrer. */
export const STYLES_BONS_MP = `
.bcmp-etapes { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.bcmp-etape {
  display: inline-flex; align-items: center; gap: 7px; font-size: 12.5px; color: var(--v2-text-3, #8A8A82);
}
.bcmp-etape b {
  display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px;
  border-radius: 50%; background: #E8EAE2; color: #5B5C52; font-size: 11.5px; font-weight: 700;
}
.bcmp-etape.active { color: var(--v2-text, #23241F); font-weight: 600; }
.bcmp-etape.active b { background: #1F3A2E; color: #fff; }
.bcmp-etape-sep { color: #C9CAC0; }

.bcmp-productions { display: grid; gap: 7px; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); }
.bcmp-prod {
  display: flex; gap: 9px; align-items: flex-start; border: 1px solid #E0E2DA; border-radius: 8px;
  padding: 9px 11px; background: #fff; cursor: pointer; text-align: left;
}
.bcmp-prod.choisie { border-color: #1F3A2E; background: #F3F7F4; box-shadow: 0 0 0 1px #1F3A2E inset; }
.bcmp-prod input { margin-top: 2px; }
.bcmp-prod-nom { font-weight: 700; font-size: 13px; line-height: 1.25; }
.bcmp-prod-meta { font-size: 11.5px; color: var(--v2-text-3, #8A8A82); display: block; margin-top: 2px; }

.bcmp-saisie { width: 92px; height: 27px; border: 1px solid #C9CAC0; border-radius: 5px;
  padding: 0 6px; font-size: 12.5px; text-align: right; font-variant-numeric: tabular-nums; }
.bcmp-saisie.large { width: 120px; text-align: left; }
.bcmp-saisie.etroite { width: 66px; }
.bcmp-select { height: 27px; border: 1px solid #C9CAC0; border-radius: 5px; padding: 0 5px;
  font-size: 12.5px; background: #fff; max-width: 190px; }
.bcmp-select.manquant { border-color: #D97706; background: #FFFBEB; }

.bcmp-grille tbody tr.exclue { opacity: .5; }
.bcmp-grille tbody tr.exclue .bcmp-saisie, .bcmp-grille tbody tr.exclue .bcmp-select { background: #F5F5F1; }
.bcmp-detail-prod { background: #F7F8F3 !important; }
.bcmp-detail-prod td { padding: 7px 14px 10px; font-size: 12px; color: var(--v2-text-2, #5B5C52);
  /* La grille centre ses cellules ; ce bloc est du texte courant, il se lit a gauche. */
  text-align: left; }
.bcmp-detail-prod ul { margin: 4px 0 0; padding-left: 18px; }
.bcmp-detail-prod li { margin: 2px 0; }

.bcmp-lien-detail { background: none; border: none; padding: 0; font-size: 12px; color: #1F3A2E;
  text-decoration: underline; cursor: pointer; }

.bcmp-recap { border: 1px solid #E0E2DA; border-radius: 10px; background: #fff; padding: 14px 16px; margin-top: 16px; }
.bcmp-recap h4 { margin: 0 0 10px; font-size: 13.5px; }
.bcmp-recap-ligne {
  display: flex; align-items: center; gap: 12px; padding: 8px 0; border-top: 1px solid #F0F1EC;
  font-size: 12.5px; flex-wrap: wrap;
}
.bcmp-recap-ligne:first-of-type { border-top: none; }
.bcmp-recap-nom { font-weight: 700; min-width: 170px; }
.bcmp-recap-total { margin-left: auto; font-variant-numeric: tabular-nums; font-weight: 700; }

.bcmp-arrondi { background: none; border: 1px dashed #C9CAC0; border-radius: 5px; font-size: 11px;
  padding: 2px 6px; cursor: pointer; color: #5B5C52; white-space: nowrap; }
.bcmp-arrondi:hover { border-color: #1F3A2E; color: #1F3A2E; }

.bcmp-vide { text-align: center; padding: 38px 20px; color: var(--v2-text-3, #8A8A82); font-size: 13px; }
.bcmp-statut {
  display: inline-block; padding: 2px 9px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
  border: 1px solid transparent; white-space: nowrap;
}
.bcmp-statut-brouillon { background: #EEF0EA; color: #4B4B43; border-color: #DEE1D7; }
.bcmp-statut-valide { background: #E7F4EC; color: #116B43; border-color: #BFE3CE; }
.bcmp-statut-envoye { background: #E8EEFA; color: #1E40AF; border-color: #C4D2F2; }
.bcmp-statut-solde { background: #E7F4EC; color: #116B43; border-color: #BFE3CE; }
.bcmp-statut-annule { background: #FDE8E8; color: #B42318; border-color: #F4C8C8; }
`;
