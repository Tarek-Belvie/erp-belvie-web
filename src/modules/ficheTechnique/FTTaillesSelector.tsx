import { useEffect, useRef, useState } from "react";
import { AnalyseChangementGrille, TaillesDisponibles } from "../../shared/types";
import { FieldLabel, ftInputStyle, FT_BORDER_COLOR, FT_TEXT_SECONDARY } from "./FTChamps";

/**
 * Grille de tailles + pastilles de sélection.
 *
 * PRINCIPE : la fiche technique NE DÉCIDE PAS du format des tailles. Elle affiche les valeurs de
 * la grille applicable, dans l'ordre de `grilles_tailles_valeurs.ordre`. Lettres (S, M, 2XL),
 * chiffres (29, 38, 44) ou toute autre valeur sont rendus par le MÊME code : aucune liste n'est
 * écrite en dur ici, et aucun tri n'est refait côté interface — un tri alphabétique donnerait
 * L, M, S, XL et un tri numérique sur du texte donnerait 36, 4XL, 38.
 */

interface Props {
  ficheId: number;
  lectureSeule: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}

export default function FTTaillesSelector({ ficheId, lectureSeule, onChanged, onError }: Props) {
  const [data, setData] = useState<TaillesDisponibles | null>(null);
  const [nouvelleTaille, setNouvelleTaille] = useState<string | null>(null);
  const [confirmGrille, setConfirmGrille] = useState<{ grilleId: number | null; analyse: AnalyseChangementGrille } | null>(null);
  const [confirmRetrait, setConfirmRetrait] = useState<{ ftTailleId: number; nom: string } | null>(null);
  // Vrai quand l'etat vient d'etre applique depuis la reponse du backend : evite un rechargement
  // redondant, tout en gardant le filet si la reponse n'avait pas la forme attendue.
  const dataAJour = useRef(false);

  async function recharger() {
    try {
      setData(await window.api.ficheTechnique.taillesDisponibles(ficheId));
    } catch (err: any) {
      onError(err?.message || "Chargement des tailles impossible.");
    }
  }
  useEffect(() => { recharger(); }, [ficheId]);

  async function choisirGrille(valeur: string) {
    const grilleId = valeur ? Number(valeur) : null;
    try {
      // On calcule d'abord l'effet du changement, SANS rien modifier. Une confirmation n'est
      // demandée que si des tailles sortiraient de la grille — sinon le changement est indolore.
      const analyse: AnalyseChangementGrille = await window.api.ficheTechnique.analyserChangementGrille(ficheId, grilleId);
      if (analyse.retirees.length > 0) { setConfirmGrille({ grilleId, analyse }); return; }
      await window.api.ficheTechnique.definirGrille(ficheId, grilleId, {});
      await recharger();
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Changement de grille impossible.");
    }
  }

  // Deux issues possibles après confirmation, et la suppression n'est JAMAIS le défaut.
  async function appliquerChangementGrille(supprimer: boolean) {
    if (!confirmGrille) return;
    try {
      await window.api.ficheTechnique.definirGrille(ficheId, confirmGrille.grilleId, { supprimerHorsGrille: supprimer });
      setConfirmGrille(null);
      await recharger();
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Changement de grille impossible.");
    }
  }

  async function basculer(p: TaillesDisponibles["pastilles"][number]) {
    if (lectureSeule) return;
    try {
      if (!p.selectionnee) {
        // Plus AUCUN retour silencieux : un clic sans effet et sans message est indiagnosticable.
        if (p.grille_valeur_id == null) {
          onError(`« ${p.valeur} » n'a pas d'identifiant de grille : elle ne peut pas être sélectionnée. Rechargez la fiche.`);
          return;
        }
        // La reponse EST l'etat des pastilles : on l'applique directement. Plus de second
        // aller-retour (taillesDisponibles) dont l'echec ou le retard laissait la pastille
        // eteinte alors que la ligne etait bien enregistree.
        const r = await window.api.ficheTechnique.selectionnerTaille(ficheId, p.grille_valeur_id);
        if (r && r.pastilles) { setData(r); dataAJour.current = true; }
      } else {
        if (p.ft_taille_id == null) {
          onError(`« ${p.valeur} » n'a pas d'identifiant de ligne : elle ne peut pas être retirée. Rechargez la fiche.`);
          return;
        }
        // Désélectionner supprime la colonne : on ne le fait en silence que si aucune valeur de
        // mesure n'y est attachée.
        const aDesValeurs = await window.api.ficheTechnique.tailleAValeurs(p.ft_taille_id);
        if (aDesValeurs) { setConfirmRetrait({ ftTailleId: p.ft_taille_id, nom: p.valeur }); return; }
        const r = await window.api.ficheTechnique.removeTaille(ficheId, p.ft_taille_id);
        if (r && r.pastilles) { setData(r); dataAJour.current = true; }
      }
      // Filet : si la reponse n'avait pas la forme attendue, on recharge quand meme.
      if (!dataAJour.current) await recharger();
      dataAJour.current = false;
      onChanged();
    } catch (err: any) {
      // Toute erreur est desormais AFFICHEE et journalisee : plus aucun echec muet.
      console.error("[tailles] ERREUR basculer :", err);
      onError(err?.message || "Modification impossible.");
    }
  }

  async function confirmerRetrait() {
    if (!confirmRetrait) return;
    try {
      const r = await window.api.ficheTechnique.removeTaille(ficheId, confirmRetrait.ftTailleId);
      setConfirmRetrait(null);
      if (r && r.pastilles) setData(r); else await recharger();
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Suppression impossible.");
    }
  }

  async function creerTailleExceptionnelle() {
    const nom = (nouvelleTaille || "").trim();
    if (!nom) return;
    try {
      const r = await window.api.ficheTechnique.ajouterTailleExceptionnelle(ficheId, nom);
      setNouvelleTaille(null);
      if (r && r.pastilles) setData(r); else await recharger();
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Ajout impossible.");
    }
  }

  if (!data) return <p style={{ fontSize: 13, color: FT_TEXT_SECONDARY }}>Chargement des tailles…</p>;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 10 }}>
        <div>
          <FieldLabel>Grille de tailles</FieldLabel>
          <select
            value={data.grille ? String(data.grille.id) : ""}
            disabled={lectureSeule}
            onChange={(e) => choisirGrille(e.target.value)}
            style={{ ...ftInputStyle, width: 200, background: "#fff" }}
          >
            <option value="">— choisir une grille —</option>
            {data.grilles.map((g) => (
              <option key={g.id} value={g.id}>{g.nom}{g.nb_valeurs != null ? ` (${g.nb_valeurs})` : ""}</option>
            ))}
          </select>
        </div>

        {/* L'origine est dite explicitement : l'utilisateur doit savoir si la grille a été choisie
            ou seulement suggérée, et une suggestion n'est jamais appliquée en base tant qu'il ne
            l'a pas retenue. */}
        <div style={{ fontSize: 12, color: FT_TEXT_SECONDARY, paddingBottom: 5 }}>
          {data.origine === "suggestion" && "Grille suggérée d'après les autres fiches de ce produit — modifiable."}
          {data.origine === "produit" && "Grille associée à ce produit."}
          {data.origine === "ambigu" && (
            <span style={{ color: "#C2410C" }}>
              Plusieurs grilles sont utilisées pour ce produit ({data.suggestions.map((g) => g.nom).join(", ")}) — choisissez celle de cette fiche.
            </span>
          )}
          {data.origine === "aucune" && data.pastilles.length > 0 && "Tailles de cette fiche, sans grille associée."}
        </div>
      </div>

      <FieldLabel>Tailles de cette fiche</FieldLabel>
      {data.pastilles.length === 0 ? (
        <p style={{ fontSize: 12.5, color: FT_TEXT_SECONDARY, margin: "4px 0 8px" }}>
          Choisissez une grille ci-dessus pour voir les tailles disponibles, ou ajoutez une taille exceptionnelle.
        </p>
      ) : (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
          {data.pastilles.map((p) => (
            <button
              key={`${p.grille_valeur_id ?? "x"}-${p.valeur}`}
              onClick={() => basculer(p)}
              disabled={lectureSeule}
              title={p.hors_grille ? "Taille hors de la grille actuelle" : undefined}
              style={{
                minWidth: 44, padding: "5px 10px", fontSize: 13, cursor: lectureSeule ? "default" : "pointer",
                borderRadius: 6, fontWeight: p.selectionnee ? 700 : 500,
                border: `1px solid ${p.selectionnee ? "#17181A" : FT_BORDER_COLOR}`,
                background: p.selectionnee ? "#17181A" : "#fff",
                color: p.selectionnee ? "#fff" : "#55564E",
                borderStyle: p.hors_grille ? "dashed" : "solid",
              }}
            >
              {p.valeur}
            </button>
          ))}
        </div>
      )}

      {!lectureSeule && (
        nouvelleTaille === null ? (
          <button className="btn ghost tiny" onClick={() => setNouvelleTaille("")}>+ Autre taille</button>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text" value={nouvelleTaille} autoFocus
              placeholder="Taille unique, Sur-mesure…"
              onChange={(e) => setNouvelleTaille(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") creerTailleExceptionnelle();
                if (e.key === "Escape") setNouvelleTaille(null);
              }}
              style={{ ...ftInputStyle, width: 180 }}
            />
            <button className="btn tiny" onClick={creerTailleExceptionnelle}>Ajouter</button>
            <button className="btn ghost tiny" onClick={() => setNouvelleTaille(null)}>Annuler</button>
          </div>
        )
      )}

      {confirmRetrait && (
        <div className="modal-veil">
          <div className="modal small">
            <div className="modal-head"><h3>Retirer la taille « {confirmRetrait.nom} » ?</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              Des mesures ont déjà été saisies pour cette taille. Elles seront définitivement
              supprimées avec la colonne.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmRetrait(null)}>Annuler</button>
              <button className="btn primary" onClick={confirmerRetrait}>Retirer et supprimer les valeurs</button>
            </div>
          </div>
        </div>
      )}

      {confirmGrille && (
        <div className="modal-veil">
          <div className="modal small">
            <div className="modal-head"><h3>Changer de grille de tailles ?</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              {confirmGrille.analyse.conservees.length > 0 && (
                <>Conservées : <strong>{confirmGrille.analyse.conservees.map((t) => t.nom).join(", ")}</strong>.<br /></>
              )}
              Hors de la nouvelle grille : <strong>{confirmGrille.analyse.retirees.map((t) => t.nom).join(", ")}</strong>
              {confirmGrille.analyse.valeurs_perdues > 0
                ? ` (${confirmGrille.analyse.valeurs_perdues} valeur${confirmGrille.analyse.valeurs_perdues > 1 ? "s" : ""} de mesure).`
                : "."}
            </p>
            <p style={{ fontSize: 12.5, color: FT_TEXT_SECONDARY }}>
              Par défaut ces tailles sont <strong>conservées</strong> et restent des colonnes du
              tableau, simplement marquées hors grille. Vous pouvez aussi les retirer.
            </p>
            <div className="modal-actions" style={{ flexWrap: "wrap", gap: 6 }}>
              <button className="btn ghost" onClick={() => setConfirmGrille(null)}>Annuler</button>
              <button className="btn ghost" onClick={() => appliquerChangementGrille(true)}>Changer et retirer ces tailles</button>
              <button className="btn primary" onClick={() => appliquerChangementGrille(false)}>Changer en les conservant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
