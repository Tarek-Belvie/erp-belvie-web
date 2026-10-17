import { useEffect, useState } from "react";
import { IntervalleGradation, SimulationGradation } from "../../shared/types";
import { ftInputStyle, FT_BORDER_COLOR, FT_TEXT_SECONDARY } from "./FTChamps";

/**
 * Zone de gradation d'UNE ligne de mesure, dépliée sous la ligne (une <tr> supplémentaire, pas une
 * popup). Fermée, seul un résumé discret subsiste sous le nom de la mesure : le tableau de valeurs
 * reste l'élément prioritaire de l'écran.
 *
 * Rien n'est jamais recalculé pendant la frappe. Le bouton « Appliquer » est la seule action qui
 * écrit, et il n'écrase aucune valeur existante tant que le mode « tout » n'a pas été choisi
 * explicitement.
 */

interface Props {
  ficheId: number;
  mesureCatalogueId: number;
  nbColonnes: number;
  onApplique: () => void;
  onError: (msg: string) => void;
}

/** Affichage à la française, et jamais de "1.5" à l'écran. */
export function formaterGradation(v: number | null): string {
  if (v == null) return "";
  const s = String(v).replace(".", ",");
  return v > 0 ? `+${s}` : s;
}

export default function FTGradationRow({ ficheId, mesureCatalogueId, nbColonnes, onApplique, onError }: Props) {
  const [intervalles, setIntervalles] = useState<IntervalleGradation[]>([]);
  const [simulation, setSimulation] = useState<SimulationGradation | null>(null);
  const [confirmEcrasement, setConfirmEcrasement] = useState(false);

  async function recharger() {
    try {
      setIntervalles(await window.api.ficheTechnique.intervallesGradation(ficheId, mesureCatalogueId));
    } catch (err: any) {
      onError(err?.message || "Chargement des gradations impossible.");
    }
  }
  useEffect(() => { recharger(); }, [ficheId, mesureCatalogueId]);

  async function enregistrer(iv: IntervalleGradation, brut: string) {
    try {
      await window.api.ficheTechnique.setGradation(ficheId, mesureCatalogueId, iv.taille_depart_id, iv.taille_arrivee_id, brut.trim());
      await recharger();
      setSimulation(null);
    } catch (err: any) {
      onError(err?.message || "Gradation invalide.");
      await recharger();
    }
  }

  async function previsualiser() {
    try {
      const sim: SimulationGradation = await window.api.ficheTechnique.simulerGradation(ficheId, mesureCatalogueId, null);
      setSimulation(sim);
      if (!sim.possible) onError(sim.raison || "Calcul impossible.");
    } catch (err: any) {
      onError(err?.message || "Calcul impossible.");
    }
  }

  async function appliquer(mode: "vides" | "tout") {
    try {
      const r = await window.api.ficheTechnique.appliquerGradation(ficheId, mesureCatalogueId, null, mode);
      setConfirmEcrasement(false);
      setSimulation(null);
      onApplique();
      if (r.ecrites === 0) onError("Aucune cellule à remplir : toutes les valeurs concernées existent déjà.");
    } catch (err: any) {
      onError(err?.message || "Application impossible.");
    }
  }

  if (intervalles.length === 0) {
    return (
      <tr>
        <td colSpan={nbColonnes} style={{ background: "#FAFBF7", fontSize: 12.5, color: FT_TEXT_SECONDARY, padding: "8px 10px" }}>
          Au moins deux tailles sont nécessaires pour définir une gradation.
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td colSpan={nbColonnes} style={{ background: "#FAFBF7", padding: "10px 12px", borderBottom: `1px solid ${FT_BORDER_COLOR}` }}>
        <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: ".03em", color: "#55564E", fontWeight: 600, marginBottom: 6 }}>
          Gradation
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", alignItems: "flex-end" }}>
          {intervalles.map((iv) => (
            <div key={`${iv.taille_depart_id}-${iv.taille_arrivee_id}`} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11, color: FT_TEXT_SECONDARY, marginBottom: 2 }}>
                {iv.depart_nom} → {iv.arrivee_nom}
              </div>
              <input
                type="text"
                defaultValue={iv.valeur != null ? String(iv.valeur).replace(".", ",") : ""}
                placeholder="—"
                onBlur={(e) => enregistrer(iv, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                style={{ ...ftInputStyle, width: 56, textAlign: "center" }}
              />
            </div>
          ))}

          <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
            <button className="btn ghost tiny" onClick={previsualiser}>Prévisualiser</button>
            <button
              className="btn tiny"
              onClick={async () => {
                const sim: SimulationGradation = await window.api.ficheTechnique.simulerGradation(ficheId, mesureCatalogueId, null);
                if (!sim.possible) { onError(sim.raison || "Calcul impossible."); return; }
                // Une confirmation n'est demandée QUE si des valeurs existantes sont en jeu.
                if (sim.ecrasables && sim.ecrasables > 0) { setSimulation(sim); setConfirmEcrasement(true); return; }
                appliquer("vides");
              }}
            >
              Appliquer la gradation
            </button>
          </div>
        </div>

        {simulation && simulation.possible && !confirmEcrasement && (
          <div style={{ marginTop: 8, fontSize: 12.5 }}>
            <span style={{ color: FT_TEXT_SECONDARY }}>Résultat depuis {simulation.reference?.taille_nom} : </span>
            {simulation.cellules.map((c) => (
              <span key={c.ft_taille_id} style={{ marginRight: 10 }}>
                <strong>{c.taille_nom}</strong> {c.valeur}
              </span>
            ))}
          </div>
        )}

        {simulation && simulation.intervalles_manquants.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 12, color: "#C2410C" }}>
            Calcul arrêté : gradation manquante entre {simulation.intervalles_manquants.join(", ")}.
            Renseignez cet intervalle pour aller plus loin.
          </div>
        )}

        {confirmEcrasement && simulation && (
          <div style={{ marginTop: 10, padding: 10, border: "1px solid #C2410C", borderRadius: 8, background: "#FEF3EC" }}>
            <div style={{ fontSize: 12.5, marginBottom: 8 }}>
              <strong>{simulation.ecrasables}</strong> cellule{(simulation.ecrasables || 0) > 1 ? "s" : ""} de cette ligne
              contien{(simulation.ecrasables || 0) > 1 ? "nent" : "t"} déjà une valeur saisie.
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {/* Le choix le plus sûr est le premier ET le bouton principal. */}
              <button className="btn tiny" onClick={() => appliquer("vides")}>Remplir uniquement les cellules vides</button>
              <button className="btn ghost tiny" onClick={() => appliquer("tout")}>Recalculer toute la ligne</button>
              <button className="btn ghost tiny" onClick={() => { setConfirmEcrasement(false); setSimulation(null); }}>Annuler</button>
            </div>
          </div>
        )}
      </td>
    </tr>
  );
}
