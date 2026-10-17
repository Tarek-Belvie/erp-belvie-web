import { useState } from "react";
import { ListeType, ListeValeur } from "../../shared/types";

interface Props {
  label: string;
  type: ListeType;
  options: ListeValeur[]; // déjà filtrées par l'appelant (actives + valeur en cours si désactivée)
  value: number | undefined;
  onChange: (id: number) => void;
  onCreated: (value: ListeValeur) => void;
}

export default function QuickAddSelect({ label, type, options, value, onChange, onCreated }: Props) {
  const [adding, setAdding] = useState(false);
  const [nom, setNom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submitNew() {
    if (!nom.trim()) {
      setError("Le nom ne peut pas être vide.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await window.api.listes.create(type, nom);
      onCreated(created);
      onChange(created.id);
      setAdding(false);
      setNom("");
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <label>
      {label}
      {!adding && (
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={value ?? ""}
            onChange={(e) => onChange(Number(e.target.value))}
            style={{ flex: 1 }}
          >
            {options.length === 0 && <option value="">Aucune valeur — ajoutez-en une</option>}
            {options.map((o) => (
              <option key={o.id} value={o.id}>{o.nom}{!o.actif ? " (inactif)" : ""}</option>
            ))}
          </select>
          <button type="button" className="btn ghost quick-add-btn" onClick={() => setAdding(true)} title={`Ajouter ${label.toLowerCase()}`}>
            +
          </button>
        </div>
      )}
      {adding && (
        <div>
          <div style={{ display: "flex", gap: 6 }}>
            <input
              autoFocus
              type="text"
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              placeholder={`Nouveau : ${label.toLowerCase()}`}
              style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitNew(); } }}
            />
            <button type="button" className="btn primary" disabled={busy} onClick={submitNew}>Ajouter</button>
            <button type="button" className="btn ghost" onClick={() => { setAdding(false); setError(null); setNom(""); }}>Annuler</button>
          </div>
          {error && <p style={{ color: "#C0392B", fontSize: 11.5, margin: "4px 0 0" }}>{error}</p>}
        </div>
      )}
    </label>
  );
}
