import DeclinaisonTypesManager from "./DeclinaisonTypesManager";
import DeclinaisonValeursManager from "./DeclinaisonValeursManager";

export default function DeclinaisonsSection() {
  return (
    <div className="settings-section">
      <h3>Déclinaisons</h3>
      <p className="desc">Les axes de variation utilisables par vos articles (couleur, taille, pointure, tour de taille...) et leurs valeurs. Un article choisit ensuite lesquels il utilise dans sa propre fiche.</p>
      <DeclinaisonTypesManager />
      <DeclinaisonValeursManager />
    </div>
  );
}
