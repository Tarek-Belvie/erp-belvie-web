import { useEffect, useState } from "react";
import { SyntheseGlobaleFinance, EcheanceDetaillee, StatutEcheance } from "../../shared/types";
import { labelJour } from "../../shared/dateLabels";

const STATUT_LABELS: Record<StatutEcheance, string> = {
  payee: "Payé",
  partiellement_payee: "Partiel",
  en_retard: "En retard",
  a_payer: "À payer",
};
const STATUT_COULEURS: Record<StatutEcheance, string> = {
  payee: "var(--v2-green-dark)",
  partiellement_payee: "var(--v2-warning)",
  en_retard: "var(--v2-danger)",
  a_payer: "var(--v2-text-2)",
};

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

export default function FinanceOverview() {
  const [synthese, setSynthese] = useState<SyntheseGlobaleFinance | null>(null);
  const [echeances, setEcheances] = useState<EcheanceDetaillee[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [aucunFournisseur, setAucunFournisseur] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function refresh() {
    try {
      const fournisseurs = await window.api.finance.listFournisseurs({});
      if (fournisseurs.length === 0) { setAucunFournisseur(true); setLoaded(true); return; }
      setAucunFournisseur(false);
      const [s, e] = await Promise.all([
        window.api.finance.syntheseGlobale(),
        window.api.finance.listEcheancesDetaillees({}),
      ]);
      setSynthese(s);
      // Prochaines échéances triées, non encore payées en priorité — vue "pilotage", pas un journal.
      setEcheances(e.filter((x) => x.statut !== "payee").sort((a, b) => a.date_echeance.localeCompare(b.date_echeance)).slice(0, 12));
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => { refresh(); }, []);

  if (!loaded) return <p className="empty-state">Chargement...</p>;
  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;

  if (aucunFournisseur) {
    return (
      <div className="finance-etat-vide">
        <div className="finance-etat-vide-titre">Commencez par ajouter un fournisseur</div>
        <p>Enregistrez ensuite ses tarifs et vos premiers achats pour suivre automatiquement vos coûts, factures et échéances.</p>
        <p style={{ fontSize: 12, color: "var(--v2-text-3)" }}>Rendez-vous dans l'onglet Fournisseurs pour commencer.</p>
      </div>
    );
  }

  if (!synthese) return null;

  return (
    <div>
      <div className="planning-kpis" style={{ marginBottom: 22 }}>
        <div className="planning-kpi">
          <div className="planning-kpi-value">{formatMontant(synthese.total_a_payer)}</div>
          <div className="planning-kpi-label">Total à payer</div>
        </div>
        <div className="planning-kpi">
          <div className="planning-kpi-value">{formatMontant(synthese.echeances_7j)}</div>
          <div className="planning-kpi-label">Échéances 7 jours</div>
        </div>
        <div className="planning-kpi">
          <div className="planning-kpi-value">{formatMontant(synthese.echeances_30j)}</div>
          <div className="planning-kpi-label">Échéances 30 jours</div>
        </div>
        <div className="planning-kpi">
          <div className="planning-kpi-value">{formatMontant(synthese.credit_non_affecte)}</div>
          <div className="planning-kpi-label">Crédit fournisseur non affecté</div>
        </div>
        <div className="planning-kpi">
          <div className="planning-kpi-value">{formatMontant(synthese.cout_provisoire_total)}</div>
          <div className="planning-kpi-label">Coût provisoire ({synthese.nb_achats_provisoires} achat{synthese.nb_achats_provisoires > 1 ? "s" : ""} non totalement facturé{synthese.nb_achats_provisoires > 1 ? "s" : ""})</div>
        </div>
      </div>

      <div className="finance-section-titre">Prochaines échéances</div>
      <div className="finance-tableau">
        <table className="grid-table">
          <thead>
            <tr><th style={{ textAlign: "left" }}>Fournisseur</th><th style={{ textAlign: "left" }}>Document</th><th>Échéance</th><th>Montant</th><th>Payé</th><th>Reste</th><th>Statut</th></tr>
          </thead>
          <tbody>
            {echeances.map((e) => (
              <tr key={e.echeance_id}>
                <td className="grid-row-label">{e.fournisseur_nom}</td>
                <td>{e.document}</td>
                <td>{labelJour(e.date_echeance)}</td>
                <td>{formatMontant(e.montant)}</td>
                <td>{formatMontant(e.paye)}</td>
                <td>{formatMontant(e.reste)}</td>
                <td>
                  <span className="finance-statut-pastille" style={{ color: STATUT_COULEURS[e.statut], borderColor: STATUT_COULEURS[e.statut] }}>
                    {STATUT_LABELS[e.statut]}
                  </span>
                </td>
              </tr>
            ))}
            {echeances.length === 0 && <tr><td colSpan={7} className="empty-state">Aucune échéance en attente.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
