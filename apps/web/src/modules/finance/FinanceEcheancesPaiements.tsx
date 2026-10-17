import { useEffect, useState } from "react";
import { FactureAvecEcheance, PaiementDetaille, StatutFactureEcheance, StatutAffectationPaiement, TypePaiement } from "../../shared/types";
import { labelJour } from "../../shared/dateLabels";

type SousVue = "echeances" | "paiements";
type FiltreEcheance = "en_retard" | "7j" | "30j" | "ce_mois" | "toutes";

const FILTRE_LABELS: Record<FiltreEcheance, string> = {
  en_retard: "En retard", "7j": "7 jours", "30j": "30 jours", ce_mois: "Ce mois", toutes: "Toutes",
};
const STATUT_ECHEANCE_LABELS: Record<StatutFactureEcheance, string> = { payee: "Payée", partiel: "Partiel", en_retard: "En retard", a_payer: "À payer" };
const STATUT_ECHEANCE_COULEURS: Record<StatutFactureEcheance, string> = { payee: "var(--v2-green-dark)", partiel: "var(--v2-warning)", en_retard: "var(--v2-danger)", a_payer: "var(--v2-text-2)" };
const STATUT_AFFECTATION_LABELS: Record<StatutAffectationPaiement, string> = { totalement_affecte: "Affecté", partiellement_affecte: "Partiel", non_affecte: "Non affecté" };
const STATUT_AFFECTATION_COULEURS: Record<StatutAffectationPaiement, string> = { totalement_affecte: "var(--v2-green-dark)", partiellement_affecte: "var(--v2-warning)", non_affecte: "var(--v2-warning)" };
const TYPE_LABELS: Record<TypePaiement, string> = { reglement: "Paiement", avance: "Avance" };

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

interface Props {
  onAjouterFacture: () => void;
  onNouveauPaiement: () => void;
}

// Remplace progressivement le fichier Excel de suivi : deux sous-vues dans la même page, jamais
// bloquée par l'absence de données. Une échéance est TOUJOURS dérivée d'une facture existante —
// jamais ressaisie séparément.
export default function FinanceEcheancesPaiements({ onAjouterFacture, onNouveauPaiement }: Props) {
  const [sousVue, setSousVue] = useState<SousVue>("echeances");
  const [filtre, setFiltre] = useState<FiltreEcheance>("toutes");
  const [factures, setFactures] = useState<FactureAvecEcheance[]>([]);
  const [paiements, setPaiements] = useState<PaiementDetaille[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function charger() {
    try {
      const [f, p] = await Promise.all([
        window.api.finance.listFacturesAvecEcheances({ statutFiltre: filtre }),
        window.api.finance.listPaiementsEtAvances(),
      ]);
      setFactures(f);
      setPaiements(p);
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => { charger(); }, [filtre]);

  if (!loaded) return <p className="empty-state">Chargement...</p>;
  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;

  return (
    <div>
      <div className="finance-onglets-panel" style={{ maxWidth: 360, marginBottom: 18 }}>
        <button className={sousVue === "echeances" ? "active" : ""} onClick={() => setSousVue("echeances")}>Échéances</button>
        <button className={sousVue === "paiements" ? "active" : ""} onClick={() => setSousVue("paiements")}>Paiements & avances</button>
      </div>

      {sousVue === "echeances" ? (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14, flexWrap: "wrap", gap: 10 }}>
            <div className="finance-filtres-pastilles">
              {(Object.keys(FILTRE_LABELS) as FiltreEcheance[]).map((f) => (
                <button key={f} className={`finance-filtre-pastille ${filtre === f ? "active" : ""}`} onClick={() => setFiltre(f)}>{FILTRE_LABELS[f]}</button>
              ))}
            </div>
            <button className="btn primary tiny" onClick={onAjouterFacture}>+ Ajouter une facture</button>
          </div>

          {factures.length === 0 ? (
            <div className="finance-etat-vide">
              <div className="finance-etat-vide-titre">Aucune échéance à payer</div>
              <p>Les échéances apparaissent automatiquement ici à partir des factures fournisseurs enregistrées.</p>
              <button className="btn primary" onClick={onAjouterFacture}>+ Ajouter une facture</button>
            </div>
          ) : (
            <div className="finance-tableau">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Fournisseur</th><th style={{ textAlign: "left" }}>N° facture</th>
                    <th>Échéance</th><th>TTC</th><th>Déjà payé</th><th>Reste</th><th style={{ textAlign: "left" }}>Mode prévu</th><th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {factures.map((f) => (
                    <tr key={f.facture_id}>
                      <td className="grid-row-label">{f.fournisseur_nom}</td>
                      <td>{f.reference_facture || "—"}</td>
                      <td>{f.date_echeance ? labelJour(f.date_echeance) : "—"}</td>
                      <td>{formatMontant(f.montant_ttc)}</td>
                      <td>{formatMontant(f.paye)}</td>
                      <td>{formatMontant(f.reste)}</td>
                      <td>{f.mode_prevu || "—"}</td>
                      <td>
                        <span className="finance-statut-pastille" style={{ color: STATUT_ECHEANCE_COULEURS[f.statut], borderColor: STATUT_ECHEANCE_COULEURS[f.statut] }}>
                          {STATUT_ECHEANCE_LABELS[f.statut]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p style={{ fontSize: 11, color: "var(--v2-text-3)", marginTop: 10 }}>
            "Déjà payé" et "Reste" sont calculés sur le montant HT de la facture (logique déjà validée pour les statuts) — la retenue à la source n'est pas encore prise en compte ici.
          </p>
        </>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <button className="btn primary tiny" onClick={onNouveauPaiement}>+ Nouveau paiement / avance</button>
          </div>

          {paiements.length === 0 ? (
            <div className="finance-etat-vide">
              <div className="finance-etat-vide-titre">Aucun paiement enregistré</div>
              <p>Vous pouvez enregistrer un règlement lié à une facture, ou une avance fournisseur même sans facture — elle restera disponible comme crédit jusqu'à son affectation.</p>
              <button className="btn primary" onClick={onNouveauPaiement}>+ Nouveau paiement / avance</button>
            </div>
          ) : (
            <div className="finance-tableau">
              <table className="grid-table">
                <thead>
                  <tr>
                    <th>Date</th><th style={{ textAlign: "left" }}>Fournisseur</th><th>Type</th><th>Montant</th>
                    <th style={{ textAlign: "left" }}>Mode</th><th>Affecté</th><th>Non affecté</th><th style={{ textAlign: "left" }}>Référence</th><th>Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {paiements.map((p) => (
                    <tr key={p.id}>
                      <td>{labelJour(p.date_paiement)}</td>
                      <td className="grid-row-label">{p.fournisseur_nom}</td>
                      <td>{TYPE_LABELS[p.type]}</td>
                      <td>{formatMontant(p.montant)}</td>
                      <td>{p.mode || "—"}</td>
                      <td>{formatMontant(p.affecte)}</td>
                      <td>{formatMontant(p.non_affecte)}</td>
                      <td>{p.reference || "—"}</td>
                      <td>
                        <span className="finance-statut-pastille" style={{ color: STATUT_AFFECTATION_COULEURS[p.statut], borderColor: STATUT_AFFECTATION_COULEURS[p.statut] }}>
                          {STATUT_AFFECTATION_LABELS[p.statut]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
