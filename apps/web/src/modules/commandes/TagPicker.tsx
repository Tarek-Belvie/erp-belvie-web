import { useState } from "react";
import Icon from "../../shared/Icon";
import { ListeValeur } from "../../shared/types";
import { guessSwatch } from "./colorSwatch";

interface Props {
  label: string;
  options: ListeValeur[];
  selectedIds: number[];
  onToggle: (v: ListeValeur) => void;
  swatch?: boolean;
  onQuickAdd?: (nom: string) => Promise<void>;
}

export default function TagPicker({ label, options, selectedIds, onToggle, swatch = false, onQuickAdd }: Props) {
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const [newNom, setNewNom] = useState("");
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const visible = q ? options.filter((o) => o.nom.toLowerCase().includes(q)) : options;

  async function handleQuickAdd() {
    if (!newNom.trim() || !onQuickAdd) return;
    try {
      await onQuickAdd(newNom.trim());
      setNewNom("");
      setAdding(false);
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  return (
    <div>
      <div className="v2-tagpicker-head">
        <span>{label}</span>
      </div>

      {options.length > 6 && (
        <div className="v2-tagpicker-search">
          <Icon name="search" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Rechercher dans ${label.toLowerCase()}...`}
          />
        </div>
      )}

      <div className="v2-tag-list">
        {visible.map((v) => {
          const isSelected = selectedIds.includes(v.id);
          return (
            <button
              type="button"
              key={v.id}
              className={`v2-tag ${swatch ? "swatch-mode" : "fill-mode"} ${isSelected ? "selected" : ""}`}
              onClick={() => onToggle(v)}
            >
              {swatch && <span className="dot" style={{ background: guessSwatch(v.nom) }} />}
              {v.nom}
              {isSelected && <Icon name="check" />}
            </button>
          );
        })}
        {visible.length === 0 && <span style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>Aucun résultat.</span>}

        {onQuickAdd && !adding && (
          <button type="button" className="v2-tag dashed" onClick={() => setAdding(true)}>
            <Icon name="plus" /> Ajouter
          </button>
        )}
      </div>

      {adding && (
        <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: -12, marginBottom: 18 }}>
          <input
            type="text"
            autoFocus
            value={newNom}
            onChange={(e) => setNewNom(e.target.value)}
            placeholder={`Nouvelle ${label.toLowerCase().replace(/s$/, "")}...`}
            style={{ border: "1px solid var(--v2-border)", borderRadius: 8, padding: "6px 10px", fontSize: 13, fontFamily: "var(--v2-font)" }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleQuickAdd(); } if (e.key === "Escape") setAdding(false); }}
          />
          <button type="button" className="v2-btn primary" style={{ padding: "6px 14px" }} onClick={handleQuickAdd}>Ajouter</button>
          <button type="button" className="v2-btn ghost" style={{ padding: "6px 14px" }} onClick={() => { setAdding(false); setError(null); }}>Annuler</button>
        </div>
      )}
      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12, marginTop: -14, marginBottom: 14 }}>{error}</p>}
    </div>
  );
}
