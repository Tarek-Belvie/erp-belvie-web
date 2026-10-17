import { useEffect, useState } from "react";
import { DeclinaisonType } from "../../shared/types";
import Accordion from "./Accordion";

interface Props {
  onChanged?: () => void;
}

export default function DeclinaisonTypesManager({ onChanged }: Props) {
  const [types, setTypes] = useState<DeclinaisonType[]>([]);
  const [newNom, setNewNom] = useState("");
  const [newAffichageCouleur, setNewAffichageCouleur] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingNom, setEditingNom] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    const list = await window.api.declinaisons.listTypes({ includeInactive: true });
    setTypes([...list].sort((a: DeclinaisonType, b: DeclinaisonType) => a.ordre - b.ordre));
    onChanged?.();
  }
  useEffect(() => { refresh(); }, []);

  const actifs = types.filter((t) => t.actif);

  async function handleAdd() {
    if (!newNom.trim()) { setError("Le nom est obligatoire."); return; }
    try {
      await window.api.declinaisons.createType(newNom, { affichage_couleur: newAffichageCouleur });
      setNewNom("");
      setNewAffichageCouleur(false);
      setError(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  async function handleToggleActif(t: DeclinaisonType) {
    await window.api.declinaisons.updateType(t.id, { actif: !t.actif });
    refresh();
  }

  async function handleRename(t: DeclinaisonType) {
    const nom = editingNom.trim();
    if (!nom || nom === t.nom) { setEditingId(null); return; }
    try {
      await window.api.declinaisons.updateType(t.id, { nom });
      setEditingId(null);
      refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la modification.");
    }
  }

  async function handleToggleAffichageCouleur(t: DeclinaisonType) {
    await window.api.declinaisons.updateType(t.id, { affichage_couleur: !t.affichage_couleur });
    refresh();
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= actifs.length || busy) return;
    setBusy(true);
    try {
      const reordered = [...actifs];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);
      await window.api.declinaisons.reorderTypes(reordered.map((t) => t.id));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Accordion title="Types de déclinaisons" count={actifs.length}>
      <p className="desc">Les axes de variation possibles pour vos articles (Couleur, Taille, Pointure, Tour de taille...). Cochez « Sélecteur couleur » uniquement pour un type qui doit proposer un choix de couleur — indépendant de son nom.</p>

      <div className="scroll-list">
        {actifs.map((t, index) => (
          <div className="settings-row" key={t.id}>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === 0 || busy} onClick={() => move(index, -1)}>▲</button>
              <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === actifs.length - 1 || busy} onClick={() => move(index, 1)}>▼</button>
            </div>
            {editingId === t.id ? (
              <>
                <input
                  type="text" value={editingNom} onChange={(e) => setEditingNom(e.target.value)} autoFocus
                  style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleRename(t); } }}
                />
                <button className="btn ghost" onClick={() => handleRename(t)}>Enregistrer</button>
                <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
              </>
            ) : (
              <>
                <div className="libelle">
                  {t.nom}
                  <span className="code-badge">{t.code}</span>
                  <span style={{ fontSize: 11.5, color: "#9A9A90", marginLeft: 8 }}>{t.nb_valeurs ?? 0} valeur{(t.nb_valeurs ?? 0) > 1 ? "s" : ""}</span>
                </div>
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6B6B62" }}>
                  <input type="checkbox" checked={!!t.affichage_couleur} onChange={() => handleToggleAffichageCouleur(t)} />
                  Sélecteur couleur
                </label>
                <button className="btn ghost" onClick={() => { setEditingId(t.id); setEditingNom(t.nom); }}>Modifier</button>
                <button className="btn ghost" onClick={() => handleToggleActif(t)}>Désactiver</button>
              </>
            )}
          </div>
        ))}
        {actifs.length === 0 && <p className="hint">Aucun type de déclinaison pour le moment.</p>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
        <input
          type="text" value={newNom} onChange={(e) => setNewNom(e.target.value)} placeholder="Ajouter un type (ex : Pointure)..."
          style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 8px", fontSize: 13 }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
        />
        <label style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12, color: "#6B6B62", whiteSpace: "nowrap" }}>
          <input type="checkbox" checked={newAffichageCouleur} onChange={(e) => setNewAffichageCouleur(e.target.checked)} />
          Sélecteur couleur
        </label>
        <button className="btn primary" onClick={handleAdd}>Ajouter</button>
      </div>
      {error && <p style={{ color: "#C0392B", fontSize: 12, marginTop: 6 }}>{error}</p>}

      {types.some((t) => !t.actif) && (
        <div className="inactive-subsection">
          <p className="accordion-title" style={{ fontSize: 12.5 }}>Types désactivés</p>
          <div className="scroll-list">
            {types.filter((t) => !t.actif).map((t) => (
              <div className="settings-row" key={t.id}>
                <div className="libelle" style={{ opacity: 0.55 }}>{t.nom} <span className="code-badge">{t.code}</span></div>
                <button className="btn ghost" onClick={() => handleToggleActif(t)}>Réactiver</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Accordion>
  );
}
