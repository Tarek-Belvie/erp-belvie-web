import { useEffect, useState } from "react";
import { ListeValeur } from "../../shared/types";

// Chaque atelier dispose simplement d'un champ Responsable en texte libre — pas de liste dédiée,
// pas de table de liaison. Une faute de frappe ou un changement de nom se corrige directement ici.
export default function AtelierResponsableManager() {
  const [ateliers, setAteliers] = useState<ListeValeur[]>([]);
  const [valeurs, setValeurs] = useState<Record<number, string>>({});
  const [busyId, setBusyId] = useState<number | null>(null);
  const [savedId, setSavedId] = useState<number | null>(null);

  async function refresh() {
    const a = await window.api.listes.list("atelier", { includeInactive: true });
    setAteliers(a);
    const v: Record<number, string> = {};
    a.forEach((at) => { v[at.id] = at.responsable_nom ?? ""; });
    setValeurs(v);
  }
  useEffect(() => { refresh(); }, []);

  async function handleEnregistrer(atelierId: number) {
    setBusyId(atelierId);
    try {
      await window.api.listes.update(atelierId, { responsable_nom: valeurs[atelierId] || null });
      setSavedId(atelierId);
      setTimeout(() => setSavedId(null), 1500);
    } finally {
      setBusyId(null);
    }
  }

  const atelierActifs = ateliers.filter((a) => a.actif);

  return (
    <div className="settings-section">
      <h3>Responsable par atelier</h3>
      <p className="desc">
        Saisissez le nom du responsable directement en face de chaque atelier, puis cliquez sur Enregistrer. Cette
        information sert de responsable par défaut à la création d'une commande, et reste modifiable au cas par cas.
      </p>
      {atelierActifs.length === 0 && <p className="hint">Aucun atelier actif — créez-en un ci-dessus d'abord.</p>}
      {atelierActifs.map((a) => (
        <div className="settings-row" key={a.id}>
          <div className="libelle" style={{ fontWeight: 600, minWidth: 160 }}>{a.nom}</div>
          <input
            type="text"
            placeholder="Nom du responsable"
            value={valeurs[a.id] ?? ""}
            onChange={(e) => setValeurs((prev) => ({ ...prev, [a.id]: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && handleEnregistrer(a.id)}
          />
          <button className="btn ghost" onClick={() => handleEnregistrer(a.id)} disabled={busyId === a.id}>
            {savedId === a.id ? "Enregistré ✓" : "Enregistrer"}
          </button>
        </div>
      ))}
    </div>
  );
}
