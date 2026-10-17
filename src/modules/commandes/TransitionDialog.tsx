import { useState } from "react";

interface Props {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  requiresMotif?: boolean;
  motifLabel?: string;
  existingMotif?: string | null;
  onConfirm: (motif?: string) => Promise<void>;
  onCancel: () => void;
}

export default function TransitionDialog({
  title, message, confirmLabel, danger, requiresMotif, motifLabel, existingMotif, onConfirm, onCancel,
}: Props) {
  const [motif, setMotif] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleConfirm() {
    if (requiresMotif && !motif.trim()) {
      setError("Le motif est obligatoire.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onConfirm(requiresMotif ? motif.trim() : undefined);
    } catch (err: any) {
      setError(err?.message || "Une erreur est survenue.");
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-veil">
      <div className="modal small">
        <div className="modal-head">
          <h3 style={{ fontFamily: "inherit" }}>{title}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>

        <p style={{ fontSize: 13.5, color: "#4B4B43", whiteSpace: "pre-line" }}>{message}</p>

        {existingMotif !== undefined && (
          <p className="blocage-tag" style={{ display: "block", marginBottom: 10 }}>
            Motif actuel : {existingMotif || "—"}
          </p>
        )}

        {requiresMotif && (
          <label style={{ display: "block", marginBottom: 10 }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, color: "#4B4B43", display: "block", marginBottom: 5 }}>
              {motifLabel ?? "Motif"} *
            </span>
            <textarea
              rows={3}
              autoFocus
              value={motif}
              onChange={(e) => setMotif(e.target.value)}
              style={{ width: "100%", border: "1px solid #D8D9D0", borderRadius: 7, padding: "7px 8px", fontSize: 13.5, fontFamily: "inherit" }}
              placeholder="Précisez la raison..."
            />
          </label>
        )}

        {error && <p style={{ background: "#FBEAE6", color: "#7A2818", padding: "8px 10px", borderRadius: 8, fontSize: 12.5 }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={submitting}>Annuler</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={handleConfirm} disabled={submitting}>
            {submitting ? "En cours..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
