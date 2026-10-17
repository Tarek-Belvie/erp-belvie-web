interface RepartitionCell {
  couleur_id: number;
  couleur: string;
  couleur_reference?: string | null;
  taille_id: number | null;
  taille: string | null;
  quantite: number;
}

// Ordre standard du prêt-à-porter (du plus petit au plus grand) — les tailles reconnues sont
// triées selon cette liste, les tailles numériques (38, 40...) par ordre numérique croissant, et
// tout le reste (Taille unique, Sur-mesure...) par ordre alphabétique en dernier recours.
const ORDRE_TAILLES_LETTRES = ["XXS", "XS", "S", "M", "L", "XL", "XXL", "2XL", "XXXL", "3XL", "4XL", "5XL"];
function comparerTailles(a: string, b: string): number {
  const ia = ORDRE_TAILLES_LETTRES.indexOf(a.toUpperCase());
  const ib = ORDRE_TAILLES_LETTRES.indexOf(b.toUpperCase());
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  const na = parseFloat(a), nb = parseFloat(b);
  if (!isNaN(na) && !isNaN(nb)) return na - nb;
  return a.localeCompare(b);
}

export default function BcPfRepartitionTable({ lignes, docMode }: { lignes: RepartitionCell[]; docMode?: boolean }) {
  if (lignes.length === 0) return <p style={{ color: "var(--v2-text-3)", fontSize: 12.5 }}>Aucune répartition renseignée.</p>;

  const couleurs = Array.from(new Set(lignes.map((l) => l.couleur)));
  const tailles = Array.from(new Set(lignes.filter((l) => l.taille != null).map((l) => l.taille as string))).sort(comparerTailles);

  const qty = (couleur: string, taille: string | null) =>
    lignes.find((l) => l.couleur === couleur && (l.taille ?? null) === taille)?.quantite ?? 0;
  const rowTotal = (couleur: string) =>
    tailles.length > 0 ? tailles.reduce((s, t) => s + qty(couleur, t), 0) : qty(couleur, null);
  const colTotal = (taille: string) => couleurs.reduce((s, c) => s + qty(c, taille), 0);
  const grandTotal = couleurs.reduce((s, c) => s + rowTotal(c), 0);
  const referenceDe = (couleur: string) => lignes.find((l) => l.couleur === couleur)?.couleur_reference || "—";

  if (docMode) {
    return (
      <table className="bcpf-doc-table">
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Couleur</th>
            <th>Réf</th>
            {tailles.length > 0 ? tailles.map((t) => <th key={t}>{t}</th>) : <th>Quantité</th>}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {couleurs.map((c) => (
            <tr key={c}>
              <td>{c}</td>
              <td>{referenceDe(c)}</td>
              {(tailles.length > 0 ? tailles : [null]).map((t) => (
                <td key={t ?? "none"}>{qty(c, t) || "—"}</td>
              ))}
              <td className="col-total">{rowTotal(c)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td></td>
            {tailles.length > 0 ? tailles.map((t) => <td key={t}>{colTotal(t)}</td>) : <td>{grandTotal}</td>}
            <td className="col-total">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    );
  }

  return (
    <div className="v2-repartition-wrap">
      <table className="v2-repartition-table">
        <thead>
          <tr>
            <th>Couleur</th>
            <th>Réf</th>
            {tailles.length > 0 ? tailles.map((t) => <th key={t}>{t}</th>) : <th>Quantité</th>}
            <th className="v2-total-col">Total</th>
          </tr>
        </thead>
        <tbody>
          {couleurs.map((c) => (
            <tr key={c}>
              <td className="v2-row-label">{c}</td>
              <td style={{ textAlign: "center", padding: "8px 6px", color: "var(--v2-text-3, #8A8A82)", fontSize: 12.5 }}>{referenceDe(c)}</td>
              {(tailles.length > 0 ? tailles : [null]).map((t) => (
                <td key={t ?? "none"} style={{ textAlign: "center", padding: "8px 6px" }}>{qty(c, t) || "—"}</td>
              ))}
              <td className="v2-total-col">{rowTotal(c)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td>Total</td>
            <td></td>
            {tailles.length > 0 ? tailles.map((t) => <td key={t}>{colTotal(t)}</td>) : <td>{grandTotal}</td>}
            <td className="v2-total-col">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
