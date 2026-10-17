import { useEffect, useState } from "react";
import { FournisseurAvecSynthese, CATEGORIES_ACHAT_LABELS, CategorieAchat } from "../../shared/types";
import { labelJour } from "../../shared/dateLabels";

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

interface Props {
  onOpen: (id: number, nom: string) => void;
  onNouveau: () => void;
}

export default function FinanceFournisseurs({ onOpen, onNouveau }: Props) {
  const [fournisseurs, setFournisseurs] = useState<FournisseurAvecSynthese[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    window.api.finance.listFournisseursAvecSynthese({})
      .then((list) => setFournisseurs(list))
      .catch((err: any) => setErreur(err?.message || "Erreur lors du chargement."))
      .finally(() => setLoaded(true));
  }, []);

  if (!loaded) return <p className="empty-state">Chargement...</p>;
  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;

  return (
    <div>
      {fournisseurs.length === 0 ? (
        <div className="finance-etat-vide">
          <div className="finance-etat-vide-titre">Commencez par ajouter un fournisseur</div>
          <p>Enregistrez ensuite ses tarifs et vos premiers achats pour suivre automatiquement vos coûts, factures et échéances.</p>
          <button className="btn primary" onClick={onNouveau}>+ Ajouter un fournisseur</button>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
            <button className="btn primary" onClick={onNouveau}>+ Nouveau fournisseur</button>
          </div>

          <div className="finance-tableau">
            <table className="grid-table">
              <thead>
                <tr><th style={{ textAlign: "left" }}>Nom</th><th style={{ textAlign: "left" }}>Activité</th><th>Dette actuelle</th><th>Prochaine échéance</th></tr>
              </thead>
              <tbody>
                {fournisseurs.map((f) => (
                  <tr key={f.id} onClick={() => onOpen(f.id, f.nom)} style={{ cursor: "pointer" }}>
                    <td className="grid-row-label">{f.nom}</td>
                    <td style={{ color: "var(--v2-text-3)", fontSize: 12.5 }}>
                      {f.activite || (f.categories_achat.length > 0 ? f.categories_achat.map((c) => CATEGORIES_ACHAT_LABELS[c as CategorieAchat]).join(", ") : "—")}
                    </td>
                    <td style={{ fontWeight: f.dette_actuelle > 0 ? 600 : 400, color: f.dette_actuelle > 0 ? "var(--v2-text)" : "var(--v2-text-3)" }}>
                      {formatMontant(f.dette_actuelle)}
                    </td>
                    <td>{f.prochaine_echeance ? labelJour(f.prochaine_echeance) : "—"}</td>
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
