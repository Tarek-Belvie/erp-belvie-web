import { useEffect, useRef, useState } from "react";
import { Article, Estimation, EstimationLigneAvecCout, SyntheseEstimation, CategorieEstimation, CATEGORIES_ESTIMATION_LABELS, ModeCalculEstimation, SimulationPrixResultat, PosteCoutPredefini } from "../../shared/types";

// Ordre fixe des familles — présentes dès l'ouverture de l'estimation, servent de check-list.
// Une famille sans ligne reste simplement vide, jamais masquée.
const CATEGORIES: CategorieEstimation[] = ["matiere", "fourniture", "habillage", "emballage", "transport", "confection", "impression", "retouche", "autre"];
const LIBELLE_AJOUT: Record<CategorieEstimation, string> = {
  matiere: "Ajouter une matière", fourniture: "Ajouter une fourniture", habillage: "Ajouter un élément",
  emballage: "Ajouter un élément", transport: "Ajouter une ligne", confection: "Ajouter une ligne",
  impression: "Ajouter une ligne", retouche: "Ajouter une ligne", autre: "Ajouter une ligne",
};
const MODES_LABELS: Record<ModeCalculEstimation, string> = {
  consommation_prix: "Consommation × prix", unitaire_direct: "Coût direct / pièce", montant_global: "Montant global production",
};

function formatMontant(n: number | null | undefined, decimales = 2): string {
  if (n == null) return "—";
  return n.toLocaleString("fr-FR", { minimumFractionDigits: decimales, maximumFractionDigits: decimales }) + " DT";
}

interface Props {
  articleId: number;
  nom: string;
  onRetour: () => void;
}

// Écran central du nouveau workflow : le coût d'un produit, estimé AVANT tout achat, fournisseur
// ou BC. Les lignes s'ajoutent/se modifient/se suppriment immédiatement (comme une liste vivante,
// pas un formulaire à valider) ; seule la quantité prévue suit le geste Enregistrer explicite,
// pour rester cohérent avec le principe "jamais de faux avertissement de fermeture".
export default function FinanceEstimationPage({ articleId, nom, onRetour }: Props) {
  const [article, setArticle] = useState<Article | null>(null);
  const [estimation, setEstimation] = useState<Estimation | null>(null);
  const [synthese, setSynthese] = useState<SyntheseEstimation | null>(null);
  const [quantitePrevue, setQuantitePrevue] = useState<number | "">("");
  const [quantiteInitiale, setQuantiteInitiale] = useState<number | "">("");
  const [busy, setBusy] = useState(false);
  const [juisteEnregistre, setJusteEnregistre] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [erreurLigne, setErreurLigne] = useState<string | null>(null);
  const [derniereLigneAjouteeId, setDerniereLigneAjouteeId] = useState<number | null>(null);
  const [tauxTvaAffichage, setTauxTvaAffichage] = useState<number | null>(null);

  async function charger() {
    try {
      const [art, est] = await Promise.all([
        window.api.articles.get(articleId),
        window.api.finance.getOuCreerEstimation(articleId),
      ]);
      setArticle(art);
      setEstimation(est);
      setQuantitePrevue(est.quantite_prevue ?? "");
      setQuantiteInitiale(est.quantite_prevue ?? "");
      const s = await window.api.finance.syntheseEstimation(est.id);
      setSynthese(s);
      const entreprise = await window.api.entreprise.get();
      setTauxTvaAffichage(entreprise?.taux_tva_defaut ?? null);
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    }
  }
  useEffect(() => { charger(); }, [articleId]);

  async function rafraichirSynthese() {
    if (!estimation) return;
    setSynthese(await window.api.finance.syntheseEstimation(estimation.id));
  }

  const quantiteModifiee = quantitePrevue !== quantiteInitiale;

  async function handleEnregistrerQuantite(fermerApres: boolean) {
    if (!estimation) return;
    setBusy(true);
    try {
      await window.api.finance.mettreAJourEstimation(estimation.id, { quantite_prevue: quantitePrevue === "" ? null : Number(quantitePrevue) });
      setQuantiteInitiale(quantitePrevue);
      await rafraichirSynthese();
      if (fermerApres) { onRetour(); return; }
      setJusteEnregistre(true);
      setTimeout(() => setJusteEnregistre(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  // Une seule fonction, utilisée par les neuf boutons "+ Ajouter" (un par famille) — la catégorie
  // est désormais fixée par la section, jamais ressaisie ligne par ligne. Le taux de TVA est
  // systématiquement relu depuis le Profil entreprise au moment exact du clic, jamais depuis un
  // instantané mis en cache — c'est la seule façon de garantir qu'il ne se périme jamais.
  async function handleAjouterLigne(categorie: CategorieEstimation) {
    if (!estimation) return;
    try {
      const entreprise = await window.api.entreprise.get();
      const tauxActuel = entreprise?.taux_tva_defaut ?? undefined;
      setTauxTvaAffichage(entreprise?.taux_tva_defaut ?? null);
      console.log("[DIAG TVA] 1. entreprise.taux_tva_defaut =", entreprise?.taux_tva_defaut, "| typeof =", typeof entreprise?.taux_tva_defaut);
      console.log("[DIAG TVA] 2. tauxActuel envoyé au payload =", tauxActuel);
      const nouvelle = await window.api.finance.ajouterLigneEstimation(estimation.id, {
        categorie, designation: "", mode_calcul: "consommation_prix",
        taux_tva: tauxActuel,
      });
      console.log("[DIAG TVA] 3. Ligne retournée par ajouterLigneEstimation =", JSON.stringify(nouvelle));
      setDerniereLigneAjouteeId(nouvelle.id);
      await rafraichirSynthese();
      const s = await window.api.finance.syntheseEstimation(estimation.id);
      const ligneDansState = s.lignes.find((l) => l.id === nouvelle.id);
      console.log("[DIAG TVA] 4. Ligne relue après rafraîchissement (ce que le state React reçoit) =", JSON.stringify(ligneDansState));
      console.log("[DIAG TVA] 5. Valeur taux_tva précise dans ce state =", ligneDansState?.taux_tva, "| typeof =", typeof ligneDansState?.taux_tva);
    } catch (err: any) {
      setErreurLigne(err?.message || "Erreur lors de l'ajout de la ligne.");
      setTimeout(() => setErreurLigne(null), 4000);
    }
  }

  async function handleModifierLigne(ligneId: number, patch: Partial<EstimationLigneAvecCout>) {
    await window.api.finance.mettreAJourLigneEstimation(ligneId, patch);
    await rafraichirSynthese();
  }

  const [confirmSupprimerLigne, setConfirmSupprimerLigne] = useState<{ id: number; designation: string } | null>(null);
  async function handleSupprimerLigne() {
    if (!confirmSupprimerLigne) return;
    await window.api.finance.supprimerLigneEstimation(confirmSupprimerLigne.id);
    setConfirmSupprimerLigne(null);
    await rafraichirSynthese();
  }

  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;
  if (!article || !estimation || !synthese) return <p className="empty-state">Chargement...</p>;

  return (
    <div className="finance-page-large">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>
      <h2>{nom} — Estimation de coût</h2>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, marginBottom: 24 }}>
        <label className="finance-fp-champ" style={{ maxWidth: 220, marginBottom: 0 }}>Quantité envisagée
          <input type="number" min={0} value={quantitePrevue} onChange={(e) => setQuantitePrevue(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <div className="finance-tva-bandeau" title="Toutes les nouvelles lignes héritent de ce taux, modifiable ligne par ligne.">
          <span className="finance-tva-bandeau-titre">TVA par défaut :</span>
          <span className="finance-tva-bandeau-valeur">{tauxTvaAffichage != null ? `${tauxTvaAffichage} %` : "non configurée"}</span>
        </div>
      </div>

      {erreurLigne && <p style={{ color: "var(--v2-danger)", fontSize: 12, marginBottom: 10 }}>{erreurLigne}</p>}

      {CATEGORIES.map((cat) => {
        const lignesCategorie = synthese.lignes.filter((l) => l.categorie === cat);
        return (
          <div key={cat} className="finance-estim-famille">
            <div className="finance-estim-famille-titre">{CATEGORIES_ESTIMATION_LABELS[cat].toUpperCase()}</div>

            {lignesCategorie.length > 0 && (
              <div className="finance-tableau finance-estim-tableau">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Désignation</th><th style={{ textAlign: "left" }}>Mode</th>
                      <th>Unité</th><th>Qté</th><th>Prix HT</th><th>Prix TTC</th>
                      <th>HT/pièce</th><th>TTC/pièce</th><th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {lignesCategorie.map((l) => (
                      <LigneEstimation
                        key={l.id} ligne={l}
                        autoFocus={l.id === derniereLigneAjouteeId}
                        onModifier={(patch) => handleModifierLigne(l.id, patch)}
                        onSupprimer={() => setConfirmSupprimerLigne({ id: l.id, designation: l.designation || "cette ligne" })}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <button className="finance-ajouter-ligne-btn" onClick={() => handleAjouterLigne(cat)}>{LIBELLE_AJOUT[cat]}</button>
          </div>
        );
      })}

      <div className="finance-estim-synthese">
        <div><span>Coût estimé HT/pièce</span><strong>{formatMontant(synthese.cout_ht_piece)}</strong></div>
        <div><span>Coût estimé TTC/pièce</span><strong>{formatMontant(synthese.cout_ttc_piece)}</strong></div>
        <div><span>Coût HT total</span><strong>{formatMontant(synthese.budget_total_ht, 0)}</strong></div>
        <div><span>Coût TTC total</span><strong>{formatMontant(synthese.budget_total_ttc, 0)}</strong></div>
      </div>

      {confirmSupprimerLigne && (
        <div className="modal-veil" onClick={() => setConfirmSupprimerLigne(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Supprimer cet élément d'estimation ?</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              Cette action supprimera uniquement cette ligne ({confirmSupprimerLigne.designation || "sans désignation"}). L'article restera disponible dans le catalogue ERP.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmSupprimerLigne(null)}>Annuler</button>
              <button className="btn danger" onClick={handleSupprimerLigne}>Supprimer</button>
            </div>
          </div>
        </div>
      )}

      <SimulationPrixBloc articleId={articleId} coutHtPiece={synthese.cout_ht_piece} quantitePrevue={synthese.quantite_prevue} prixInitial={article.prix_vente_envisage ?? null} />

      <div className="finance-fp-actions" style={{ marginTop: 26 }}>
        {juisteEnregistre && <span className="planning-panel-confirmation">✓ Enregistré</span>}
        <button className="btn ghost" onClick={() => handleEnregistrerQuantite(true)} disabled={busy}>Enregistrer et quitter</button>
        <button className="btn primary finance-fp-btn-save" onClick={() => handleEnregistrerQuantite(false)} disabled={busy || !quantiteModifiee}>Enregistrer</button>
      </div>
    </div>
  );
}

// ====================================================================================================
// Une ligne de la table de saisie rapide — chaque champ se sauvegarde immédiatement au blur/change.
// La catégorie n'est plus modifiable ligne par ligne : elle est fixée par la famille dans laquelle
// la ligne a été créée (plus de colonne Catégorie répétée sur chaque ligne).
// ====================================================================================================
function stepPourUnite(unite: string): string {
  return unite === "piece" ? "1" : "0.01";
}
function normaliserQuantitePourUnite(v: number, unite: string): number {
  return unite === "piece" ? Math.round(v) : v;
}

// Conversion pure, sans arrondi intermédiaire — l'arrondi n'intervient qu'à l'affichage, jamais
// dans le calcul lui-même, pour ne jamais accumuler d'écart entre HT et TTC au fil des allers-retours.
function htVersTtc(ht: number, taux: number | ""): number {
  return taux === "" ? ht : ht * (1 + taux / 100);
}
function ttcVersHt(ttc: number, taux: number | ""): number {
  return taux === "" ? ttc : ttc / (1 + taux / 100);
}
function arrondi(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function LigneEstimation({ ligne, autoFocus, onModifier, onSupprimer }: { ligne: EstimationLigneAvecCout; autoFocus?: boolean; onModifier: (patch: Partial<EstimationLigneAvecCout>) => void; onSupprimer: () => void }) {
  const [designation, setDesignation] = useState(ligne.designation);
  const designationRef = useRef<{ focus: () => void } | null>(null);
  const [suggestions, setSuggestions] = useState<PosteCoutPredefini[]>([]);
  const [quantite, setQuantite] = useState<number | "">(ligne.quantite ?? (ligne.mode_calcul === "unitaire_direct" ? 1 : ""));
  const [unite, setUnite] = useState(ligne.unite ?? (ligne.mode_calcul === "unitaire_direct" ? "piece" : "kg"));
  const [tauxTva] = useState<number | "">(ligne.taux_tva ?? "");

  useEffect(() => {
    if (autoFocus) designationRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Suggestions toujours filtrées sur la catégorie de la ligne : dans "Habillage", seuls les
  // postes d'Habillage apparaissent — jamais un mélange entre familles.
  async function handleRechercherPostes(texte: string) {
    setSuggestions(await window.api.finance.rechercherPostesCout(texte, 8, ligne.categorie));
  }

  function handleChoisirPoste(poste: PosteCoutPredefini) {
    setDesignation(poste.designation);
    setSuggestions([]);
    // Préremplissage complet en un seul geste — le taux de TVA n'est jamais mémorisé sur le poste
    // lui-même, il vient toujours du profil entreprise, comme pour n'importe quelle nouvelle ligne.
    const patch: Partial<EstimationLigneAvecCout> = { designation: poste.designation, mode_calcul: poste.mode_calcul_defaut };
    if (poste.mode_calcul_defaut === "consommation_prix" || poste.mode_calcul_defaut === "unitaire_direct") {
      const uniteFinale = poste.unite_defaut || (poste.mode_calcul_defaut === "unitaire_direct" ? "piece" : undefined);
      const quantiteFinale = poste.quantite_defaut != null ? poste.quantite_defaut : (poste.mode_calcul_defaut === "unitaire_direct" ? 1 : undefined);
      if (uniteFinale) { patch.unite = uniteFinale; setUnite(uniteFinale); }
      if (quantiteFinale != null) { patch.quantite = quantiteFinale; setQuantite(quantiteFinale); }
    }
    onModifier(patch);
  }

  // HT reste la SEULE valeur réellement persistée (prix_unitaire_ht / montant_global_ht) — le TTC
  // n'est qu'une vue de saisie alternative, calculée avec le taux de TVA fixé une fois à la
  // création de la ligne (jamais modifiable ici) et jamais stockée séparément.
  const [prixHt, setPrixHt] = useState<number | "">(ligne.prix_unitaire_ht ?? "");
  const [prixTtc, setPrixTtc] = useState<number | "">(ligne.prix_unitaire_ht != null ? arrondi(htVersTtc(ligne.prix_unitaire_ht, ligne.taux_tva ?? "")) : "");

  const [montantHt, setMontantHt] = useState<number | "">(ligne.montant_global_ht ?? "");
  const [montantTtc, setMontantTtc] = useState<number | "">(ligne.montant_global_ht != null ? arrondi(htVersTtc(ligne.montant_global_ht, ligne.taux_tva ?? "")) : "");

  function handleChangerPrixHt(v: number | "") {
    setPrixHt(v);
    setPrixTtc(v === "" ? "" : arrondi(htVersTtc(v, tauxTva)));
  }
  function handleChangerPrixTtc(v: number | "") {
    setPrixTtc(v);
    setPrixHt(v === "" ? "" : arrondi(ttcVersHt(v, tauxTva)));
  }
  function handleChangerMontantHt(v: number | "") {
    setMontantHt(v);
    setMontantTtc(v === "" ? "" : arrondi(htVersTtc(v, tauxTva)));
  }
  function handleChangerMontantTtc(v: number | "") {
    setMontantTtc(v);
    setMontantHt(v === "" ? "" : arrondi(ttcVersHt(v, tauxTva)));
  }

  const styleCell = { border: "1px solid var(--v2-border-strong)", borderRadius: 6, padding: "5px 7px", fontSize: 12, width: "100%" };

  return (
    <tr>
      <td style={{ position: "relative" }}>
        <input
          ref={designationRef as any} type="text" value={designation}
          onChange={(e) => { setDesignation(e.target.value); handleRechercherPostes(e.target.value); }}
          onFocus={() => handleRechercherPostes(designation)}
          onBlur={() => { setTimeout(() => setSuggestions([]), 150); designation !== ligne.designation && onModifier({ designation }); }}
          placeholder="Désignation, ou tapez pour rechercher un poste..." style={styleCell}
        />
        {suggestions.length > 0 && (
          <div className="finance-suggestions-postes">
            {suggestions.map((s) => (
              <div key={s.id} className="finance-suggestion-poste" onMouseDown={() => handleChoisirPoste(s)}>
                <span>{s.designation}</span>
              </div>
            ))}
            <div className="finance-suggestion-poste finance-suggestion-poste-libre" onMouseDown={() => setSuggestions([])}>
              <span>Autre / saisie libre</span>
            </div>
          </div>
        )}
      </td>
      <td>
        <select value={ligne.mode_calcul} onChange={(e) => {
          const nouveauMode = e.target.value as ModeCalculEstimation;
          const patch: Partial<EstimationLigneAvecCout> = { mode_calcul: nouveauMode };
          if (nouveauMode === "unitaire_direct" && quantite === "") { patch.quantite = 1; patch.unite = "piece"; setQuantite(1); setUnite("piece"); }
          onModifier(patch);
        }} style={{ ...styleCell, minWidth: 150 }}>
          {(["consommation_prix", "unitaire_direct", "montant_global"] as ModeCalculEstimation[]).map((m) => <option key={m} value={m}>{MODES_LABELS[m]}</option>)}
        </select>
      </td>
      {(ligne.mode_calcul === "consommation_prix" || ligne.mode_calcul === "unitaire_direct") ? (
        <>
          <td>
            <select value={unite} onChange={(e) => { const nouvelleUnite = e.target.value; setUnite(nouvelleUnite); onModifier({ unite: nouvelleUnite }); if (quantite !== "") { const q = normaliserQuantitePourUnite(quantite, nouvelleUnite); setQuantite(q); onModifier({ quantite: q }); } }} style={{ ...styleCell, width: 62 }}>
              <option value="kg">kg</option><option value="m">m</option><option value="piece">pièce</option><option value="lot">lot</option>
            </select>
          </td>
          <td><input type="number" step={stepPourUnite(unite)} value={quantite} onChange={(e) => setQuantite(e.target.value === "" ? "" : Number(e.target.value))} onBlur={() => onModifier({ quantite: quantite === "" ? null : normaliserQuantitePourUnite(quantite, unite) })} style={{ ...styleCell, width: 60 }} /></td>
          <td><input type="number" step="0.001" value={prixHt} onChange={(e) => handleChangerPrixHt(e.target.value === "" ? "" : Number(e.target.value))} onBlur={() => onModifier({ prix_unitaire_ht: prixHt === "" ? null : prixHt })} placeholder="Prix HT" style={{ ...styleCell, width: 72 }} /></td>
          <td>
            <input type="number" step="0.001" value={prixTtc} disabled={tauxTva === ""}
              onChange={(e) => handleChangerPrixTtc(e.target.value === "" ? "" : Number(e.target.value))}
              onBlur={() => onModifier({ prix_unitaire_ht: prixHt === "" ? null : prixHt })}
              placeholder={tauxTva === "" ? "TVA non définie" : "Prix TTC"}
              title={tauxTva === "" ? "Configurez le taux de TVA dans Profil entreprise pour activer le calcul TTC." : undefined}
              style={{ ...styleCell, width: 72, ...(tauxTva === "" ? { background: "var(--v2-page-bg)", color: "var(--v2-text-3)", fontStyle: "italic" } : {}) }} />
          </td>
        </>
      ) : (
        <>
          <td colSpan={2} style={{ textAlign: "center", color: "var(--v2-text-3)", fontSize: 11 }}>—</td>
          <td><input type="number" step="0.01" value={montantHt} onChange={(e) => handleChangerMontantHt(e.target.value === "" ? "" : Number(e.target.value))} onBlur={() => onModifier({ montant_global_ht: montantHt === "" ? null : montantHt })} placeholder="Total HT" style={{ ...styleCell, width: 80 }} /></td>
          <td>
            <input type="number" step="0.01" value={montantTtc} disabled={tauxTva === ""}
              onChange={(e) => handleChangerMontantTtc(e.target.value === "" ? "" : Number(e.target.value))}
              onBlur={() => onModifier({ montant_global_ht: montantHt === "" ? null : montantHt })}
              placeholder={tauxTva === "" ? "TVA non définie" : "Total TTC"}
              title={tauxTva === "" ? "Configurez le taux de TVA dans Profil entreprise pour activer le calcul TTC." : undefined}
              style={{ ...styleCell, width: 80, ...(tauxTva === "" ? { background: "var(--v2-page-bg)", color: "var(--v2-text-3)", fontStyle: "italic" } : {}) }} />
          </td>
        </>
      )}
      <td style={{ fontWeight: 600 }}>{formatMontant(ligne.cout_ht_piece)}</td>
      <td>{formatMontant(ligne.cout_ttc_piece)}</td>
      <td><button className="icon-btn" onClick={onSupprimer} title="Supprimer" aria-label="Supprimer">✕</button></td>
    </tr>
  );
}

// ====================================================================================================
// Simulation de prix bidirectionnelle — barre réglable coefficient ↔ prix envisagé, jamais imposée.
// Glisser la barre recalcule le prix en direct ; saisir le prix repositionne la barre. Le prix
// envisagé (seule valeur persistée) se sauvegarde au blur ; tout le reste est recalculé à la volée.
// ====================================================================================================
function SimulationPrixBloc({ articleId, coutHtPiece, quantitePrevue, prixInitial }: { articleId: number; coutHtPiece: number; quantitePrevue: number | null; prixInitial: number | null }) {
  const coeffInitial = prixInitial != null && coutHtPiece > 0 ? prixInitial / coutHtPiece : 1.7;
  const [coefficient, setCoefficient] = useState(Math.min(10, Math.max(1, coeffInitial)));
  const [prix, setPrix] = useState<number | "">(prixInitial ?? "");
  const [resultat, setResultat] = useState<SimulationPrixResultat | null>(null);

  async function appliquerCoefficient(nouveauCoeff: number) {
    const c = Math.min(10, Math.max(1, nouveauCoeff));
    setCoefficient(c);
    if (coutHtPiece <= 0) return;
    const r = await window.api.finance.simulationPrix(coutHtPiece, { coefficient: c }, quantitePrevue);
    setResultat(r);
    if (r) setPrix(Math.round(r.prix_vente * 100) / 100);
  }

  async function recalculerDepuisPrix(nouveauPrix: number | "") {
    setPrix(nouveauPrix);
    if (nouveauPrix === "" || coutHtPiece <= 0) { setResultat(null); return; }
    const r = await window.api.finance.simulationPrix(coutHtPiece, { prixEnvisage: nouveauPrix }, quantitePrevue);
    setResultat(r);
    if (r?.coefficient != null) setCoefficient(Math.min(10, Math.max(1, r.coefficient)));
  }

  function handleMolette(e: { preventDefault: () => void; deltaY: number }) {
    e.preventDefault();
    const pas = e.deltaY < 0 ? 0.05 : -0.05;
    appliquerCoefficient(Math.round((coefficient + pas) * 100) / 100);
  }

  async function handleSauvegarderPrix() {
    await window.api.finance.mettreAJourPrixVenteEnvisage(articleId, prix === "" ? null : prix);
  }

  return (
    <div className="finance-fp-section" style={{ marginTop: 28, borderTop: "1px solid var(--v2-border)", paddingTop: 22 }}>
      <div className="finance-fp-section-titre">Prix de vente envisagé</div>

      <div className="finance-coeff-slider-bloc">
        <div className="finance-coeff-slider-valeur">Coefficient : <strong>{coefficient.toFixed(2)}</strong></div>
        <div className="finance-coeff-slider-ligne">
          <span>1</span>
          <input
            type="range" min={1} max={10} step={0.05} value={coefficient}
            onChange={(e) => appliquerCoefficient(Number(e.target.value))}
            onWheel={handleMolette}
            className="finance-coeff-slider"
          />
          <span>10</span>
        </div>
      </div>

      <div className="finance-fp-grid-2" style={{ maxWidth: 460, marginTop: 18 }}>
        <label className="finance-fp-champ">Prix de vente envisagé (DT)
          <input type="number" step="0.01" value={prix} onChange={(e) => recalculerDepuisPrix(e.target.value === "" ? "" : Number(e.target.value))} onBlur={handleSauvegarderPrix} />
        </label>
        <label className="finance-fp-champ">Coefficient obtenu
          <input type="text" readOnly value={resultat?.coefficient != null ? resultat.coefficient.toFixed(2) : coefficient.toFixed(2)} style={{ background: "var(--v2-page-bg)" }} />
        </label>
      </div>

      {resultat && (
        <div className="finance-fp-indicateurs" style={{ marginTop: 4 }}>
          <div><span>Coût / pièce HT</span><strong>{formatMontant(coutHtPiece)}</strong></div>
          <div><span>Prix envisagé</span><strong>{formatMontant(resultat.prix_vente)}</strong></div>
          <div><span>Marge unitaire</span><strong>{formatMontant(resultat.marge_unitaire)}</strong></div>
          <div><span>Taux de marge</span><strong>{resultat.taux_marge != null ? `${resultat.taux_marge.toFixed(1)} %` : "—"}</strong></div>
          <div><span>Marge totale estimée</span><strong>{formatMontant(resultat.marge_totale_estimee, 0)}</strong></div>
        </div>
      )}
    </div>
  );
}
