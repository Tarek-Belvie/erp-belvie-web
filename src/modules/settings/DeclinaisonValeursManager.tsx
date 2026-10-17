import { useEffect, useState } from "react";
import { DeclinaisonType, DeclinaisonValeur } from "../../shared/types";
import Accordion from "./Accordion";

export default function DeclinaisonValeursManager() {
  const [types, setTypes] = useState<DeclinaisonType[]>([]);
  const [typeId, setTypeId] = useState<number | null>(null);
  const [valeurs, setValeurs] = useState<DeclinaisonValeur[]>([]);
  const [newValeur, setNewValeur] = useState("");
  const [newHex, setNewHex] = useState("#888888");
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingValeur, setEditingValeur] = useState("");
  const [editingHex, setEditingHex] = useState("#888888");
  const [busy, setBusy] = useState(false);

  async function refreshTypes() {
    const list = await window.api.declinaisons.listTypes({ includeInactive: true });
    setTypes(list);
    if (typeId == null && list.length > 0) setTypeId(list[0].id);
  }
  useEffect(() => { refreshTypes(); }, []);

  async function refreshValeurs() {
    if (typeId == null) { setValeurs([]); return; }
    const list = await window.api.declinaisons.listValeurs(typeId, { includeInactive: true });
    setValeurs([...list].sort((a: DeclinaisonValeur, b: DeclinaisonValeur) => a.ordre - b.ordre));
  }
  useEffect(() => { refreshValeurs(); }, [typeId]);

  const type = types.find((t) => t.id === typeId) || null;
  const actives = valeurs.filter((v) => v.actif);
  const affCouleur = !!type?.affichage_couleur;

  async function handleAdd() {
    if (typeId == null) return;
    if (!newValeur.trim()) { setError("La valeur est obligatoire."); return; }
    try {
      await window.api.declinaisons.createValeur(typeId, newValeur, affCouleur ? { couleur_hex: newHex } : undefined);
      setNewValeur("");
      setError(null);
      refreshValeurs();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  async function handleToggleActif(v: DeclinaisonValeur) {
    await window.api.declinaisons.updateValeur(v.id, { actif: !v.actif });
    refreshValeurs();
  }

  async function handleSaveEdit(v: DeclinaisonValeur) {
    const valeur = editingValeur.trim();
    if (!valeur) { setEditingId(null); return; }
    try {
      const patch: any = { valeur };
      if (affCouleur) patch.couleur_hex = editingHex;
      await window.api.declinaisons.updateValeur(v.id, patch);
      setEditingId(null);
      refreshValeurs();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la modification.");
    }
  }

  async function move(index: number, direction: -1 | 1) {
    if (typeId == null) return;
    const target = index + direction;
    if (target < 0 || target >= actives.length || busy) return;
    setBusy(true);
    try {
      const reordered = [...actives];
      const [moved] = reordered.splice(index, 1);
      reordered.splice(target, 0, moved);
      await window.api.declinaisons.reorderValeurs(typeId, reordered.map((v) => v.id));
      await refreshValeurs();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Accordion title="Valeurs" count={actives.length}>
      <p className="desc">Les valeurs possibles pour chaque type (ex : Noir, Blanc pour Couleur ; 36, 37, 38 pour Pointure).</p>

      <div style={{ marginBottom: 12 }}>
        <select value={typeId ?? ""} onChange={(e) => setTypeId(Number(e.target.value))} style={{ border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 8px", fontSize: 13 }}>
          {types.map((t) => <option key={t.id} value={t.id}>{t.nom}{!t.actif ? " (inactif)" : ""}</option>)}
        </select>
      </div>

      {typeId == null ? (
        <p className="hint">Créez d'abord un type de déclinaison.</p>
      ) : (
        <>
          <div className="scroll-list">
            {actives.map((v, index) => (
              <div className="settings-row" key={v.id}>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === 0 || busy} onClick={() => move(index, -1)}>▲</button>
                  <button className="btn ghost quick-add-btn" style={{ padding: "2px 8px", fontSize: 11 }} disabled={index === actives.length - 1 || busy} onClick={() => move(index, 1)}>▼</button>
                </div>
                {editingId === v.id ? (
                  <>
                    {affCouleur && <input type="color" value={editingHex} onChange={(e) => setEditingHex(e.target.value)} style={{ width: 32, height: 28, padding: 0, border: "1px solid #D8D9D0", borderRadius: 6 }} />}
                    <input
                      type="text" value={editingValeur} onChange={(e) => setEditingValeur(e.target.value)} autoFocus
                      style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "5px 8px", fontSize: 13 }}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSaveEdit(v); } }}
                    />
                    <button className="btn ghost" onClick={() => handleSaveEdit(v)}>Enregistrer</button>
                    <button className="btn ghost" onClick={() => setEditingId(null)}>Annuler</button>
                  </>
                ) : (
                  <>
                    {affCouleur && (
                      <span style={{ width: 16, height: 16, borderRadius: "50%", background: v.couleur_hex || "#CCC", border: "1px solid #D8D9D0", flexShrink: 0 }} title={v.couleur_hex || ""} />
                    )}
                    <div className="libelle">{v.valeur}</div>
                    <button className="btn ghost" onClick={() => { setEditingId(v.id); setEditingValeur(v.valeur); setEditingHex(v.couleur_hex || "#888888"); }}>Modifier</button>
                    <button className="btn ghost" onClick={() => handleToggleActif(v)}>Désactiver</button>
                  </>
                )}
              </div>
            ))}
            {actives.length === 0 && <p className="hint">Aucune valeur pour ce type.</p>}
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {affCouleur && <input type="color" value={newHex} onChange={(e) => setNewHex(e.target.value)} style={{ width: 36, height: 32, padding: 0, border: "1px solid #D8D9D0", borderRadius: 6 }} />}
            <input
              type="text" value={newValeur} onChange={(e) => setNewValeur(e.target.value)} placeholder="Ajouter une valeur..."
              style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 8px", fontSize: 13 }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAdd(); } }}
            />
            <button className="btn primary" onClick={handleAdd}>Ajouter</button>
          </div>
          {error && <p style={{ color: "#C0392B", fontSize: 12, marginTop: 6 }}>{error}</p>}

          {valeurs.some((v) => !v.actif) && (
            <div className="inactive-subsection">
              <p className="accordion-title" style={{ fontSize: 12.5 }}>Valeurs désactivées</p>
              <div className="scroll-list">
                {valeurs.filter((v) => !v.actif).map((v) => (
                  <div className="settings-row" key={v.id}>
                    <div className="libelle" style={{ opacity: 0.55 }}>{v.valeur}</div>
                    <button className="btn ghost" onClick={() => handleToggleActif(v)}>Réactiver</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Accordion>
  );
}
