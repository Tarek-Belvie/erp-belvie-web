import { useEffect, useState } from "react";
import BesoinsListe from "./BesoinsListe";
import BesoinsDetail from "./BesoinsDetail";
import PreparationBons from "./PreparationBons";
import BonsListe from "./BonsListe";
import BonDetail from "./BonDetail";
import { STYLES_APPRO, STYLES_BONS_MP } from "./approvisionnementTypes";

// Module Approvisionnement — coquille de navigation.
//
// Une seule pile de navigation, sur le modèle déjà en place dans Finance : chaque écran est une
// PAGE pleine largeur, atteinte par un fil d'Ariane cliquable. Pas de panneau, pas de pop-up, et
// surtout pas de détail déroulé sous la liste : la liste sert à choisir, le détail à travailler.
//
// Les routes sont déclarées ici et nulle part ailleurs. Les écrans, eux, ne connaissent que des
// fonctions de rappel (`onOuvrir`, `onRetour`) : aucun d'eux ne sait où il se trouve dans la
// navigation. C'est ce qui a permis d'ajouter les bons de commande MP sans toucher aux deux
// écrans existants.
//
// La barre d'onglets apparaît maintenant : il y a deux écrans principaux, les besoins et les
// bons. Avec un seul, ce n'était pas une navigation mais une décoration.

type Route =
  | { kind: "besoins" }
  | { kind: "besoins-detail"; commandeId: number; libelle: string }
  | { kind: "bons" }
  | { kind: "preparation"; commandes?: number[] }
  | { kind: "bon"; bonId: number; numero: string };

type Onglet = "besoins" | "bons";

const ONGLET_DE: Record<Route["kind"], Onglet> = {
  "besoins": "besoins",
  "besoins-detail": "besoins",
  "bons": "bons",
  "preparation": "bons",
  "bon": "bons",
};

function filAriane(route: Route): { label: string; route: Route }[] {
  if (ONGLET_DE[route.kind] === "besoins") {
    const fil: { label: string; route: Route }[] = [
      { label: "Besoins et consommations", route: { kind: "besoins" } },
    ];
    if (route.kind === "besoins-detail") fil.push({ label: route.libelle, route });
    return fil;
  }
  const fil: { label: string; route: Route }[] = [
    { label: "Bons de commande MP", route: { kind: "bons" } },
  ];
  if (route.kind === "preparation") fil.push({ label: "Préparation", route });
  if (route.kind === "bon") fil.push({ label: route.numero, route });
  return fil;
}

const SOUS_TITRES: Record<Route["kind"], string> = {
  "besoins": "Calcul des matières et fournitures nécessaires aux productions en cours",
  "besoins-detail": "Besoins d'une production, du besoin brut au reste à commander",
  "bons": "Bons de commande matières et fournitures, par fournisseur",
  "preparation": "Regrouper les besoins de plusieurs productions en bons de commande",
  "bon": "Détail d'un bon de commande matières",
};

interface Props {
  /** Productions pour lesquelles un autre module (Commandes de production) demande la préparation
   *  d'un bon MP. La valeur change à chaque demande — même pour la même production — afin que
   *  deux demandes successives soient bien deux demandes. */
  demandeBcMp?: { commandes: number[]; jeton: number } | null;
}

export default function ApprovisionnementPage({ demandeBcMp }: Props) {
  const [route, setRoute] = useState<Route>({ kind: "besoins" });

  // Une demande venue d'ailleurs ouvre directement la préparation, production déjà sélectionnée.
  // On réagit au JETON et non au tableau : un tableau recréé à chaque rendu rouvrirait l'écran en
  // boucle, et l'utilisateur ne pourrait plus en sortir.
  useEffect(() => {
    if (demandeBcMp && demandeBcMp.commandes.length > 0) {
      setRoute({ kind: "preparation", commandes: demandeBcMp.commandes });
    }
  }, [demandeBcMp?.jeton]);
  // Compteur de rafraîchissement : la liste des bons se relit quand un bon est créé, modifié ou
  // supprimé ailleurs dans le module. Un simple nombre suffit — la liste ne cherche pas à savoir
  // CE qui a changé, seulement qu'il faut relire.
  const [versionBons, setVersionBons] = useState(0);
  const fil = filAriane(route);
  const onglet = ONGLET_DE[route.kind];

  return (
    <div>
      {/* Les styles du module sont injectés ICI, une seule fois, et non par chaque écran : deux
          blocs <style> identiques dans la page seraient deux endroits à corriger. */}
      <style>{STYLES_APPRO}</style>
      <style>{STYLES_BONS_MP}</style>

      <div className="topline">
        <div>
          <div className="page-title">Approvisionnement</div>
          <div className="page-sub">{SOUS_TITRES[route.kind]}</div>
        </div>
      </div>

      <div className="bcmp-etapes" style={{ marginBottom: 16, gap: 4 }}>
        <button
          className={onglet === "besoins" ? "btn tiny" : "btn ghost tiny"}
          onClick={() => setRoute({ kind: "besoins" })}
        >
          Besoins
        </button>
        <button
          className={onglet === "bons" ? "btn tiny" : "btn ghost tiny"}
          onClick={() => setRoute({ kind: "bons" })}
        >
          Bons de commande MP
        </button>
      </div>

      {fil.length > 1 && (
        <div className="finance-fil-ariane">
          {fil.map((m, i) => (
            <span key={i}>
              {i > 0 && <span className="finance-fil-sep">/</span>}
              {i === fil.length - 1
                ? <span className="finance-fil-actuel">{m.label}</span>
                : <button onClick={() => setRoute(m.route)}>{m.label}</button>}
            </span>
          ))}
        </div>
      )}

      {/* La liste reste MONTÉE pendant qu'on consulte un détail, simplement masquée. Démontée, elle
          perdrait la recherche en cours, le filtre, le tri et la position de défilement, et
          surtout elle recalculerait l'état d'approvisionnement de toutes les commandes à chaque
          retour. Revenir à la liste doit la retrouver telle qu'on l'a laissée. */}
      <div hidden={route.kind !== "besoins"}>
        <BesoinsListe
          onOuvrir={(commandeId, libelle) => setRoute({ kind: "besoins-detail", commandeId, libelle })}
          onPreparer={(commandes) => setRoute({ kind: "preparation", commandes })}
        />
      </div>

      {route.kind === "besoins-detail" && (
        <BesoinsDetail
          commandeId={route.commandeId}
          onRetour={() => setRoute({ kind: "besoins" })}
        />
      )}

      {route.kind === "bons" && (
        <BonsListe
          rafraichir={versionBons}
          onOuvrir={(bonId, numero) => setRoute({ kind: "bon", bonId, numero })}
          onPreparer={() => setRoute({ kind: "preparation" })}
        />
      )}

      {/* La préparation n'est PAS gardée montée : elle part des besoins, et les besoins changent
          dès qu'un brouillon est enregistré. La remonter force un regroupement à jour, ce qui est
          exactement ce qu'on veut — l'inverse de la liste, qu'on veut retrouver intacte. */}
      {route.kind === "preparation" && (
        <PreparationBons
          commandesInitiales={route.commandes}
          onOuvrirBon={(bonId, numero) => { setVersionBons((v) => v + 1); setRoute({ kind: "bon", bonId, numero }); }}
          onVoirLesBons={() => { setVersionBons((v) => v + 1); setRoute({ kind: "bons" }); }}
        />
      )}

      {route.kind === "bon" && (
        <BonDetail
          bonId={route.bonId}
          onRetour={() => setRoute({ kind: "bons" })}
          onModifie={() => setVersionBons((v) => v + 1)}
        />
      )}
    </div>
  );
}
