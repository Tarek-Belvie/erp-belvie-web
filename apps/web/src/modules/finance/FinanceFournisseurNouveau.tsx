import { useState } from "react";

interface Props {
  onRetour: () => void;
  onCree: (id: number, nom: string) => void;
}

export default function FinanceFournisseurNouveau({ onRetour, onCree }: Props) {
  const [nom, setNom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreer() {
    if (!nom.trim()) { setError("Le nom est obligatoire."); return; }
    setBusy(true);
    setError(null);
    try {
      const f = await window.api.finance.creerFournisseur({ nom: nom.trim() });
      onCree(f.id, f.nom);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="finance-page-form">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>
      <h2>Nouveau fournisseur</h2>

      <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Nom du fournisseur
        <input type="text" autoFocus value={nom} onChange={(e) => setNom(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleCreer()} />
      </label>
      <p style={{ fontSize: 12, color: "var(--v2-text-3)" }}>Les coordonnées, conditions de paiement et autres informations pourront être complétées ensuite depuis sa fiche.</p>

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}

      <div className="finance-form-actions">
        <button className="btn primary finance-fp-btn-save" onClick={handleCreer} disabled={busy || !nom.trim()}>Créer le fournisseur</button>
      </div>
    </div>
  );
}
