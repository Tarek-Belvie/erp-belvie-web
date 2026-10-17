import { useState } from "react";
import { FinanceRoute, filAriane } from "./FinanceRoute";
import FinanceOverview from "./FinanceOverview";
import FinanceFournisseurs from "./FinanceFournisseurs";
import FinanceFournisseurDetail from "./FinanceFournisseurDetail";
import FinanceFournisseurNouveau from "./FinanceFournisseurNouveau";
import FinanceNouveauPrix from "./FinanceNouveauPrix";
import FinanceNouvelAchat from "./FinanceNouvelAchat";
import FinanceNouvelleFacture from "./FinanceNouvelleFacture";
import FinanceNouveauPaiement from "./FinanceNouveauPaiement";
import FinanceAchats from "./FinanceAchats";
import FinanceAchatDetail from "./FinanceAchatDetail";
import FinanceCoutsProduits from "./FinanceCoutsProduits";
import FinanceEstimationPage from "./FinanceEstimationPage";
import FinanceEcheancesPaiements from "./FinanceEcheancesPaiements";

const ONGLETS_PRINCIPAUX: { kind: FinanceRoute["kind"]; label: string; disponible: boolean }[] = [
  { kind: "apercu", label: "Vue d'ensemble", disponible: true },
  { kind: "couts-produits", label: "Coûts produits", disponible: true },
  { kind: "achats", label: "Dépenses & factures", disponible: true },
  { kind: "echeances-paiements", label: "Échéances & paiements", disponible: true },
  { kind: "fournisseurs", label: "Fournisseurs", disponible: true },
];

// Onglet principal actif (pour surligner le bon en-tête), déduit de la racine du fil d'Ariane.
function ongletPrincipalDe(route: FinanceRoute): FinanceRoute["kind"] {
  if (route.kind === "fournisseurs" || route.kind === "fournisseur" || route.kind === "fournisseur-form" || route.kind === "fournisseur-nouveau") return "fournisseurs";
  if (route.kind === "achats" || route.kind === "achats-nouveau" || route.kind === "achat") return "achats";
  if (route.kind === "couts-produits" || route.kind === "estimation") return "couts-produits";
  if (route.kind === "echeances-paiements" || route.kind === "nouveau-paiement-global") return "echeances-paiements";
  return "apercu";
}

export default function FinancePage() {
  const [route, setRoute] = useState<FinanceRoute>({ kind: "apercu" });
  const [refreshTick, setRefreshTick] = useState(0);
  function bump() { setRefreshTick((t) => t + 1); }

  const principal = ongletPrincipalDe(route);
  const fil = filAriane(route);

  return (
    <div className="finance-page">
      <div className="topline">
        <div>
          <div className="page-title">Finance</div>
          <div className="page-sub">Pilotage des coûts, fournisseurs et échéances — liés aux achats et productions, sans double saisie</div>
        </div>
      </div>

      <div className="finance-onglets">
        {ONGLETS_PRINCIPAUX.map((o, i) => (
          <button
            key={i}
            className={`finance-onglet ${principal === o.kind && o.disponible ? "active" : ""} ${!o.disponible ? "bientot" : ""}`}
            onClick={() => o.disponible && setRoute({ kind: o.kind } as FinanceRoute)}
            disabled={!o.disponible}
            title={!o.disponible ? "Bientôt disponible" : undefined}
          >
            {o.label}
          </button>
        ))}
      </div>

      {fil.length > 1 && (
        <div className="finance-fil-ariane">
          {fil.map((m, i) => (
            <span key={i}>
              {i > 0 && <span className="finance-fil-sep">/</span>}
              {i === fil.length - 1 ? (
                <span className="finance-fil-actuel">{m.label}</span>
              ) : (
                <button onClick={() => setRoute(m.route)}>{m.label}</button>
              )}
            </span>
          ))}
        </div>
      )}

      <div key={refreshTick}>
        {route.kind === "apercu" && <FinanceOverview />}

        {route.kind === "fournisseurs" && (
          <FinanceFournisseurs
            onOpen={(id, nom) => setRoute({ kind: "fournisseur", id, nom })}
            onNouveau={() => setRoute({ kind: "fournisseur-nouveau" })}
          />
        )}
        {route.kind === "fournisseur-nouveau" && (
          <FinanceFournisseurNouveau
            onRetour={() => setRoute({ kind: "fournisseurs" })}
            onCree={(id, nom) => { bump(); setRoute({ kind: "fournisseur", id, nom }); }}
          />
        )}
        {route.kind === "fournisseur" && (
          <FinanceFournisseurDetail
            fournisseurId={route.id}
            onOuvrirForm={(form) => setRoute({ kind: "fournisseur-form", id: route.id, nom: route.nom, form })}
            onOuvrirAchat={(achatId) => setRoute({ kind: "achat", id: achatId, retour: route })}
            onRetourListe={() => { bump(); setRoute({ kind: "fournisseurs" }); }}
          />
        )}
        {route.kind === "fournisseur-form" && route.form === "prix" && (
          <FinanceNouveauPrix fournisseurId={route.id}
            onRetour={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })}
            onEnregistre={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })} />
        )}
        {route.kind === "fournisseur-form" && route.form === "achat" && (
          <FinanceNouvelAchat fournisseurId={route.id}
            onRetour={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })}
            onEnregistre={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })} />
        )}
        {route.kind === "fournisseur-form" && route.form === "facture" && (
          <FinanceNouvelleFacture fournisseurId={route.id}
            onRetour={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })}
            onEnregistre={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })} />
        )}
        {route.kind === "fournisseur-form" && route.form === "paiement" && (
          <FinanceNouveauPaiement fournisseurId={route.id}
            onRetour={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })}
            onEnregistre={() => setRoute({ kind: "fournisseur", id: route.id, nom: route.nom })} />
        )}

        {route.kind === "achats" && (
          <FinanceAchats
            onOpen={(id) => setRoute({ kind: "achat", id, retour: route })}
            onNouveau={() => setRoute({ kind: "achats-nouveau" })}
          />
        )}
        {route.kind === "achats-nouveau" && (
          <FinanceNouvelAchat
            onRetour={() => setRoute({ kind: "achats" })}
            onEnregistre={() => { bump(); setRoute({ kind: "achats" }); }}
          />
        )}
        {route.kind === "achat" && (
          <FinanceAchatDetail achatId={route.id} onRetour={() => setRoute(route.retour)} />
        )}

        {route.kind === "couts-produits" && (
          <FinanceCoutsProduits onOuvrir={(articleId, nom) => setRoute({ kind: "estimation", articleId, nom })} />
        )}
        {route.kind === "estimation" && (
          <FinanceEstimationPage
            articleId={route.articleId}
            nom={route.nom}
            onRetour={() => { bump(); setRoute({ kind: "couts-produits" }); }}
          />
        )}

        {route.kind === "echeances-paiements" && (
          <FinanceEcheancesPaiements
            onAjouterFacture={() => setRoute({ kind: "achats-nouveau" })}
            onNouveauPaiement={() => setRoute({ kind: "nouveau-paiement-global" })}
          />
        )}
        {route.kind === "nouveau-paiement-global" && (
          <FinanceNouveauPaiement
            onRetour={() => setRoute({ kind: "echeances-paiements" })}
            onEnregistre={() => { bump(); setRoute({ kind: "echeances-paiements" }); }}
          />
        )}
      </div>
    </div>
  );
}
