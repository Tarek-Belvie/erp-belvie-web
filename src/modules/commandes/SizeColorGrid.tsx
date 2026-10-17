import { useEffect, useMemo, useRef, useState } from "react";
import { CommandeLigne, ListeValeur } from "../../shared/types";
import ConfirmDialog from "./ConfirmDialog";

interface Props {
  couleurs: ListeValeur[]; // déjà filtrées par l'appelant (actives + celles utilisées par la commande en édition)
  tailles: ListeValeur[];  // idem, triées par ordre
  initialLignes: CommandeLigne[];
  onChange: (lignes: { couleur_id: number; taille_id: number | null; quantite: number }[]) => void;
}

function cellKey(couleurId: number, tailleId: number | null) {
  return `${couleurId}:${tailleId ?? "none"}`;
}

export default function SizeColorGrid({ couleurs, tailles, initialLignes, onChange }: Props) {
  const [extraCouleurs, setExtraCouleurs] = useState<ListeValeur[]>([]);
  const [addingCouleur, setAddingCouleur] = useState(false);
  const [newCouleurNom, setNewCouleurNom] = useState("");
  const [addCouleurError, setAddCouleurError] = useState<string | null>(null);

  const allCouleurs = useMemo(() => [...couleurs, ...extraCouleurs], [couleurs, extraCouleurs]);

  const [selectedCouleurs, setSelectedCouleurs] = useState<number[]>(() =>
    Array.from(new Set(initialLignes.map((l) => l.couleur_id)))
  );
  const [selectedTailles, setSelectedTailles] = useState<number[]>(() =>
    Array.from(new Set(initialLignes.filter((l) => l.taille_id != null).map((l) => l.taille_id as number)))
  );
  const [quantities, setQuantities] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    initialLignes.forEach((l) => { map[cellKey(l.couleur_id, l.taille_id)] = l.quantite; });
    return map;
  });
  const [pendingRemoval, setPendingRemoval] = useState<{ kind: "couleur" | "taille"; id: number; nom: string } | null>(null);

  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Notifie le parent (OrderForm) à chaque changement, en aplatissant l'état interne en lignes.
  useEffect(() => {
    const lignes: { couleur_id: number; taille_id: number | null; quantite: number }[] = [];
    for (const cId of selectedCouleurs) {
      if (selectedTailles.length === 0) {
        const q = quantities[cellKey(cId, null)] || 0;
        if (q > 0) lignes.push({ couleur_id: cId, taille_id: null, quantite: q });
      } else {
        for (const tId of selectedTailles) {
          const q = quantities[cellKey(cId, tId)] || 0;
          if (q > 0) lignes.push({ couleur_id: cId, taille_id: tId, quantite: q });
        }
      }
    }
    onChange(lignes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedCouleurs, selectedTailles, quantities]);

  function hasDataFor(kind: "couleur" | "taille", id: number) {
    const prefix = kind === "couleur" ? `${id}:` : `:${id}`;
    return Object.entries(quantities).some(([k, v]) => v > 0 && (kind === "couleur" ? k.startsWith(prefix) : k.endsWith(prefix)));
  }

  function toggleCouleur(v: ListeValeur) {
    const isSelected = selectedCouleurs.includes(v.id);
    if (isSelected) {
      if (hasDataFor("couleur", v.id)) { setPendingRemoval({ kind: "couleur", id: v.id, nom: v.nom }); return; }
      setSelectedCouleurs((prev) => prev.filter((x) => x !== v.id));
    } else {
      setSelectedCouleurs((prev) => [...prev, v.id]);
    }
  }

  function toggleTaille(v: ListeValeur) {
    const isSelected = selectedTailles.includes(v.id);
    if (isSelected) {
      if (hasDataFor("taille", v.id)) { setPendingRemoval({ kind: "taille", id: v.id, nom: v.nom }); return; }
      setSelectedTailles((prev) => prev.filter((x) => x !== v.id));
    } else {
      setSelectedTailles((prev) => [...prev, v.id]);
    }
  }

  function confirmRemoval() {
    if (!pendingRemoval) return;
    if (pendingRemoval.kind === "couleur") setSelectedCouleurs((prev) => prev.filter((x) => x !== pendingRemoval.id));
    else setSelectedTailles((prev) => prev.filter((x) => x !== pendingRemoval.id));
    setPendingRemoval(null);
  }

  function setQuantity(cId: number, tId: number | null, raw: string) {
    const n = raw === "" ? 0 : Math.max(0, Math.trunc(Number(raw) || 0));
    setQuantities((prev) => ({ ...prev, [cellKey(cId, tId)]: n }));
  }

  async function handleAddCouleur() {
    if (!newCouleurNom.trim()) { setAddCouleurError("Le nom ne peut pas être vide."); return; }
    try {
      const created = await window.api.listes.create("couleur", newCouleurNom);
      setExtraCouleurs((prev) => [...prev, created]);
      setSelectedCouleurs((prev) => [...prev, created.id]);
      setNewCouleurNom("");
      setAddingCouleur(false);
      setAddCouleurError(null);
    } catch (err: any) {
      setAddCouleurError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  const rows = useMemo(() => allCouleurs.filter((c) => selectedCouleurs.includes(c.id)), [allCouleurs, selectedCouleurs]);
  const cols = useMemo(() => tailles.filter((t) => selectedTailles.includes(t.id)), [tailles, selectedTailles]);

  const rowTotal = (cId: number) => {
    if (cols.length === 0) return quantities[cellKey(cId, null)] || 0;
    return cols.reduce((sum, t) => sum + (quantities[cellKey(cId, t.id)] || 0), 0);
  };
  const colTotal = (tId: number) => rows.reduce((sum, c) => sum + (quantities[cellKey(c.id, tId)] || 0), 0);
  const grandTotal = rows.reduce((sum, c) => sum + rowTotal(c.id), 0);

  function focusCell(rowIdx: number, colIdx: number) {
    const ref = inputRefs.current[`${rowIdx}_${colIdx}`];
    if (ref) ref.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    const totalCols = Math.max(cols.length, 1);
    if (e.key === "ArrowRight") { e.preventDefault(); if (colIdx < totalCols - 1) focusCell(rowIdx, colIdx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (colIdx > 0) focusCell(rowIdx, colIdx - 1); }
    else if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); if (rowIdx < rows.length - 1) focusCell(rowIdx + 1, colIdx); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (rowIdx > 0) focusCell(rowIdx - 1, colIdx); }
  }

  return (
    <div className="span-2 grid-field">
      <label style={{ marginBottom: 6, display: "block" }}>Couleurs et tailles de la commande</label>

      <div className="grid-selectors">
        <div className="grid-selector-panel">
          <div className="grid-selector-head">
            <span>Couleurs</span>
            <div>
              <button type="button" className="btn ghost tiny" onClick={() => setSelectedCouleurs(allCouleurs.map((c) => c.id))}>Tout sélectionner</button>
              <button type="button" className="btn ghost tiny" onClick={() => setSelectedCouleurs([])}>Tout désélectionner</button>
            </div>
          </div>
          <div className="grid-selector-list">
            {allCouleurs.map((c) => (
              <label key={c.id} className="grid-checkbox">
                <input type="checkbox" checked={selectedCouleurs.includes(c.id)} onChange={() => toggleCouleur(c)} />
                {c.nom}{!c.actif ? " (inactive)" : ""}
              </label>
            ))}
            {allCouleurs.length === 0 && <p className="hint">Aucune couleur.</p>}
          </div>
          {addingCouleur ? (
            <div className="grid-quick-add">
              <input
                autoFocus type="text" value={newCouleurNom}
                onChange={(e) => setNewCouleurNom(e.target.value)}
                placeholder="Nouvelle couleur..."
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddCouleur(); } }}
              />
              <button type="button" className="btn primary tiny" onClick={handleAddCouleur}>Ajouter</button>
              <button type="button" className="btn ghost tiny" onClick={() => { setAddingCouleur(false); setAddCouleurError(null); }}>Annuler</button>
            </div>
          ) : (
            <button type="button" className="btn ghost tiny" style={{ marginTop: 6 }} onClick={() => setAddingCouleur(true)}>+ Ajouter une couleur</button>
          )}
          {addCouleurError && <p style={{ color: "#C0392B", fontSize: 11, margin: "4px 0 0" }}>{addCouleurError}</p>}
        </div>

        <div className="grid-selector-panel">
          <div className="grid-selector-head">
            <span>Tailles</span>
            <div>
              <button type="button" className="btn ghost tiny" onClick={() => setSelectedTailles(tailles.map((t) => t.id))}>Tout sélectionner</button>
              <button type="button" className="btn ghost tiny" onClick={() => setSelectedTailles([])}>Tout désélectionner</button>
            </div>
          </div>
          <div className="grid-selector-list">
            {tailles.map((t) => (
              <label key={t.id} className="grid-checkbox">
                <input type="checkbox" checked={selectedTailles.includes(t.id)} onChange={() => toggleTaille(t)} />
                {t.nom}{!t.actif ? " (inactive)" : ""}
              </label>
            ))}
            {tailles.length === 0 && <p className="hint">Aucune taille. Ajoutez-en une dans Paramètres.</p>}
          </div>
        </div>
      </div>

      {rows.length > 0 ? (
        <div className="grid-table-wrap">
          <table className="grid-table">
            <thead>
              <tr>
                <th>Couleur</th>
                {cols.length > 0 ? cols.map((t) => <th key={t.id}>{t.nom}</th>) : <th>Quantité</th>}
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, rowIdx) => (
                <tr key={c.id}>
                  <td className="grid-row-label">{c.nom}</td>
                  {(cols.length > 0 ? cols : [null]).map((t, colIdx) => (
                    <td key={t ? t.id : "none"}>
                      <input
                        ref={(el) => { inputRefs.current[`${rowIdx}_${colIdx}`] = el; }}
                        type="number"
                        min={0}
                        step={1}
                        inputMode="numeric"
                        className="grid-input"
                        value={quantities[cellKey(c.id, t ? t.id : null)] || ""}
                        onChange={(e) => setQuantity(c.id, t ? t.id : null, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                  ))}
                  <td className="grid-total-cell">{rowTotal(c.id)}</td>
                </tr>
              ))}
              <tr className="grid-total-row">
                <td>Total</td>
                {cols.length > 0
                  ? cols.map((t) => <td key={t.id}>{colTotal(t.id)}</td>)
                  : <td>{grandTotal}</td>}
                <td className="grid-total-cell">{grandTotal}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ) : (
        <p className="hint">Sélectionnez au moins une couleur pour faire apparaître le tableau de saisie.</p>
      )}

      {pendingRemoval && (
        <ConfirmDialog
          title={pendingRemoval.kind === "couleur" ? "Retirer cette couleur ?" : "Retirer cette taille ?"}
          message={`« ${pendingRemoval.nom} » contient déjà des quantités saisies. Les retirer effacera ces valeurs de la commande.`}
          confirmLabel="Retirer"
          danger
          onConfirm={confirmRemoval}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}
