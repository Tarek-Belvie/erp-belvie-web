import { useCallback, useEffect, useMemo, useState } from "react";
import { mediaUrl } from "../commandes/uiHelpers";
import {
  Resultat, LigneBesoin, dateFr, nombre, ABREGE_ANOMALIES, ABREGE_REGLES, LIBELLES_REGLES,
  OU_CORRIGER, LIBELLES_STATUT_COMMANDE, LIBELLES_HORS_APPRO,
} from "./approvisionnementTypes";

// Besoins et consommations d'UNE production — page de détail.
//
// Écran en LECTURE SEULE. Aucun bouton n'enregistre quoi que ce soit, et la simulation ne fait pas
// exception : modifier une quantité de fabrication ici ne touche jamais la commande. C'est le
// processus principal qui le garantit (besoins.js n'exécute aucune écriture), mais l'interface le
// dit aussi explicitement, parce qu'un utilisateur qui doute n'ose pas s'en servir.
//
// Ce que l'écran doit faire apparaître, et qui compte autant que les chiffres : les fiches
// techniques incomplètes. Une consommation absente ou un coloris non défini ne sont pas des
// détails — ce sont des matières qu'on oubliera d'acheter. Ils sont donc nommés en tête, marqués
// sur la ligne, et jamais remplacés par une valeur devinée.

// Le pont est lu à chaque appel, jamais capturé au chargement du module : voir BesoinsListe.tsx.
function pont(): any { return (window as any).api; }

interface Props {
  commandeId: number;
  onRetour: () => void;
}

export default function BesoinsDetail({ commandeId, onRetour }: Props) {
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [chargement, setChargement] = useState(true);

  const [simulationOuverte, setSimulationOuverte] = useState(false);
  const [quantitesSimulees, setQuantitesSimulees] = useState<Record<string, string>>({});
  const [simulationActive, setSimulationActive] = useState(false);

  const calculer = useCallback(async (
    id: number,
    lignesSimulees?: { couleur_id: number; taille_id: number | null; quantite: number }[],
  ) => {
    setErreur(null);
    setChargement(true);
    try {
      const api = pont();
      if (!api?.approvisionnement || typeof api.approvisionnement.calculerBesoins !== "function") {
        throw new Error(
          "Le calcul des besoins n'est pas branché : electron/preload.js n'expose pas encore " +
          "« approvisionnement ». Copiez le fichier fourni, puis arrêtez complètement npm run dev " +
          "(Ctrl+C) et relancez-le — une modification de preload.js n'est jamais rechargée à chaud.",
        );
      }
      const r = await api.approvisionnement.calculerBesoins(
        id,
        lignesSimulees ? { lignes_simulees: lignesSimulees } : undefined,
      );
      setResultat(r);
    } catch (err: any) {
      setResultat(null);
      setErreur(err?.message || "Le calcul des besoins a échoué.");
    } finally {
      setChargement(false);
    }
  }, []);

  useEffect(() => {
    setSimulationActive(false);
    setSimulationOuverte(false);
    setQuantitesSimulees({});
    calculer(commandeId);
  }, [commandeId, calculer]);

  const cleLigne = (couleurId: number, tailleId: number | null) => `${couleurId}|${tailleId}`;

  function ouvrirSimulation() {
    if (!resultat) return;
    const depart: Record<string, string> = {};
    resultat.production_reelle.forEach((l) => {
      depart[cleLigne(l.couleur_id, l.taille_id)] = String(l.quantite);
    });
    setQuantitesSimulees(depart);
    setSimulationOuverte(true);
  }

  function appliquerSimulation() {
    if (!resultat) return;
    const lignes = resultat.production_reelle.map((l) => ({
      couleur_id: l.couleur_id,
      taille_id: l.taille_id,
      quantite: Math.max(0, Math.round(Number(quantitesSimulees[cleLigne(l.couleur_id, l.taille_id)]) || 0)),
    }));
    setSimulationActive(true);
    calculer(commandeId, lignes);
  }

  function revenirAuReel() {
    setSimulationActive(false);
    setSimulationOuverte(false);
    setQuantitesSimulees({});
    calculer(commandeId);
  }

  const totalSimule = useMemo(
    () => Object.values(quantitesSimulees).reduce((s, v) => s + (Math.max(0, Number(v)) || 0), 0),
    [quantitesSimulees],
  );

  // Répartition couleur × taille, telle qu'elle est demandée dans la commande.
  const repartition = useMemo(() => {
    if (!resultat) {
      return { tailles: [] as string[], parCouleur: [] as { couleur: string; cases: Record<string, number>; total: number }[] };
    }
    const tailles: string[] = [];
    const index = new Map<string, { couleur: string; cases: Record<string, number>; total: number }>();
    resultat.production_reelle.forEach((l) => {
      const t = l.taille_nom || "—";
      if (tailles.indexOf(t) === -1) tailles.push(t);
      const couleur = l.couleur_nom || "—";
      let ligne = index.get(couleur);
      if (!ligne) { ligne = { couleur, cases: {}, total: 0 }; index.set(couleur, ligne); }
      ligne.cases[t] = (ligne.cases[t] || 0) + l.quantite;
      ligne.total += l.quantite;
    });
    return { tailles, parCouleur: Array.from(index.values()) };
  }, [resultat]);

  // Anomalies regroupées par code, AVEC les lignes concernées. Énumérer « Unité non renseignée »
  // sans dire sur quels composants obligeait à parcourir tout le tableau pour les retrouver.
  // L'information existait déjà dans le calcul : il ne manquait que de l'afficher.
  const anomaliesDetaillees = useMemo(() => {
    if (!resultat) return [] as { code: string; libelle: string; lignes: string[] }[];
    const index = new Map<string, string[]>();
    resultat.lignes.forEach((l) => {
      l.anomalies.forEach((code) => {
        const existant = index.get(code) || [];
        // Le composant suffit souvent, mais deux coloris du même composant peuvent n'avoir le
        // défaut que sur l'un des deux : le coloris est donc précisé dès qu'il distingue.
        const etiquette = l.cible_libelle && l.cible_libelle !== "Toutes couleurs"
          ? `${l.composant_nom} (${l.cible_libelle})`
          : l.composant_nom;
        if (existant.indexOf(etiquette) === -1) existant.push(etiquette);
        index.set(code, existant);
      });
    });
    return Array.from(index.entries()).map(([code, lignes]) => ({
      code,
      libelle: resultat.libelles_anomalies[code] || code,
      lignes,
    }));
  }, [resultat]);

  /**
   * La colonne « Nécessaire ». Un chiffre qui ne couvre pas toute la production n'est pas un
   * total : il est juste pour ce qu'il couvre, et trompeur pour le reste. On l'affiche quand même
   * — le masquer ferait perdre une information utile — mais jamais sans dire qu'il est partiel.
   * Et quand RIEN n'a pu être calculé, on n'écrit pas « 0 », qui se lirait « rien à acheter ».
   */
  function renduNecessaire(l: LigneBesoin) {
    const detail = [
      l.couleurs_non_couvertes.length ? l.couleurs_non_couvertes.join(", ") : null,
      l.tailles_non_couvertes.length ? "taille " + l.tailles_non_couvertes.join(", ") : null,
    ].filter(Boolean).join(" · ");

    if (l.calcul_impossible) {
      return (
        <>
          <strong>—</strong>
          <span className="appro-puce incomplet" title="Aucune consommation utilisable : rien n'a pu être calculé">
            calcul impossible
          </span>
          <span className="appro-incomplet-note">
            {nombre(l.quantite_production_non_couverte)} pièces sans consommation
            {detail ? ` (${detail})` : ""}
          </span>
        </>
      );
    }
    if (l.calcul_incomplet) {
      return (
        <>
          <strong>{nombre(l.quantite_necessaire, l.unite)}</strong>
          <span className="appro-puce incomplet" title="Ce chiffre ne couvre pas toute la production">
            calcul incomplet
          </span>
          <span className="appro-incomplet-note">
            ne couvre pas {nombre(l.quantite_production_non_couverte)} pièces
            {detail ? ` (${detail})` : ""}
          </span>
        </>
      );
    }
    return <strong>{nombre(l.quantite_necessaire, l.unite)}</strong>;
  }

  const boutonRetour = (
    <button className="btn ghost tiny" onClick={onRetour}>← Retour à la liste</button>
  );

  if (chargement && !resultat) {
    return (
      <div>
        {boutonRetour}
        <div className="empty-state">Calcul des besoins…</div>
      </div>
    );
  }

  if (erreur) {
    return (
      <div>
        {boutonRetour}
        <p style={{
          background: "var(--v2-danger-bg, #FBEAE6)", color: "var(--v2-danger, #9A3412)",
          padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 14,
        }}>
          {erreur}
        </p>
      </div>
    );
  }

  if (!resultat) return <div>{boutonRetour}</div>;

  const photo = mediaUrl(resultat.article.photo_path);
  const rec = resultat.recette;
  // Les deux colonnes des bons en préparation n'apparaissent que s'il y a réellement un brouillon
  // en cours. Tant qu'il n'y en a pas, l'écran reste exactement celui que vous connaissez : une
  // colonne qui affiche « — » partout n'apprend rien et encombre.
  const afficherPreparation = resultat.totaux.lignes_en_preparation > 0;

  return (
    <div>
      <div style={{ marginBottom: 14 }}>{boutonRetour}</div>

      {/* D'où vient la recette technique de ce calcul. Une production décidée garde la sienne :
          l'écart avec la fiche est signalé, jamais résorbé tout seul. */}
      <div className={`appro-bandeau-recette ${rec.revision_en_retard ? "retard" : ""}`} style={{ marginBottom: 12 }}>
        {rec.source === "figee" && (
          <span>
            Recette technique <strong>figée le {dateFr(rec.figee_le)}</strong>, depuis la
            révision <strong>{rec.fiche_revision_figee}</strong> de la fiche technique.
            {rec.revision_en_retard
              ? ` La fiche est aujourd'hui en révision ${rec.fiche_revision_actuelle} : cette production n'en tient pas compte.`
              : " Elle correspond à la révision en vigueur."}
          </span>
        )}
        {rec.source === "fiche" && (
          <span>
            Recette technique lue <strong>en direct dans la fiche technique</strong>
            {rec.fiche_revision_actuelle != null ? ` (révision ${rec.fiche_revision_actuelle})` : ""} :
            cette production n'a pas encore de recette figée et suit donc les évolutions de la fiche.
          </span>
        )}
        {rec.source === "figee_illisible" && (
          <span>
            <strong>La recette figée de cette production n'a pas pu être lue</strong> —{" "}
            {rec.illisible_raison} Le calcul ci-dessous repose donc sur la fiche technique actuelle,
            et non sur la recette d'origine.
          </span>
        )}
      </div>

      {/* --- Identité de l'article et de la commande ----------------------------------------- */}
      <div className="detail-block">
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          {photo && (
            <img
              src={photo}
              alt=""
              style={{ width: 92, height: 92, objectFit: "cover", borderRadius: 7, border: "1px solid #E0E2DA" }}
            />
          )}
          <div style={{ flex: 1, minWidth: 220 }}>
            <h4 style={{ margin: 0 }}>{resultat.article.designation || resultat.article.produit}</h4>
            <p style={{ fontSize: 12.5, color: "var(--v2-text-3)", margin: "3px 0 0" }}>
              {resultat.article.reference || "référence à compléter"}
              {resultat.article.saison ? ` — ${resultat.article.saison}` : ""}
            </p>
            <p style={{ fontSize: 12.5, margin: "7px 0 0" }}>
              Commande <strong>{resultat.commande.numero || "sans numéro"}</strong>
              {" — "}{LIBELLES_STATUT_COMMANDE[resultat.commande.statut] || resultat.commande.statut}
              {" — "}{resultat.commande.quantite_totale} pièces, à livrer le{" "}
              {dateFr(resultat.commande.date_fin_prevue)}
            </p>
            {!resultat.fiche && (
              <p style={{ fontSize: 12.5, color: "var(--v2-danger, #9A3412)", margin: "8px 0 0" }}>
                Cet article n'a pas encore de fiche technique : aucun besoin ne peut être calculé.
              </p>
            )}
          </div>

          {repartition.parCouleur.length > 0 && (
            <div style={{ flex: "1 1 320px", minWidth: 280 }}>
              <div style={{
                fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em",
                color: "#9A9A90", marginBottom: 5,
              }}>
                Répartition de la production
              </div>
              <div className="grid-table-wrap">
                <table className="appro-grille">
                  <thead>
                    <tr>
                      <th className="g">Couleur</th>
                      {repartition.tailles.map((t) => <th key={t}>{t}</th>)}
                      <th className="n">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {repartition.parCouleur.map((l) => (
                      <tr key={l.couleur}>
                        <td className="g">{l.couleur}</td>
                        {repartition.tailles.map((t) => <td key={t}>{l.cases[t] || "—"}</td>)}
                        <td className="n"><strong>{l.total}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* --- Simulation ----------------------------------------------------------------------- */}
      <div className="detail-block">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h4 style={{ margin: 0 }}>Simulation</h4>
            <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "3px 0 0" }}>
              Faites varier les quantités pour voir l'effet sur les besoins.
              La commande de fabrication n'est jamais modifiée.
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            {!simulationOuverte && (
              <button className="btn ghost tiny" onClick={ouvrirSimulation} disabled={resultat.production_reelle.length === 0}>
                Simuler d'autres quantités
              </button>
            )}
            {(simulationOuverte || simulationActive) && (
              <button className="btn ghost tiny" onClick={revenirAuReel}>Revenir aux quantités réelles</button>
            )}
          </div>
        </div>

        {simulationActive && (
          <p className="appro-bloc-alerte" style={{ marginTop: 10 }}>
            <strong>Vous consultez une simulation.</strong> Les chiffres ci-dessous reposent sur des
            quantités modifiées, et les engagements déjà pris ne sont pas déduits — une simulation
            ne se compare qu'à elle-même.
          </p>
        )}

        {simulationOuverte && (
          <div style={{ marginTop: 11 }}>
            <div className="appro-sim-grille">
              {resultat.production_reelle.map((l) => {
                const cle = cleLigne(l.couleur_id, l.taille_id);
                return (
                  <div className="appro-sim-case" key={cle}>
                    <label>
                      {l.couleur_nom || "—"} · {l.taille_nom || "—"}{" "}
                      <span style={{ color: "#B0B0A6" }}>(réel : {l.quantite})</span>
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={quantitesSimulees[cle] ?? ""}
                      onChange={(e) => setQuantitesSimulees((p) => ({ ...p, [cle]: e.target.value }))}
                    />
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 11 }}>
              <button className="btn primary" onClick={appliquerSimulation}>Calculer avec ces quantités</button>
              <span style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>
                Total simulé : <strong>{totalSimule}</strong> pièces (réel : {resultat.commande.quantite_totale})
              </span>
            </div>
          </div>
        )}
      </div>

      {/* --- Anomalies ------------------------------------------------------------------------ */}
      {(resultat.totaux.lignes_en_anomalie > 0 || resultat.anomalies.length > 0) && (
        <div className="detail-block">
          <div className="appro-bloc-alerte">
            <strong>
              {resultat.totaux.lignes_en_anomalie > 0
                ? `${resultat.totaux.lignes_en_anomalie} ligne${resultat.totaux.lignes_en_anomalie > 1 ? "s" : ""} à compléter dans la fiche technique.`
                : "Calcul impossible en l'état."}
            </strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {resultat.anomalies.map((a) => <li key={a}>{resultat.libelles_anomalies[a] || a}</li>)}
              {anomaliesDetaillees.map((a) => (
                <li key={a.code} style={{ marginTop: 3 }}>
                  {a.libelle} — <strong>{a.lignes.join(", ")}</strong>
                  {OU_CORRIGER[a.code] && (
                    <span style={{ display: "block", fontSize: 11.5, color: "#9A7B46" }}>
                      À corriger dans le {OU_CORRIGER[a.code]}.
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <p style={{ margin: "6px 0 0" }}>
              Les quantités concernées restent affichées : rien n'est deviné, rien n'est masqué.
            </p>
          </div>
        </div>
      )}

      {/* --- Besoins -------------------------------------------------------------------------- */}
      <div className="detail-block">
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
          gap: 12, flexWrap: "wrap", marginBottom: 10,
        }}>
          <h4 style={{ margin: 0 }}>Besoins par composant et par coloris</h4>
          <span style={{ fontSize: 12, color: "var(--v2-text-3)" }}>
            {resultat.totaux.composants} composants — {resultat.totaux.lignes} lignes —{" "}
            {resultat.totaux.a_commander} à commander
          </span>
        </div>

        {resultat.calcul_incomplet && (
          <div className="appro-bloc-alerte" style={{ marginBottom: 10 }}>
            <strong>
              Calcul incomplet — {resultat.totaux.lignes_incompletes} ligne
              {resultat.totaux.lignes_incompletes > 1 ? "s" : ""} ne couvre
              {resultat.totaux.lignes_incompletes > 1 ? "nt" : ""} pas toute la production.
            </strong>
            <p style={{ margin: "5px 0 0" }}>
              Les quantités ci-dessous restent affichées : elles sont justes pour ce qu'elles
              couvrent. <strong>Elles ne doivent pas être lues comme des totaux définitifs</strong>,
              et une consommation manquante n'est jamais remplacée par zéro. Chaque ligne concernée
              indique combien de pièces ne sont pas couvertes, et pour quelles couleurs ou tailles.
            </p>
          </div>
        )}

        {resultat.lignes.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>
            Aucun besoin calculable : la fiche technique ne contient ni matière ni fourniture.
          </p>
        ) : (
          <div className="grid-table-wrap">
            <table className="appro-grille">
              <thead>
                <tr>
                  <th className="g">Composant</th>
                  <th className="g">Coloris</th>
                  <th className="g">Référence</th>
                  <th className="n">Qté prod.</th>
                  <th className="n">Besoin brut</th>
                  <th className="n">Pertes</th>
                  <th className="n">Nécessaire</th>
                  <th className="n">Commandé</th>
                  <th className="n">Reçu</th>
                  <th className="n">Reste à recevoir</th>
                  <th className="n">Reste à commander</th>
                  {afficherPreparation && <th className="n">En préparation</th>}
                  {afficherPreparation && <th className="n">Reste à préparer</th>}
                </tr>
              </thead>
              <tbody>
                {resultat.lignes.map((l) => (
                  <tr
                    key={l.composant_cle + l.cible_cle + (l.unite || "")}
                    className={l.calcul_incomplet ? "incomplet" : l.anomalies.length ? "anomalie" : ""}
                  >
                    <td className="g">
                      {l.composant_nom}
                      <span className="sous">
                        {l.type === "matiere" ? "Matière" : "Fourniture"}
                        {l.regles.map((r) => (
                          <span className="appro-puce" key={r} title={LIBELLES_REGLES[r] || r}>{ABREGE_REGLES[r] || r}</span>
                        ))}
                      </span>
                    </td>
                    <td className="g">
                      {l.cible_libelle}
                      {l.couleurs_produit.length > 0 && (
                        <span className="sous">pour {l.couleurs_produit.join(", ")}</span>
                      )}
                    </td>
                    <td className="g">
                      {l.reference || "—"}
                      {l.anomalies.map((a) => (
                        <span className="appro-puce alerte" key={a} title={resultat.libelles_anomalies[a] || a}>
                          {ABREGE_ANOMALIES[a] || resultat.libelles_anomalies[a] || a}
                        </span>
                      ))}
                    </td>
                    <td className="n">{nombre(l.quantite_production)}</td>
                    <td className="n">{nombre(l.besoin_brut, l.unite)}</td>
                    <td className="n">{l.perte_pourcent ? `${nombre(l.perte_pourcent)} %` : "—"}</td>
                    <td className="n">{renduNecessaire(l)}</td>
                    <td className="n">{l.quantite_commandee ? nombre(l.quantite_commandee, l.unite) : "—"}</td>
                    <td className="n">
                      {l.quantite_commandee ? nombre(l.quantite_recue, l.unite) : "—"}
                      {l.recu_excedentaire > 0 && (
                        <span className="appro-puce alerte" title="Livraison supérieure à la quantité commandée et affectée">
                          +{nombre(l.recu_excedentaire)}
                        </span>
                      )}
                    </td>
                    <td className="n">{l.quantite_commandee ? nombre(l.reste_a_recevoir, l.unite) : "—"}</td>
                    <td className="n appro-reste-fort">{nombre(l.reste_a_commander, l.unite)}</td>
                    {afficherPreparation && (
                      <td className="n">
                        {l.quantite_en_preparation ? nombre(l.quantite_en_preparation, l.unite) : "—"}
                      </td>
                    )}
                    {afficherPreparation && (
                      <td className="n appro-reste-fort">{nombre(l.reste_a_preparer, l.unite)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "10px 0 0", lineHeight: 1.6 }}>
          <strong>Reste à commander</strong> = nécessaire − commandé.{" "}
          <strong>Reste à recevoir</strong> = commandé − reçu. C'est la quantité{" "}
          <strong>commandée</strong> qui réduit le reste à commander, jamais la quantité{" "}
          <strong>reçue</strong> : une matière reçue a déjà été commandée, la décompter une seconde
          fois la soustrairait deux fois.<br />
          Il n'existe pas encore de module Stock : une quantité reçue n'est donc{" "}
          <strong>jamais considérée comme encore disponible</strong>. Elle a été achetée pour cette
          production, et on suppose qu'elle y passe — supposer l'inverse ferait sous-commander sur
          la foi d'un stock imaginaire.
          {afficherPreparation && (
            <>
              <br />
              <strong>En préparation</strong> = quantités déjà posées sur un bon de commande
              encore en brouillon. Elles ne sont pas des engagements : elles ne réduisent donc pas
              le reste à commander, mais le <strong>reste à préparer</strong> — c'est lui qui
              évite de poser deux fois la même quantité sur deux bons.
            </>
          )}
        </p>
      </div>

      {/* --- Composants hors approvisionnement ------------------------------------------------ */}
      {resultat.hors_approvisionnement.length > 0 && (
        <div className="detail-block">
          <h4 style={{ margin: "0 0 4px" }}>Composants hors approvisionnement</h4>
          <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "0 0 10px" }}>
            Déclarés dans la nomenclature, mais ne faisant l'objet d'aucun achat. Ils sont exclus du
            calcul des besoins — et affichés ici plutôt que masqués : une ligne cachée est une ligne
            oubliée.
          </p>
          <div className="grid-table-wrap">
            <table className="appro-grille">
              <thead>
                <tr>
                  <th className="g">Composant</th>
                  <th className="g">Type</th>
                  <th className="g">Motif</th>
                  <th className="g">Précision</th>
                </tr>
              </thead>
              <tbody>
                {resultat.hors_approvisionnement.map((c) => (
                  <tr key={c.cle}>
                    <td className="g">{c.nom}</td>
                    <td className="g">{c.type === "matiere" ? "Matière" : "Fourniture"}</td>
                    <td className="g">{LIBELLES_HORS_APPRO[c.motif || ""] || c.motif || "—"}</td>
                    <td className="g" style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>{c.precision || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- Engagements non rattachés -------------------------------------------------------- */}
      {resultat.engagements_non_rattaches.length > 0 && (
        <div className="detail-block">
          <h4 style={{ margin: "0 0 4px" }}>Achats affectés à cette production, non rattachés à une ligne</h4>
          <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "0 0 10px" }}>
            Ils ne sont déduits d'aucun besoin. Les ignorer en silence ferait racheter une matière
            déjà commandée.
          </p>
          <div className="grid-table-wrap">
            <table className="appro-grille">
              <thead>
                <tr>
                  <th className="g">Désignation</th>
                  <th className="g">Catégorie</th>
                  <th className="g">Couleur</th>
                  <th className="n">Affecté</th>
                  <th className="n">dont reçu</th>
                  <th className="g">Pourquoi</th>
                </tr>
              </thead>
              <tbody>
                {resultat.engagements_non_rattaches.map((e) => (
                  <tr key={e.achat_id}>
                    <td className="g">{e.designation}</td>
                    <td className="g">{e.categorie}</td>
                    <td className="g">{e.couleur || "—"}</td>
                    <td className="n">{nombre(e.quantite_affectee, e.unite)}</td>
                    <td className="n">{nombre(e.quantite_recue, e.unite)}</td>
                    <td className="g" style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>{e.raison}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
