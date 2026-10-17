import { useEffect, useState } from "react";
import CommandesPage from "./modules/commandes/CommandesPage";
import PlanningPage from "./modules/planning/PlanningPage";
import ArticlesPage from "./modules/articles/ArticlesPage";
import FichesTechniquesPage from "./modules/ficheTechnique/FichesTechniquesPage";
import ApprovisionnementPage from "./modules/approvisionnement/ApprovisionnementPage";
import FabricationPage from "./modules/fabrication/FabricationPage";
import FinancePage from "./modules/finance/FinancePage";
import SettingsPage from "./modules/settings/SettingsPage";
import EntrepriseWizard from "./modules/entreprise/EntrepriseWizard";
import { ListeValeur } from "./shared/types";
import { auth } from "./api/client";

// Chaque futur module (Stock, Qualité...) s'ajoute ici comme une simple entrée.
const NAV_ITEMS = [
  { key: "planification", label: "Planification", icon: "🗓️" },
  { key: "commandes", label: "Commandes de production", icon: "🧵" },
  { key: "articles", label: "Articles", icon: "🏷️" },
  { key: "fichesTechniques", label: "Fiches techniques", icon: "📐" },
  // Placé entre la définition technique et la fabrication : on achète la matière après avoir
  // défini le produit, et avant de le fabriquer. C'est l'ordre réel de l'atelier.
  { key: "approvisionnement", label: "Approvisionnement", icon: "📦" },
  { key: "fabrication", label: "Fabrication", icon: "🏭" },
  { key: "finance", label: "Finance", icon: "💰" },
  { key: "parametres", label: "Paramètres", icon: "⚙️" },
] as const;

type NavKey = (typeof NAV_ITEMS)[number]["key"];

export default function App({ utilisateur }: { utilisateur: { nom: string; email: string; role: string } }) {
  const [active, setActive] = useState<NavKey>("commandes");
  const [operateurActif, setOperateurActif] = useState<ListeValeur | null | undefined>(undefined);
  const [showFirstLaunchWizard, setShowFirstLaunchWizard] = useState(false);
  // Demande de préparation d'un bon MP venue des Commandes de production. Le jeton distingue deux
  // demandes portant sur la même production : sans lui, la seconde ne déclencherait rien.
  const [demandeBcMp, setDemandeBcMp] = useState<{ commandes: number[]; jeton: number } | null>(null);

  function preparerBcMp(commandeIds: number[]) {
    setDemandeBcMp({ commandes: commandeIds, jeton: Date.now() });
    setActive("approvisionnement");
  }

  async function refreshOperateurActif() {
    const op = await window.api.parametres.getOperateurActif();
    setOperateurActif(op);
  }
  useEffect(() => { refreshOperateurActif(); }, []);

  // Premier lancement : dépend UNIQUEMENT de l'état explicite de l'assistant, jamais du contenu
  // de la table entreprise (qui pourrait exister sans que l'assistant ait jamais été montré, par
  // exemple après une restauration de sauvegarde ou un import futur).
  useEffect(() => {
    async function checkFirstLaunch() {
      const etat = await window.api.entreprise.getEtatWizard();
      if (etat === "never_shown") setShowFirstLaunchWizard(true);
    }
    checkFirstLaunch();
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">Belvie <span>ERP</span></div>
        <nav>
          {NAV_ITEMS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${active === item.key ? "active" : ""}`}
              onClick={() => setActive(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div style={{ fontSize: 12, marginBottom: 6 }} title={utilisateur.email}>{utilisateur.nom}</div>
          <button
            className="btn ghost tiny"
            style={{ color: "inherit", borderColor: "currentColor", background: "transparent" }}
            onClick={async () => { await auth.deconnexion().catch(() => {}); window.location.reload(); }}
          >Se déconnecter</button>
        </div>
      </aside>
      <main className="content">
        {operateurActif === null && (
          <div className="operateur-banner">
            ⚠️ Aucun opérateur actif n'est sélectionné. La consultation reste possible, mais valider, lancer,
            bloquer, annuler ou archiver une commande est impossible tant que vous n'en avez pas choisi un.
            <button className="btn ghost tiny" onClick={() => setActive("parametres")}>Choisir un opérateur</button>
          </div>
        )}
        {active === "planification" && <PlanningPage />}
        {active === "commandes" && (
          <CommandesPage operateurActif={operateurActif ?? null} onPreparerBcMp={preparerBcMp} />
        )}
        {active === "articles" && <ArticlesPage />}
        {active === "fichesTechniques" && <FichesTechniquesPage />}
        {/* Le module gère sa propre navigation interne (liste puis page de détail), comme
            Finance. Les bons de commande MP, les fournisseurs et les réceptions viendront aux
            étapes suivantes — ils ne sont pas affichés tant qu'ils n'existent pas, plutôt que de
            laisser des onglets vides. */}
        {active === "approvisionnement" && <ApprovisionnementPage demandeBcMp={demandeBcMp} />}
        {active === "fabrication" && <FabricationPage />}
        {active === "finance" && <FinancePage />}
        {active === "parametres" && <SettingsPage onOperateurChanged={refreshOperateurActif} />}
      </main>

      {showFirstLaunchWizard && (
        <EntrepriseWizard
          firstLaunch
          onClose={() => setShowFirstLaunchWizard(false)}
          onSaved={() => setShowFirstLaunchWizard(false)}
        />
      )}
    </div>
  );
}
