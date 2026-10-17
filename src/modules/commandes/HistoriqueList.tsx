import { EVENEMENT_ICONS, EVENEMENT_LABELS, EVENEMENT_TRANSITIONS, HistoriqueEvenement, ListeValeur, STATUT_LABELS } from "../../shared/types";
import { fmtDateTime } from "./uiHelpers";

interface Props {
  historique: HistoriqueEvenement[];
  operateurs: ListeValeur[];
}

export default function HistoriqueList({ historique, operateurs }: Props) {
  function operateurNom(id: number | null) {
    if (id == null) return "—";
    return operateurs.find((o) => o.id === id)?.nom ?? "Opérateur inconnu";
  }

  const sorted = [...historique].sort((a, b) => {
    const cmp = b.survenu_le.localeCompare(a.survenu_le);
    return cmp !== 0 ? cmp : b.id - a.id;
  });

  if (sorted.length === 0) {
    return <p className="hint">Aucun événement pour le moment.</p>;
  }

  return (
    <div className="historique-list">
      {sorted.map((h) => {
        const transition = EVENEMENT_TRANSITIONS[h.type_evenement];
        return (
          <div className="historique-item" key={h.id}>
            <span className="historique-icon">{EVENEMENT_ICONS[h.type_evenement]}</span>
            <div className="historique-body">
              <div className="historique-title">
                {EVENEMENT_LABELS[h.type_evenement]}
                {transition && (
                  <span className="historique-transition">
                    {transition.de ? STATUT_LABELS[transition.de] : ""}
                    {transition.de && transition.vers ? " → " : ""}
                    {transition.vers ? STATUT_LABELS[transition.vers] : ""}
                  </span>
                )}
              </div>
              <div className="historique-meta">{fmtDateTime(h.survenu_le)} · {operateurNom(h.operateur_id)}</div>
              {h.motif && <div className="historique-motif">Motif : {h.motif}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
