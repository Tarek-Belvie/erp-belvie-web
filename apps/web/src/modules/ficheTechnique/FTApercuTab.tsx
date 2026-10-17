import { useState } from "react";
import { Article, FicheTechnique } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";
import { CSS_RENDU_DESCRIPTION } from "./descriptionRendu";

const api: any = (window as any).api;

// La description est rendue par la feuille de style commune (descriptionRendu.ts), celle-là même
// qui habille la zone d'édition. Aucune règle propre à cet onglet : c'est ce qui garantit que
// l'aperçu, l'éditeur et le PDF montrent le même document. Seule la taille de base est réduite
// ici, cet onglet représentant une page imprimée en réduction.
const STYLES_DESC = CSS_RENDU_DESCRIPTION + `
.ft-doc-section .ft-rendu { font-size: 12px; line-height: 1.6; }
.ft-doc-section .ft-rendu table { font-size: 11px; }
`;

interface Props {
  fiche: FicheTechnique;
  article: Article;
}

export default function FTApercuTab({ fiche, article }: Props) {
  const [pdfEnCours, setPdfEnCours] = useState(false);
  const [pdfMessage, setPdfMessage] = useState<string | null>(null);

  // Le PDF est construit côté processus principal, dans une fenêtre dédiée : il ne dépend donc
  // ni de la taille de cette fenêtre, ni de ce qui est affiché à l'écran.
  async function telechargerPdf() {
    setPdfEnCours(true);
    setPdfMessage(null);
    try {
      const nom = `fiche-technique-${(article.reference_principale || "article").replace(/[^A-Za-z0-9-]/g, "-")}.pdf`;
      const res = await api.ficheTechnique.telechargerPdf(fiche.id, nom);
      if (!res?.canceled) setPdfMessage(`PDF enregistré : ${res.filePath}`);
    } catch (err: any) {
      setPdfMessage(err?.message || "Génération du PDF impossible.");
    } finally {
      setPdfEnCours(false);
    }
  }

  const grille = fiche.grille ?? { lignes: [], tailles: [], valeurs: [] };
  const matieres = fiche.matieres ?? [];
  const fournitures = fiche.accessoires ?? [];
  const habillage = fournitures.filter((f) => f.famille === "habillage");
  const composants = fournitures.filter((f) => f.famille === "composant");

  // Miroir exact du calcul du processus principal : consommation technique x (1 + perte / 100).
  // Aucune colonne ne stocke la consommation budgétée, ici comme ailleurs.
  function budgetee(technique: number | null, perte: number | null): string {
    if (technique == null) return "—";
    return (technique * (1 + (perte || 0) / 100)).toFixed(3).replace(".", ",");
  }
  function num(n: number | null, d = 3): string {
    return n == null ? "—" : String(n).replace(".", ",");
  }

  function getValeur(mesureId: number, ftTailleId: number): string {
    return grille.valeurs.find((v) => v.mesure_catalogue_id === mesureId && v.ft_taille_id === ftTailleId)?.valeur ?? "—";
  }

  return (
    <div>
      <style>{STYLES_DESC}</style>

      <div className="no-print" style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button className="btn primary" onClick={telechargerPdf} disabled={pdfEnCours}>
          {pdfEnCours ? "Génération…" : "Télécharger en PDF"}
        </button>
        <button className="btn ghost" onClick={() => window.print()}>Impression rapide</button>
        {pdfMessage && <span style={{ fontSize: 12, color: "var(--v2-text-2)" }}>{pdfMessage}</span>}
      </div>

      <div id="ft-print-area">
        <div className="ft-doc">
          <div className="ft-doc-header">
            <div>
              <div className="ft-doc-title">Fiche technique — {article.produit}</div>
              <div className="ft-doc-sub">{article.reference_principale ?? "Référence à compléter"} {article.saison ? `· ${article.saison}` : ""}</div>
            </div>
            <span className={`v2-badge ${fiche.statut === "validee" ? "v2-badge-validee" : fiche.statut === "archivee" ? "v2-badge-archivee" : "v2-badge-brouillon"}`}>
              {fiche.statut === "brouillon" ? "Brouillon" : fiche.statut === "validee" ? "Validée" : "Archivée"}
            </span>
          </div>

          {fiche.description_technique && (
            <div className="ft-doc-section">
              <div className="ft-doc-section-title">Description technique</div>
              <div className="ft-rendu" dangerouslySetInnerHTML={{ __html: fiche.description_technique }} />
            </div>
          )}

          {(fiche.croquis ?? []).length > 0 && (
            <div className="ft-doc-section">
              <div className="ft-doc-section-title">Croquis techniques</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 14 }}>
                {(fiche.croquis ?? []).map((c) => (
                  <div key={c.id} style={{ width: 260, pageBreakInside: "avoid" }}>
                    <div style={{ position: "relative", border: "1px solid #E7E9E0", borderRadius: 8, overflow: "hidden" }}>
                      <img src={mediaUrl(c.image_path)!} alt="" style={{ width: "100%", display: "block" }} />
                      <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
                        {c.annotations.filter((a) => a.visible_impression).map((a) => (
                          <line key={a.id} x1={a.label_x * 100} y1={a.label_y * 100} x2={a.ancre_x * 100} y2={a.ancre_y * 100} stroke={a.couleur || "#1A1A1A"} strokeWidth={a.epaisseur || 1} vectorEffect="non-scaling-stroke" />
                        ))}
                      </svg>
                      {c.annotations.filter((a) => a.visible_impression).map((a) => (
                        <div key={a.id} style={{ position: "absolute", left: `${a.label_x * 100}%`, top: `${a.label_y * 100}%`, transform: "translate(-50%, -100%)", background: "#fff", border: `1px solid ${a.couleur || "#1A1A1A"}`, borderRadius: 4, padding: "1px 5px", fontSize: 9, whiteSpace: "nowrap" }}>
                          {a.texte}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 11, textAlign: "center", marginTop: 4, color: "#6B6B62" }}>
                      {c.vue === "autre" ? c.vue_personnalisee : c.vue === "face" ? "Face" : c.vue === "dos" ? "Dos" : "Détail"}
                      {c.legende ? ` — ${c.legende}` : ""}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {grille.lignes.length > 0 && grille.tailles.length > 0 && (
            <div className="ft-doc-section" style={{ pageBreakInside: "avoid" }}>
              <div className="ft-doc-section-title">Tableau de mesures</div>
              <div className="grid-table-wrap">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Repère</th>
                      <th style={{ textAlign: "left" }}>Mesure</th>
                      {/* Colonne « Unité » retirée du document atelier : les mesures d'un vêtement
                          sont exprimées dans la même unité, et le champ contenait en pratique des
                          valeurs saisies par erreur. La donnée reste en base. */}
                      <th>Tolérance</th>
                      {grille.tailles.map((t) => <th key={t.id}>{t.nom}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {grille.lignes.map((l) => (
                      <tr key={l.id}>
                        <td>{l.repere || "—"}</td>
                        <td className="grid-row-label">{l.nom}</td>
                        <td>{l.tolerance_plus || l.tolerance_moins ? `+${l.tolerance_plus || 0} / -${l.tolerance_moins || 0}` : "—"}</td>
                        {grille.tailles.map((t) => <td key={t.id}>{getValeur(l.id, t.id)}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {matieres.length > 0 && (
            <div className="ft-doc-section" style={{ pageBreakInside: "avoid" }}>
              <div className="ft-doc-section-title">Matières</div>
              <div className="grid-table-wrap">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Matière</th>
                      <th style={{ textAlign: "left" }}>Utilisation</th>
                      <th style={{ textAlign: "left" }}>Composition</th>
                      <th>Grammage</th>
                      <th>Conso. technique</th>
                      <th>Perte</th>
                      <th>Conso. budgétée</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matieres.map((m) => (
                      <tr key={m.id}>
                        <td className="grid-row-label">{m.nom}</td>
                        <td>{m.utilisation || "—"}</td>
                        <td>{m.composition || "—"}</td>
                        <td>{m.grammage ? `${m.grammage} g/m²` : "—"}</td>
                        <td>{num(m.consommation_technique)} {m.unite}/pièce</td>
                        <td>{num(m.perte_pourcent, 0)} %</td>
                        <td><strong>{budgetee(m.consommation_technique, m.perte_pourcent)} {m.unite}/pièce</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {matieres.some((m) => m.couleurs.length > 0) && (
                <div className="grid-table-wrap" style={{ marginTop: 10 }}>
                  <table className="grid-table">
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left" }}>Matière</th>
                        <th style={{ textAlign: "left" }}>Couleur produit</th>
                        <th style={{ textAlign: "left" }}>Coloris matière</th>
                        <th style={{ textAlign: "left" }}>Référence</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matieres.flatMap((m) => m.couleurs.map((c) => (
                        <tr key={`${m.id}-${c.id}`}>
                          <td className="grid-row-label">{m.nom}</td>
                          <td>{c.couleur_produit_nom}</td>
                          <td>{c.matiere_couleur_libelle || "—"}</td>
                          <td>{c.matiere_couleur_reference || "—"}</td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {fournitures.length > 0 && (
            <div className="ft-doc-section" style={{ pageBreakInside: "avoid" }}>
              <div className="ft-doc-section-title">Nomenclature</div>

              {habillage.length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 700, margin: "6px 0 4px", color: "#55564E" }}>
                    Habillage &amp; Branding
                  </div>
                  <div className="grid-table-wrap">
                    <table className="grid-table">
                      <thead>
                        <tr>
                          <th style={{ width: 46 }}></th>
                          <th style={{ textAlign: "left" }}>Désignation</th>
                          <th style={{ textAlign: "left" }}>Référence</th>
                          <th>Conso. / pièce</th>
                        </tr>
                      </thead>
                      <tbody>
                        {habillage.map((f) => (
                          <tr key={f.id}>
                            <td>{f.photo_path ? <img src={mediaUrl(f.photo_path)!} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 4, display: "block" }} /> : "—"}</td>
                            <td className="grid-row-label">{f.nom}</td>
                            <td>{f.reference || "—"}</td>
                            <td>{f.consommation_par_piece != null ? `${num(f.consommation_par_piece)} ${f.unite || ""}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {composants.length > 0 && (
                <>
                  <div style={{ fontSize: 11.5, fontWeight: 700, margin: "12px 0 4px", color: "#55564E" }}>
                    Composants de confection
                  </div>
                  <div className="grid-table-wrap">
                    <table className="grid-table">
                      <thead>
                        <tr>
                          <th style={{ width: 46 }}></th>
                          <th style={{ textAlign: "left" }}>Désignation</th>
                          <th style={{ textAlign: "left" }}>Utilisation</th>
                          <th style={{ textAlign: "left" }}>Couleur</th>
                          <th style={{ textAlign: "left" }}>Taille / Dimension</th>
                          <th style={{ textAlign: "left" }}>Référence</th>
                          <th>Conso. / pièce</th>
                        </tr>
                      </thead>
                      <tbody>
                        {composants.map((f) => (
                          <tr key={f.id}>
                            <td>{f.photo_path ? <img src={mediaUrl(f.photo_path)!} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 4, display: "block" }} /> : "—"}</td>
                            <td className="grid-row-label">{f.nom}</td>
                            <td>{f.emplacement || "—"}</td>
                            <td>{f.couleur || "—"}</td>
                            <td>{f.taille_dimension || "—"}</td>
                            <td>{f.reference || "—"}</td>
                            <td>{f.consommation_par_piece != null ? `${num(f.consommation_par_piece)} ${f.unite || ""}` : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
          {fiche.notes && (
            <div className="ft-doc-section" style={{ pageBreakInside: "avoid" }}>
              <div className="ft-doc-section-title">Notes générales</div>
              <p style={{ fontSize: 12, whiteSpace: "pre-wrap" }}>{fiche.notes}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
