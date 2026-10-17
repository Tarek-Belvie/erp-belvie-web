import { useEffect, useState } from "react";
import { AchatDetaille, CATEGORIES_ACHAT_LABELS, StatutAchat } from "../../shared/types";

const STATUT_LABELS: Record<StatutAchat, string> = { provisoire: "Provisoire", paye: "Payé", partiellement_paye: "Partiel", a_payer: "À payer" };
const STATUT_COULEURS: Record<StatutAchat, string> = { provisoire: "var(--v2-warning)", paye: "var(--v2-green-dark)", partiellement_paye: "var(--v2-warning)", a_payer: "var(--v2-text-2)" };

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

interface Props {
  onOpen: (id: number) => void;
  onNouveau: () => void;
}

export default function FinanceAchats({ onOpen, onNouveau }: Props) {
  const [achats, setAchats] = useState<AchatDetaille[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    window.api.finance.listAchatsDetailles({})
      .then((l) => setAchats(l))
      .catch((err: any) => setErreur(err?.message || "Erreur lors du chargement."))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="empty-state">Chargement...</p>;
  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;

  return (
    <div>
      {achats.length === 0 ? (
        <div className="finance-etat-vide">
          <div className="finance-etat-vide-titre">Aucun achat enregistré</div>
          <p>Créez un achat directement, ou depuis la fiche d'un fournisseur.</p>
          <button className="btn primary" onClick={onNouveau}>+ Nouvel achat</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <button className="btn primary" onClick={onNouveau}>+ Nouvel achat</button>
          </div>

          <div className="finance-tableau">
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Fournisseur</th><th style={{ textAlign: "left" }}>Catégorie</th>
                  <th style={{ textAlign: "left" }}>Production</th><th>Engagé</th><th>Facturé</th><th>Payé</th>
                  <th>Reste à payer</th><th>Statut</th>
                </tr>
              </thead>
              <tbody>
                {achats.map((a) => (
                  <tr key={a.id} onClick={() => onOpen(a.id)} style={{ cursor: "pointer" }}>
                    <td className="grid-row-label">{a.fournisseur_nom}</td>
                    <td>{CATEGORIES_ACHAT_LABELS[a.categorie]}</td>
                    <td style={{ fontSize: 12 }}>
                      {a.commande_numero ? a.commande_numero : a.nb_affectations > 0 ? `Partagé (${a.nb_affectations})` : <span style={{ color: "var(--v2-text-3)" }}>—</span>}
                    </td>
                    <td>{formatMontant(a.montant_engage)}</td>
                    <td>{formatMontant(a.facture_reel)}</td>
                    <td>{formatMontant(a.paye)}</td>
                    <td>{formatMontant(a.reste_a_payer)}</td>
                    <td><span className="finance-statut-pastille" style={{ color: STATUT_COULEURS[a.statut], borderColor: STATUT_COULEURS[a.statut] }}>{STATUT_LABELS[a.statut]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
