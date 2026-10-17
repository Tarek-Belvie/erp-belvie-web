import ListeManager from "../settings/ListeManager";
import EtapeManager from "../settings/EtapeManager";
import AtelierResponsableManager from "./AtelierResponsableManager";

// Données opérationnelles de fabrication — retirées de Paramètres, qui ne doit contenir que les
// réglages généraux et les référentiels partagés (voir la réorganisation du module Paramètres).
export default function FabricationPage() {
  return (
    <div>
      <div className="topline">
        <div>
          <div className="page-title">Fabrication</div>
          <div className="page-sub">Ateliers, responsables et étapes de production</div>
        </div>
      </div>

      <ListeManager
        type="atelier"
        title="Ateliers de confection"
        description="Ateliers internes ou sous-traitants auxquels une commande peut être confiée."
      />
      <AtelierResponsableManager />
      <EtapeManager />
    </div>
  );
}
