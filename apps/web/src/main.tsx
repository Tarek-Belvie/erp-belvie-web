// En premier : installe window.api avant le chargement des écrans (voir api/installer.ts).
import "./api/installer";
import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import LoginScreen from "./LoginScreen";
import { auth, quandSessionExpire } from "./api/client";
import "./styles/global.css";

type Utilisateur = { id: number; email: string; nom: string; role: string };

function Racine() {
  // undefined = vérification en cours ; null = non connecté.
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null | undefined>(undefined);

  useEffect(() => {
    quandSessionExpire(() => setUtilisateur(null));
    auth.moi().then((u) => setUtilisateur(u as Utilisateur)).catch(() => setUtilisateur(null));
  }, []);

  if (utilisateur === undefined) return null;
  if (utilisateur === null) return <LoginScreen onConnecte={(u) => setUtilisateur(u)} />;
  return <App utilisateur={utilisateur} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Racine />
  </React.StrictMode>
);
