import { useMemo, useRef, useState } from "react";
import { ListeValeur } from "../../shared/types";
import TagPicker from "./TagPicker";
import RatioPanel from "./RatioPanel";

interface Props {
  couleurs: ListeValeur[];
  tailles: ListeValeur[];
  selectedCouleurs: number[];
  selectedTailles: number[];
  quantities: Record<string, number>;
  references: Record<number, string>;
  onToggleCouleur: (v: ListeValeur) => void;
  onToggleTaille: (v: ListeValeur) => void;
  onQuantityChange: (couleurId: number, tailleId: number | null, raw: string) => void;
  onReferenceChange: (couleurId: number, raw: string) => void;
  onCouleurCreated: (v: ListeValeur) => void;
  // Grille applicable à l'article : sert uniquement à proposer et enregistrer les ratios
  // rattachés à CETTE grille. Les tailles affichées, elles, continuent de venir de la
  // prop `tailles` — ce composant ne charge jamais de tailles lui-même.
  grilleId?: number | null;
  grilleNom?: string | null;
  // Applique un lot de quantités calculées. Rien n'est écrit en base ici : les valeurs
  // remontent dans l'état du wizard, comme une saisie manuelle.
  onApplyQuantities?: (cells: { couleur_id: number; taille_id: number; quantite: number }[]) => void;
}

function cellKey(couleurId: number, tailleId: number | null) {
  return `${couleurId}:${tailleId ?? "none"}`;
}

// Composant entièrement contrôlé : aucun useState pour les données (sélection, quantités).
// Toutes les données vivent dans CommandeWizard, qui ne se démonte jamais entre les étapes —
// contrairement à ce composant, rendu uniquement pendant l'étape Répartition. C'est ce qui
// garantit que rien n'est perdu en naviguant vers une autre étape puis en revenant.
// Seule exception : l'ouverture du panneau de ratio, qui est un état purement visuel et
// n'a aucune raison de survivre à un changement d'étape.
export default function RepartitionEditor({
  couleurs, tailles, selectedCouleurs, selectedTailles, quantities, references,
  onToggleCouleur, onToggleTaille, onQuantityChange, onReferenceChange, onCouleurCreated,
  grilleId, grilleNom, onApplyQuantities,
}: Props) {
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [ratioOuvert, setRatioOuvert] = useState(false);

  async function handleAddCouleur(nom: string) {
    const created = await window.api.listes.create("couleur", nom);
    onCouleurCreated(created);
  }

  const rows = useMemo(() => couleurs.filter((c) => selectedCouleurs.includes(c.id)), [couleurs, selectedCouleurs]);
  const cols = useMemo(() => tailles.filter((t) => selectedTailles.includes(t.id)), [tailles, selectedTailles]);

  const rowTotal = (cId: number) => {
    if (cols.length === 0) return quantities[cellKey(cId, null)] || 0;
    return cols.reduce((sum, t) => sum + (quantities[cellKey(cId, t.id)] || 0), 0);
  };
  const colTotal = (tId: number) => rows.reduce((sum, c) => sum + (quantities[cellKey(c.id, tId)] || 0), 0);
  const grandTotal = rows.reduce((sum, c) => sum + rowTotal(c.id), 0);

  function focusCell(rowIdx: number, colIdx: number) {
    inputRefs.current[`${rowIdx}_${colIdx}`]?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent, rowIdx: number, colIdx: number) {
    const totalCols = Math.max(cols.length, 1);
    if (e.key === "ArrowRight") { e.preventDefault(); if (colIdx < totalCols - 1) focusCell(rowIdx, colIdx + 1); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); if (colIdx > 0) focusCell(rowIdx, colIdx - 1); }
    else if (e.key === "ArrowDown" || e.key === "Enter") { e.preventDefault(); if (rowIdx < rows.length - 1) focusCell(rowIdx + 1, colIdx); }
    else if (e.key === "ArrowUp") { e.preventDefault(); if (rowIdx > 0) focusCell(rowIdx - 1, colIdx); }
  }

  return (
    <div>
      <TagPicker label="Couleurs" options={couleurs} selectedIds={selectedCouleurs} onToggle={onToggleCouleur} swatch onQuickAdd={handleAddCouleur} />
      <TagPicker label="Tailles" options={tailles} selectedIds={selectedTailles} onToggle={onToggleTaille} />

      {/* La répartition par ratio est une aide à la saisie, proposée à côté du tableau et
          jamais imposée : la saisie manuelle reste le fonctionnement par défaut. */}
      {onApplyQuantities && (
        <div style={{ display: "flex", justifyContent: "flex-end", margin: "4px 0 10px" }}>
          <button className="btn ghost tiny" onClick={() => setRatioOuvert((v) => !v)}>
            {ratioOuvert ? "Masquer la répartition par ratio" : "Répartir par ratio"}
          </button>
        </div>
      )}

      {ratioOuvert && onApplyQuantities && (
        <RatioPanel
          grilleId={grilleId ?? null}
          grilleNom={grilleNom ?? null}
          tailles={cols}
          couleurs={rows}
          quantities={quantities}
          onApply={onApplyQuantities}
          onClose={() => setRatioOuvert(false)}
        />
      )}

      {rows.length > 0 ? (
        <div className="v2-repartition-wrap">
          <table className="v2-repartition-table">
            <thead>
              <tr>
                <th>Couleur</th>
                <th>Réf</th>
                {cols.length > 0 ? cols.map((t) => <th key={t.id}>{t.nom}</th>) : <th>Quantité</th>}
                <th className="v2-total-col">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c, rowIdx) => (
                <tr key={c.id}>
                  <td className="v2-row-label">{c.nom}</td>
                  <td>
                    <input
                      type="text"
                      className="v2-cell-input"
                      style={{ width: 90, textAlign: "left" }}
                      placeholder="Réf"
                      value={references[c.id] ?? ""}
                      onChange={(e) => onReferenceChange(c.id, e.target.value)}
                    />
                  </td>
                  {(cols.length > 0 ? cols : [null]).map((t, colIdx) => (
                    <td key={t ? t.id : "none"}>
                      <input
                        ref={(el) => { inputRefs.current[`${rowIdx}_${colIdx}`] = el; }}
                        type="number" min={0} step={1} inputMode="numeric" className="v2-cell-input"
                        value={quantities[cellKey(c.id, t ? t.id : null)] ?? ""}
                        onChange={(e) => onQuantityChange(c.id, t ? t.id : null, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(e, rowIdx, colIdx)}
                        onFocus={(e) => e.target.select()}
                      />
                    </td>
                  ))}
                  <td className="v2-total-col">{rowTotal(c.id)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total</td>
                <td></td>
                {cols.length > 0 ? cols.map((t) => <td key={t.id}>{colTotal(t.id)}</td>) : <td>{grandTotal}</td>}
                <td className="v2-total-col">{grandTotal}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>Sélectionnez au moins une couleur pour faire apparaître le tableau de saisie.</p>
      )}
    </div>
  );
}
