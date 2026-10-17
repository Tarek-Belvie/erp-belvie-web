import { CommandeLigne } from "../../shared/types";
import { guessSwatch } from "./colorSwatch";

// Petit tableau croisé en lecture seule (couleurs en lignes, tailles en colonnes), avec totaux
// par ligne, par colonne et total général — même principe que le tableau du BC PF.
export default function RepartitionTable({ lignes }: { lignes: CommandeLigne[] }) {
  if (lignes.length === 0) return <p style={{ color: "#8A8A82", fontSize: 12.5 }}>Aucune répartition renseignée.</p>;

  const couleurs = Array.from(new Set(lignes.map((l) => l.couleur))).filter((c): c is string => !!c);
  const tailles = Array.from(new Set(lignes.filter((l) => l.taille != null).map((l) => l.taille))).filter((t): t is string => !!t);
  const qty = (couleur: string, taille: string | null) =>
    lignes.find((l) => l.couleur === couleur && (l.taille ?? null) === taille)?.quantite ?? 0;
  const rowTotal = (couleur: string) =>
    tailles.length > 0 ? tailles.reduce((s, t) => s + qty(couleur, t), 0) : qty(couleur, null);
  const colTotal = (taille: string) => couleurs.reduce((s, c) => s + qty(c, taille), 0);
  const grandTotal = couleurs.reduce((s, c) => s + rowTotal(c), 0);

  return (
    <div className="grid-table-wrap mini">
      <table className="grid-table">
        <thead>
          <tr>
            <th>Couleur</th>
            <th>Réf</th>
            {tailles.length > 0 ? tailles.map((t) => <th key={t}>{t}</th>) : <th>Qté</th>}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {couleurs.map((c) => (
            <tr key={c}>
              <td className="grid-row-label">
                <span style={{ display: "inline-block", width: 9, height: 9, borderRadius: "50%", background: guessSwatch(c), border: "1px solid rgba(0,0,0,0.12)", marginRight: 7, verticalAlign: "middle" }} />
                {c}
              </td>
              <td style={{ color: "#8A8A82", fontSize: 12.5 }}>{lignes.find((l) => l.couleur === c)?.couleur_reference || "—"}</td>
              {(tailles.length > 0 ? tailles : [null]).map((t) => (
                <td key={t ?? "none"}>{qty(c, t) || "—"}</td>
              ))}
              <td className="grid-total-cell">{rowTotal(c)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="grid-row-label">Total</td>
            <td></td>
            {tailles.length > 0 ? tailles.map((t) => <td key={t}>{colTotal(t)}</td>) : <td>{grandTotal}</td>}
            <td className="grid-total-cell">{grandTotal}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
