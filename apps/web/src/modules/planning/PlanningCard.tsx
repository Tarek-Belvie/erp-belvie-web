import { PlanningArticle, PLANNING_STATUT_LABELS, PlanningStatut } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";
import { guessSwatch } from "../commandes/colorSwatch";

// La photo domine la carte — hiérarchie visuelle volontaire : PHOTO → NOM → STATUT → RÉFÉRENCE →
// COLORIS → QUANTITÉ. Aucune information secondaire ne doit rivaliser avec la photo.
const STATUT_COULEUR: Record<PlanningStatut, string> = {
  idee: "#9CA3AF",
  a_etudier: "#9CA3AF",
  prototype: "#8B5CF6",
  echantillon: "#D97706",
  a_modifier: "#DC2626",
  valide: "#0E9F6E",
  a_produire: "#0E9F6E",
  en_production: "#C2410C",
  production_terminee: "#0E9F6E",
  shooting_a_preparer: "#2563EB",
  pret_au_lancement: "#0E9F6E",
  lance: "#047857",
  annule: "#6B7280",
};

// Ordre du cycle de développement — sert à déterminer si la validation est "déjà atteinte",
// indépendamment du statut précis actuel. "Validé" et tout ce qui vient après (À produire, En
// production...) comptent comme validés ; tout ce qui précède ne l'est pas encore. Volontairement
// indépendant de la liaison au catalogue (produit créé/lié) — les deux notions ne se recoupent pas.
const ORDRE_CYCLE: PlanningStatut[] = [
  "idee", "a_etudier", "prototype", "echantillon", "a_modifier", "valide",
  "a_produire", "en_production", "production_terminee", "shooting_a_preparer", "pret_au_lancement", "lance", "annule",
];
const INDEX_VALIDE = ORDRE_CYCLE.indexOf("valide");
function validationAtteinte(statut: PlanningStatut): boolean {
  return ORDRE_CYCLE.indexOf(statut) >= INDEX_VALIDE;
}

// Le niveau de densité découle du nombre de mois affichés simultanément (voir PlanningPage) :
// moins de mois visibles = plus de détail par carte, plus de mois = vue globale compacte.
export type NiveauDensite = "detail" | "confortable" | "compact" | "global";

interface Props {
  item: PlanningArticle;
  onClick: () => void;
  vueCollection?: boolean;
  niveau?: NiveauDensite;
  dragHandleProps?: any;
}

const LIMITE_PASTILLES = 5;

export default function PlanningCard({ item, onClick, vueCollection, niveau = "detail", dragHandleProps }: Props) {
  const url = mediaUrl(item.photo_affichee);
  const couleur = STATUT_COULEUR[item.statut];
  const valide = validationAtteinte(item.statut);

  // La photo reste toujours l'élément principal, quel que soit le niveau — seules les informations
  // secondaires se réduisent progressivement.
  const afficherRef = !vueCollection && niveau !== "compact" && niveau !== "global";
  const afficherColoris = !vueCollection && niveau !== "global";
  const afficherBadge = !vueCollection;
  const afficherQuantite = !vueCollection;

  return (
    <div className={`planning-card planning-card--${niveau}`} onClick={onClick} {...(dragHandleProps || {})}>
      <div className="planning-card-photo">
        {url ? (
          <img src={url} alt={item.nom_affiche} className={valide ? "" : "planning-card-photo-non-validee"} />
        ) : (
          <div className="planning-card-photo-empty"><span>Aucune photo</span></div>
        )}
        {afficherBadge && (
          <span className="planning-card-badge" style={{ color: couleur, borderColor: couleur }}>
            {PLANNING_STATUT_LABELS[item.statut]}
          </span>
        )}
        {valide && <span className="planning-card-erp-badge" title="Validation obtenue">✓</span>}
      </div>
      <div className="planning-card-body">
        <div className="planning-card-nom">{item.nom_affiche}</div>
        {afficherRef && item.reference_affichee && <div className="planning-card-ref">{item.reference_affichee}</div>}
        {!vueCollection && (
          <div className="planning-card-footer">
            {afficherColoris && item.coloris.length > 0 && (
              <div className="planning-card-coloris" title={`${item.coloris.length} coloris : ${item.coloris.join(", ")}`}>
                {item.coloris.slice(0, LIMITE_PASTILLES).map((c, i) => (
                  <span key={i} className="planning-card-dot" style={{ background: guessSwatch(c) }} title={c} />
                ))}
                {item.coloris.length > LIMITE_PASTILLES && (
                  <span className="planning-card-coloris-plus">+{item.coloris.length - LIMITE_PASTILLES}</span>
                )}
              </div>
            )}
            {afficherQuantite && item.quantite_previsionnelle != null && (
              <span className="planning-card-qte">{item.quantite_previsionnelle} pcs</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
