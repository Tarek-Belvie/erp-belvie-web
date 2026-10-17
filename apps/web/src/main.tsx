// ESTELECTRON DOIT être capturé avant tout autre import qui pourrait toucher window.api.
import { ESTELECTRON } from "./api/platform";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LoginScreen from "./LoginScreen";
import { installerShimWebSiNecessaire } from "./api/webApiShim";
import { supabase } from "./api/supabaseClient";
import "./styles/global.css";

if (!ESTELECTRON) installerShimWebSiNecessaire();

function Racine() {
  // Dans Electron, aucune notion de session : l'app s'affiche directement, comportement
  // strictement inchangé — ce composant ne fait rien de plus que rendre <App /> immédiatement.
  const [connecte, setConnecte] = useState(ESTELECTRON ? true : null as boolean | null);

  useEffect(() => {
    if (ESTELECTRON) return;
    if (!supabase) return; // géré explicitement au rendu ci-dessous, jamais un blocage silencieux
    supabase.auth.getSession().then(({ data }) => setConnecte(!!data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setConnecte(!!session));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Erreur visible et explicite — jamais un ecran blanc silencieux si Supabase n'est pas
  // correctement configure au moment du build (VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY).
  if (!ESTELECTRON && !supabase) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", padding: 24, textAlign: "center", fontFamily: "sans-serif" }}>
        <div>
          <h2 style={{ color: "#C0392B" }}>Configuration manquante</h2>
          <p style={{ color: "#6B6B62", maxWidth: 420 }}>
            VITE_SUPABASE_URL et/ou VITE_SUPABASE_PUBLISHABLE_KEY ne sont pas disponibles.
            Vérifiez les variables d'environnement du déploiement, puis relancez un nouveau build
            (ces variables sont injectées au moment de la construction, pas seulement à l'exécution).
          </p>
        </div>
      </div>
    );
  }

  if (connecte === null) return null; // court instant de vérification de session au chargement
  if (!connecte) return <LoginScreen onConnecte={() => setConnecte(true)} />;
  return <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Racine />
  </React.StrictMode>
);
