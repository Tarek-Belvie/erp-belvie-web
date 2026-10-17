import { useEffect, useState } from "react";
import { ListeValeur } from "../../shared/types";

interface Props {
  onChanged?: () => void;
}

export default function OperateurActifSelector({ onChanged }: Props) {
  const [operateurs, setOperateurs] = useState<ListeValeur[]>([]);
  const [actifId, setActifId] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function refresh() {
    const [ops, actif] = await Promise.all([
      window.api.listes.list("operateur"),
      window.api.parametres.getOperateurActif(),
    ]);
    setOperateurs(ops);
    setActifId(actif ? actif.id : "");
  }
  useEffect(() => { refresh(); }, []);

  async function handleChange(value: string) {
    setError(null);
    try {
      const id = value ? Number(value) : null;
      await window.api.parametres.setOperateurActif(id);
      setActifId(id ?? "");
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    }
  }

  return (
    <div className="settings-section operateur-actif-box">
      <h3>Opérateur actif sur ce poste</h3>
      <p className="desc">
        Cet opérateur sera automatiquement associé à chaque action importante (validation, lancement, blocage,
        annulation, archivage...). Changez-le si une autre personne prend le relais sur ce poste.
      </p>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <select className="plain" style={{ minWidth: 220 }} value={actifId} onChange={(e) => handleChange(e.target.value)}>
          <option value="">— Aucun opérateur sélectionné —</option>
          {operateurs.map((o) => <option key={o.id} value={o.id}>{o.nom}</option>)}
        </select>
        {saved && <span style={{ color: "#2E7D46", fontSize: 12.5 }}>✓ Enregistré</span>}
      </div>
      {operateurs.length === 0 && (
        <p className="hint" style={{ marginTop: 8 }}>Aucun opérateur n'existe encore — ajoutez-en un dans la section "Opérateurs" ci-dessous.</p>
      )}
      {error && <p style={{ color: "#C0392B", fontSize: 12, marginTop: 6 }}>{error}</p>}
    </div>
  );
}
