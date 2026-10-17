interface Props {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel = "Confirmer", cancelLabel = "Annuler", danger, onConfirm, onCancel }: Props) {
  return (
    <div className="modal-veil">
      <div className="modal small">
        <div className="modal-head">
          <h3 style={{ fontFamily: "inherit" }}>{title}</h3>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>
        <p style={{ fontSize: 13.5, color: "#4B4B43", whiteSpace: "pre-line" }}>{message}</p>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel}>{cancelLabel}</button>
          <button className={`btn ${danger ? "danger" : "primary"}`} onClick={onConfirm}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
