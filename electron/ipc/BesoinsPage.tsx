import { useCallback, useEffect, useMemo, useState } from "react";

// Besoins et consommations — étape 1 du module Approvisionnement.
//
// Écran en LECTURE SEULE. Aucun bouton n'enregistre quoi que ce soit, et la simulation ne fait pas
// exception : modifier une quantité de fabrication ici ne touche jamais la commande. C'est le
// processus principal qui le garantit (besoins.js n'exécute aucune écriture), mais l'interface le
// dit aussi explicitement, parce qu'un utilisateur qui doute n'ose pas s'en servir.
//
// Ce que l'écran doit faire apparaître, et qui compte autant que les chiffres : les fiches
// techniques incomplètes. Une consommation absente ou un coloris non défini ne sont pas des
// détails — ce sont des matières qu'on oubliera d'acheter. Ils sont donc visibles sur la ligne,
// comptés en tête, et jamais remplacés par une valeur devinée.

const api: any = (window as any).api;

interface Props {
  /** Fourni par l'application pour ouvrir la fiche technique de l'article. Absent = bouton masqué. */
  onOuvrirFiche?: (articleId: number) => void;
}

type LigneBesoin = {
  composant_cle: string;
  composant_nom: string;
  type: "matiere" | "fourniture";
  catalogue_id: number | null;
  cible_cle: string;
  cible_libelle: string;
  reference: string | null;
  unite: string | null;
  regles: string[];
  couleurs_produit: string[];
  quantite_production: number;
  besoin_brut: number;
  perte_pourcent: number;
  besoin_avec_pertes: number;
  deja_commande: number;
  dont_recu: number;
  reste_a_commander: number;
  anomalies: string[];
};

type Resultat = {
  commande: { id: number; numero: string | null; statut: string; quantite_totale: number; date_lancement: string; date_fin_prevue: string };
  article: { id: number; designation: string | null; produit: string | null; reference: string | null; saison: string | null };
  fiche: { id: number; statut: string } | null;
  production_reelle: { couleur_id: number; couleur_nom: string | null; taille_id: number | null; taille_nom: string | null; quantite: number }[];
  simulation: boolean;
  lignes: LigneBesoin[];
  totaux: { lignes: number; lignes_en_anomalie: number; composants: number; quantite_production: number; a_commander: number };
  anomalies: string[];
  libelles_anomalies: Record<string, string>;
  engagements_non_rattaches: { achat_id: number; designation: string; categorie: string; couleur: string | null; unite: string | null; quantite_affectee: number; quantite_recue: number; raison: string }[];
};

type Commande = {
  id: number; numero: string | null; statut: string; quantite_totale: number;
  date_lancement: string; date_fin_prevue: string;
  article_id: number; article_designation: string | null; article_produit: string | null;
  article_reference: string | null; article_saison: string | null;
  photo_path: string | null; fiche_id: number | null;
};

const LIBELLES_REGLES: Record<string, string> = {
  couleur: "Consommation propre à la couleur",
  taille: "Consommation par taille",
  fixe: "Consommation fixe",
};
const ABREGE_REGLES: Record<string, string> = { couleur: "couleur", taille: "taille", fixe: "fixe" };

const STYLES = `
.appro-grille { width: 100%; border-collapse: collapse; }
.appro-grille th {
  background: #1F3A2E; color: #fff; font-size: 10.5px; font-weight: 700; letter-spacing: .04em;
  text-transform: uppercase; padding: 9px 10px; text-align: center; white-space: nowrap; position: sticky; top: 0;
}
.appro-grille th.g, .appro-grille td.g { text-align: left; }
.appro-grille th.n, .appro-grille td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.appro-grille td { font-size: 12.5px; padding: 8px 10px; text-align: center; border-bottom: 1px solid #E4E6DF; }
.appro-grille tbody tr:nth-child(even) { background: #FAFBF7; }
.appro-grille tbody tr.anomalie { background: #FDF6EC; }
.appro-grille tbody tr.anomalie td { border-bottom-color: #EFD9B4; }
.appro-grille .sous { font-size: 11px; color: var(--v2-text-3, #6B6B62); display: block; margin-top: 1px; }
.appro-puce {
  display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 9px;
  background: #EEF0EA; color: #4B4B43; margin-left: 5px; white-space: nowrap;
}
.appro-puce.alerte { background: #FBEAE6; color: #9A3412; }
.appro-reste-fort { font-weight: 700; }
.appro-bloc-alerte {
  background: #FDF6EC; border: 1px solid #EFD9B4; border-radius: 8px; padding: 11px 14px;
  font-size: 12.5px; color: #7C4A03; line-height: 1.55;
}
.appro-cartes { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
.appro-carte {
  border: 1px solid #E0E2DA; border-radius: 9px; padding: 11px 12px; background: #fff;
  cursor: pointer; text-align: left; display: flex; gap: 11px; align-items: flex-start;
}
.appro-carte:hover { border-color: #0E9F6E; background: #F8FBF9; }
.appro-carte.active { border-color: #0E9F6E; box-shadow: 0 0 0 1.5px #0E9F6E inset; }
.appro-carte img { width: 46px; height: 46px; object-fit: cover; border-radius: 5px; flex-shrink: 0; background: #F2F3EE; }
.appro-sim-grille { display: grid; gap: 7px; grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)); }
.appro-sim-case { border: 1px solid #E0E2DA; border-radius: 7px; padding: 7px 9px; background: #fff; }
.appro-sim-case label { font-size: 11px; color: var(--v2-text-3, #6B6B62); display: block; margin-bottom: 3px; }
.appro-sim-case input { width: 100%; height: 28px; border: 1px solid #D8D9D0; border-radius: 5px; padding: 0 7px; font-size: 13px; }
`;

function nombre(valeur: number | null | undefined, unite?: string | null) {
  if (valeur == null) return "—";
  const texte = Number(valeur).toLocaleString("fr-FR", { maximumFractionDigits: 3 });
  return unite ? `${texte} ${unite}` : texte;
}

export default function BesoinsPage({ onOuvrirFiche }: Props) {
  const [commandes, setCommandes] = useState<Commande[]>([]);
  const [commandeId, setCommandeId] = useState<number | null>(null);
  const [resultat, setResultat] = useState<Resultat | null>(null);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);

  const [simulationOuverte, setSimulationOuverte] = useState(false);
  const [quantitesSimulees, setQuantitesSimulees] = useState<Record<string, string>>({});
  const [simulationActive, setSimulationActive] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const liste = await api.approvisionnement.listerCommandes();
        setCommandes(liste);
        if (liste.length > 0) setCommandeId(liste[0].id);
      } catch (err: any) {
        setErreur(err?.message || "Impossible de lire les commandes de fabrication.");
      } finally {
        setChargement(false);
      }
    })();
  }, []);

  const calculer = useCallback(async (id: number, lignesSimulees?: { couleur_id: number; taille_id: number | null; quantite: number }[]) => {
    setErreur(null);
    try {
      const r = await api.approvisionnement.calculerBesoins(id, lignesSimulees ? { lignes_simulees: lignesSimulees } : undefined);
      setResultat(r);
    } catch (err: any) {
      setResultat(null);
      setErreur(err?.message || "Le calcul des besoins a échoué.");
    }
  }, []);

  useEffect(() => {
    if (commandeId == null) return;
    // Changer de commande remet la simulation à zéro : garder des quantités d'un autre article
    // n'aurait aucun sens et induirait en erreur.
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
    if (!resultat || commandeId == null) return;
    const lignes = resultat.production_reelle.map((l) => ({
      couleur_id: l.couleur_id,
      taille_id: l.taille_id,
      quantite: Math.max(0, Math.round(Number(quantitesSimulees[cleLigne(l.couleur_id, l.taille_id)]) || 0)),
    }));
    setSimulationActive(true);
    calculer(commandeId, lignes);
  }

  function revenirAuReel() {
    if (commandeId == null) return;
    setSimulationActive(false);
    setSimulationOuverte(false);
    setQuantitesSimulees({});
    calculer(commandeId);
  }

  const totalSimule = useMemo(
    () => Object.values(quantitesSimulees).reduce((s, v) => s + (Math.max(0, Number(v)) || 0), 0),
    [quantitesSimulees],
  );

  const commandeChoisie = commandes.find((c) => c.id === commandeId) || null;

  // Répartition couleur x taille, telle qu'elle est demandée dans la fiche article.
  const repartition = useMemo(() => {
    if (!resultat) return { tailles: [] as string[], parCouleur: [] as { couleur: string; cases: Record<string, number>; total: number }[] };
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

  if (chargement) return <div className="empty-state">Chargement des commandes…</div>;

  return (
    <div>
      <style>{STYLES}</style>

      <div className="topline">
        <div>
          <div className="page-title">Besoins et consommations</div>
          <div className="page-sub">
            Approvisionnement — calcul des matières et fournitures nécessaires à une production
          </div>
        </div>
      </div>

      {erreur && (
        <p style={{ background: "var(--v2-danger-bg, #FBEAE6)", color: "var(--v2-danger, #9A3412)", padding: "10px 14px", borderRadius: 8, fontSize: 13 }}>
          {erreur}
        </p>
      )}

      <div className="detail-block">
        <h4 style={{ margin: "0 0 10px" }}>Articles à approvisionner</h4>
        {commandes.length === 0 ? (
          <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>
            Aucune commande de fabrication validée ou en production pour l'instant.
          </p>
        ) : (
          <div className="appro-cartes">
            {commandes.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`appro-carte ${c.id === commandeId ? "active" : ""}`}
                onClick={() => setCommandeId(c.id)}
              >
                {c.photo_path
                  ? <img src={`belvie-media://local/${c.photo_path}`} alt="" />
                  : <span className="appro-carte-vide" style={{ width: 46, height: 46, borderRadius: 5, background: "#F2F3EE", flexShrink: 0 }} />}
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontWeight: 650, fontSize: 13 }}>
                    {c.article_designation || c.article_produit || "Article"}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--v2-text-3)" }}>
                    {c.article_reference || "référence à compléter"}
                  </span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--v2-text-3)", marginTop: 2 }}>
                    {c.numero || "sans numéro"} — {c.quantite_totale} pièces
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {resultat && commandeChoisie && (
        <>
          <div className="detail-block">
            <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
              {commandeChoisie.photo_path && (
                <img
                  src={`belvie-media://local/${commandeChoisie.photo_path}`}
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
                  Commande <strong>{resultat.commande.numero || "sans numéro"}</strong> —{" "}
                  {resultat.commande.quantite_totale} pièces, à livrer le{" "}
                  {resultat.commande.date_fin_prevue}
                </p>
                {onOuvrirFiche && (
                  <button className="btn ghost tiny" style={{ marginTop: 8 }} onClick={() => onOuvrirFiche(resultat.article.id)}>
                    Ouvrir la fiche technique
                  </button>
                )}
                {!resultat.fiche && (
                  <p style={{ fontSize: 12.5, color: "var(--v2-danger, #9A3412)", margin: "8px 0 0" }}>
                    Cet article n'a pas encore de fiche technique : aucun besoin ne peut être calculé.
                  </p>
                )}
              </div>

              {repartition.parCouleur.length > 0 && (
                <div style={{ flex: "1 1 320px", minWidth: 280 }}>
                  <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "#9A9A90", marginBottom: 5 }}>
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

          {/* --- Simulation ------------------------------------------------------------------ */}
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
                        <label>{l.couleur_nom || "—"} · {l.taille_nom || "—"} <span style={{ color: "#B0B0A6" }}>(réel : {l.quantite})</span></label>
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
                    Total simulé : <strong>{totalSimule}</strong> pièces
                    {" "}(réel : {resultat.commande.quantite_totale})
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* --- Anomalies ------------------------------------------------------------------- */}
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
                  {Array.from(new Set(resultat.lignes.flatMap((l) => l.anomalies))).map((a) => (
                    <li key={a}>{resultat.libelles_anomalies[a] || a}</li>
                  ))}
                </ul>
                <p style={{ margin: "6px 0 0" }}>
                  Les quantités concernées restent affichées : rien n'est deviné, rien n'est masqué.
                </p>
              </div>
            </div>
          )}

          {/* --- Besoins --------------------------------------------------------------------- */}
          <div className="detail-block">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              <h4 style={{ margin: 0 }}>Besoins par composant et par coloris</h4>
              <span style={{ fontSize: 12, color: "var(--v2-text-3)" }}>
                {resultat.totaux.composants} composants — {resultat.totaux.lignes} lignes —{" "}
                {resultat.totaux.a_commander} à commander
              </span>
            </div>

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
                      <th className="n">Besoin total</th>
                      <th className="n">Déjà commandé</th>
                      <th className="n">dont reçu</th>
                      <th className="n">Reste à commander</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultat.lignes.map((l) => (
                      <tr key={l.composant_cle + l.cible_cle + (l.unite || "")} className={l.anomalies.length ? "anomalie" : ""}>
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
                            <span className="appro-puce alerte" key={a} title={resultat.libelles_anomalies[a] || a}>à compléter</span>
                          ))}
                        </td>
                        <td className="n">{nombre(l.quantite_production)}</td>
                        <td className="n">{nombre(l.besoin_brut, l.unite)}</td>
                        <td className="n">{l.perte_pourcent ? `${nombre(l.perte_pourcent)} %` : "—"}</td>
                        <td className="n"><strong>{nombre(l.besoin_avec_pertes, l.unite)}</strong></td>
                        <td className="n">{l.deja_commande ? nombre(l.deja_commande, l.unite) : "—"}</td>
                        <td className="n">{l.deja_commande ? nombre(l.dont_recu, l.unite) : "—"}</td>
                        <td className="n appro-reste-fort">{nombre(l.reste_a_commander, l.unite)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "10px 0 0", lineHeight: 1.6 }}>
              Il n'existe pas encore de module Stock : aucun stock n'est déduit, et le besoin total
              correspond donc au besoin brut majoré des pertes. Une matière <strong>commandée</strong>{" "}
              n'est jamais comptée comme <strong>reçue</strong> — les deux colonnes sont distinctes, et
              seule la quantité commandée et affectée à cette production réduit le reste à commander.
            </p>
          </div>

          {/* --- Engagements non rattachés --------------------------------------------------- */}
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
        </>
      )}
    </div>
  );
}
