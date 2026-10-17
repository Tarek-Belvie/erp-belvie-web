import { useState } from "react";
import { Commande, ListeValeur } from "../../shared/types";
import { mediaUrl } from "./uiHelpers";
import RepartitionTable from "./RepartitionTable";
import DetailField from "./DetailField";

interface Props {
  commande: Commande;
  operateurActif: ListeValeur | null;
  onCancel: () => void;
  onLaunched: () => void;
}

const CHECKLIST_ITEMS = [
  "Article et référence vérifiés",
  "Photo conforme",
  "Répartition couleurs / tailles vérifiée",
  "Quantités validées",
  "Atelier confirmé",
  "Responsable confirmé",
  "Instructions vérifiées",
];

export default function LancerProductionScreen({ commande, operateurActif, onCancel, onLaunched }: Props) {
  const [checked, setChecked] = useState<boolean[]>(() => CHECKLIST_ITEMS.map(() => false));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const allChecked = checked.every(Boolean);
  const hasQuantite = commande.quantite_totale > 0;
  const canLaunch = !!operateurActif && hasQuantite && allChecked && !submitting;

  function toggle(i: number) {
    setChecked((prev) => prev.map((v, idx) => (idx === i ? !v : v)));
  }

  async function handleLaunch() {
    setSubmitting(true);
    setError(null);
    try {
      await window.api.commandes.lancerProduction(commande.id);
      onLaunched();
    } catch (err: any) {
      setError(err?.message || "Erreur lors du lancement.");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-veil">
      <div className="modal wide">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Lancer la production — dernière vérification</p>
            <h3>{commande.numero} — {commande.reference_production}</h3>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>

        <div className="article-summary">
          <div className="photo-preview-box" style={{ width: 88, height: 88 }}>
            {commande.photo_thumb_path ? (
              <img src={mediaUrl(commande.photo_thumb_path)!} alt={commande.produit} />
            ) : (
              <span className="photo-preview-empty">Aucune photo</span>
            )}
          </div>
          <div className="article-summary-grid">
            <DetailField label="Référence principale">{commande.article_reference_principale}</DetailField>
            <DetailField label="Référence de production">{commande.reference_production}</DetailField>
            <DetailField label="Type">
              {commande.type_production === "reassort" ? `Réassort R${String(commande.numero_reassort).padStart(2, "0")}` : "Nouvel article"}
            </DetailField>
            <DetailField label="Produit">{commande.produit}</DetailField>
            <DetailField label="Saison">{commande.saison ?? "—"}</DetailField>
            <DetailField label="Année">{commande.annee_collection ?? "—"}</DetailField>
            <DetailField label="Rayon">{commande.rayon ?? "—"}</DetailField>
            <DetailField label="Responsable">{commande.responsable}</DetailField>
            <DetailField label="Atelier">{commande.atelier}</DetailField>
          </div>
        </div>

        <div style={{ margin: "16px 0" }}>
          <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 8px" }}>Répartition couleurs × tailles</p>
          <RepartitionTable lignes={commande.lignes ?? []} />
          <p style={{ marginTop: 8, fontSize: 13.5 }}>Quantité totale : <strong>{commande.quantite_totale}</strong> pièces</p>
        </div>

        {commande.commentaires && (
          <div style={{ margin: "0 0 16px" }}>
            <p style={{ fontWeight: 600, fontSize: 13, margin: "0 0 4px" }}>Commentaires</p>
            <p style={{ fontSize: 13.5, color: "#4B4B43" }}>{commande.commentaires}</p>
          </div>
        )}

        <div className="besoins-placeholder">Besoins matières — module non encore disponible</div>

        <div className="checklist">
          {CHECKLIST_ITEMS.map((item, i) => (
            <label key={i} className="checklist-item">
              <input type="checkbox" checked={checked[i]} onChange={() => toggle(i)} />
              {item}
            </label>
          ))}
        </div>

        {!operateurActif && <p className="hint" style={{ color: "#C0392B" }}>Aucun opérateur actif : impossible de lancer la production.</p>}
        {!hasQuantite && <p className="hint" style={{ color: "#C0392B" }}>La quantité totale doit être supérieure à zéro.</p>}
        {error && <p style={{ background: "#FBEAE6", color: "#7A2818", padding: "8px 10px", borderRadius: 8, fontSize: 12.5 }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={submitting}>Retour</button>
          <button className="btn primary" onClick={handleLaunch} disabled={!canLaunch}>
            {submitting ? "Lancement..." : "Lancer la production"}
          </button>
        </div>
      </div>
    </div>
  );
}
