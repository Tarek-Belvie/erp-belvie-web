import { useState } from "react";
import ListeManager from "./ListeManager";
import OperateurActifSelector from "./OperateurActifSelector";
import DemoDataSection from "./DemoDataSection";
import EntrepriseSection from "./EntrepriseSection";
import DeclinaisonsSection from "./DeclinaisonsSection";
import GrillesTaillesManager from "./GrillesTaillesManager";
import PostesCoutSection from "./PostesCoutSection";
import SauvegardeSection from "./SauvegardeSection";

interface Props {
  onOperateurChanged?: () => void;
}

type Famille = "general" | "catalogue" | "tailles" | "finance" | "donnees";

const FAMILLES: { key: Famille; label: string; sous: string }[] = [
  { key: "general", label: "Général", sous: "Opérateur actif, opérateurs, informations de l'entreprise" },
  { key: "catalogue", label: "Catalogue produit", sous: "Types de produits, catégories, saisons, rayons, couleurs, coupes" },
  { key: "tailles", label: "Tailles et variantes", sous: "Grilles de tailles, déclinaisons" },
  { key: "finance", label: "Finance", sous: "Postes de coût — vos habitudes de calcul récurrentes" },
  { key: "donnees", label: "Données et maintenance", sous: "Sauvegarde, export, données de démonstration" },
];

export default function SettingsPage({ onOperateurChanged }: Props) {
  const [toast, setToast] = useState<string | null>(null);
  const [famille, setFamille] = useState<Famille>("general");

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleExport(format: "csv" | "xlsx") {
    const res = await window.api.system.exportFile(format);
    if (!res.canceled) notify(`Export ${format.toUpperCase()} enregistré : ${res.filePath}`);
  }

  return (
    <div>
      <div className="topline">
        <div>
          <div className="page-title">Paramètres</div>
          <div className="page-sub">Réglages généraux et référentiels partagés — les données opérationnelles vivent dans leur module métier (Fabrication, Fiches techniques...)</div>
        </div>
      </div>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div style={{ width: 220, flexShrink: 0, position: "sticky", top: 16 }}>
          {FAMILLES.map((f) => (
            <div
              key={f.key}
              onClick={() => setFamille(f.key)}
              style={{
                padding: "10px 12px", borderRadius: 8, cursor: "pointer", marginBottom: 4,
                background: famille === f.key ? "#ECFDF5" : "transparent",
                borderLeft: famille === f.key ? "3px solid #0E9F6E" : "3px solid transparent",
              }}
            >
              <div style={{ fontWeight: 600, fontSize: 13.5, color: famille === f.key ? "#047857" : "#1A1B17" }}>{f.label}</div>
              <div style={{ fontSize: 11, color: "#8A8A82", marginTop: 2 }}>{f.sous}</div>
            </div>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {famille === "general" && (
            <>
              <OperateurActifSelector onChanged={onOperateurChanged} />
              <ListeManager
                type="operateur"
                title="Opérateurs"
                description="Les personnes qui utilisent l'ERP et déclenchent les actions (validation, lancement, blocage...). Différent du Responsable, qui pilote la commande (module Fabrication)."
              />
              <EntrepriseSection />
            </>
          )}

          {famille === "catalogue" && (
            <>
              <ListeManager
                type="produit"
                title="Types de produits"
                description="Liste des produits proposés à la création d'un article. Désactiver un produit ne touche pas les articles déjà créés avec ce produit."
              />
              <ListeManager
                type="categorie"
                title="Catégories"
                description="Classement libre des produits, indépendant du type de produit lui-même."
              />
              <ListeManager
                type="saison"
                title="Saisons"
                description="Utilisées dans la référence des articles. Le code ne doit pas contenir l'année (ex: FW pour Automne-Hiver, pas FW26)."
                orderable
                coded
              />
              <ListeManager
                type="rayon"
                title="Rayons"
                description="Genre / univers du produit. Utilisés dans la référence des articles (ex: M pour Homme, W pour Femme)."
                orderable
                coded
              />
              <ListeManager
                type="couleur"
                title="Couleurs"
                description="Liste des couleurs proposées à la création d'une commande."
              />
              <ListeManager
                type="coupe"
                title="Coupes (Fits)"
                description="Caractéristique du produit lui-même (Regular, Slim, Oversize, Relaxed...) — ne concerne pas la fabrication."
              />
            </>
          )}

          {famille === "tailles" && (
            <>
              <GrillesTaillesManager />
              <DeclinaisonsSection />
            </>
          )}

          {famille === "finance" && (
            <PostesCoutSection />
          )}

          {famille === "donnees" && (
            <>
              <SauvegardeSection notify={notify} />

              <div className="settings-section">
                <h3>Export des commandes</h3>
                <p className="desc">Exporte l'ensemble des commandes actives et archivées (hors supprimées) vers un fichier partageable.</p>
                <div className="settings-actions">
                  <button className="btn ghost" onClick={() => handleExport("xlsx")}>Exporter en Excel (.xlsx)</button>
                  <button className="btn ghost" onClick={() => handleExport("csv")}>Exporter en CSV</button>
                </div>
              </div>

              <DemoDataSection onChanged={onOperateurChanged} />
            </>
          )}
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
