import { useEffect, useState } from "react";
import { Entreprise } from "../../shared/types";
import { checkProfilGeneral } from "../../shared/entrepriseRequirements";
import { mediaUrl } from "../commandes/uiHelpers";
import Icon from "../../shared/Icon";
import EntrepriseWizard from "../entreprise/EntrepriseWizard";

export default function EntrepriseSection() {
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  async function refresh() {
    const e = await window.api.entreprise.get();
    setEntreprise(e);
    setLoaded(true);
  }
  useEffect(() => { refresh(); }, []);

  if (!loaded) return null;

  const profil = checkProfilGeneral(entreprise);
  const nom = entreprise?.nom_commercial || entreprise?.raison_sociale;

  return (
    <div className="settings-section">
      <h3>Informations de l'entreprise</h3>
      <p className="desc">
        Nom, coordonnées et logo réutilisés automatiquement dans les futurs documents de l'ERP (bons de commande, factures, bons de livraison, PDF).
      </p>

      <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 12 }}>
        <div className="v2-photo-frame" style={{ width: 56, height: 56, flexShrink: 0 }}>
          {entreprise?.logo_path ? (
            <img src={mediaUrl(entreprise.logo_path)!} alt="" style={{ objectFit: "contain", padding: 6 }} />
          ) : (
            <Icon name="building-factory" size={20} />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14.5 }}>{nom || "Entreprise non configurée"}</div>
          <span className={`v2-badge ${profil.ok ? "v2-badge-terminee" : "v2-badge-bloquee"}`} style={{ marginTop: 4, display: "inline-flex" }}>
            {profil.ok ? "Complet" : "Informations incomplètes"}
          </span>
        </div>
        <button className="btn ghost" onClick={() => setShowWizard(true)}>
          {entreprise ? "Modifier" : "Configurer"}
        </button>
      </div>

      {showWizard && (
        <EntrepriseWizard
          onClose={() => setShowWizard(false)}
          onSaved={() => { setShowWizard(false); refresh(); }}
        />
      )}
    </div>
  );
}
