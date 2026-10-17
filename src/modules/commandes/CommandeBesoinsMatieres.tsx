import { useEffect, useState } from "react";
import { BesoinsMatieres } from "../../shared/types";

interface Props {
  commandeId: number;
  /** Toute valeur qui change quand la commande change force un recalcul. Dans
   *  CommandeDetailModal on passe `commande.updated_at` : le trigger trg_commandes_updated_at le
   *  met à jour à chaque modification de la répartition (update() recalcule quantite_totale, donc
   *  écrit sur la ligne commandes). Le besoin étant calculé à la volée, il n'y a rien d'autre à
   *  invalider. */
  refreshKey?: number | string;
}

const UNITES: Record<string, string> = { kg: "kg", m: "m", piece: "pièce", lot: "lot" };

/** Arrondi d'AFFICHAGE uniquement. Les valeurs reçues du processus principal ne sont jamais
 *  arrondies : arrondir avant de sommer ferait diverger le total de la somme des lignes. */
function fmt(n: number | null, decimales = 2): string {
  if (n == null) return "—";
  return n.toFixed(decimales).replace(".", ",");
}

export default function CommandeBesoinsMatieres({ commandeId, refreshKey }: Props) {
  const [data, setData] = useState<BesoinsMatieres | null>(null);
  const [ouvert, setOuvert] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    let annule = false;
    window.api.commandes
      .besoinsMatieres(commandeId)
      .then((d: BesoinsMatieres) => {
        if (annule) return;
        setData(d);
        // Une anomalie ne doit pas pouvoir passer inaperçue derrière un bloc replié.
        if (d.couleurs_sans_correspondance.length > 0) setOuvert(true);
      })
      .catch((err: any) => { if (!annule) setErreur(err?.message || "Calcul impossible."); });
    return () => { annule = true; };
  }, [commandeId, refreshKey]);

  if (erreur) {
    return <p style={{ fontSize: 12.5, color: "var(--v2-danger)" }}>{erreur}</p>;
  }
  // Pas de fiche technique, ou fiche sans matière : le bloc ne s'affiche pas du tout plutôt que
  // d'occuper de la place pour dire qu'il n'a rien à dire.
  if (!data || !data.fiche_id || data.matieres.length === 0) return null;

  const anomalies = data.couleurs_sans_correspondance;
  const synthese = data.matieres
    .filter((m) => m.total != null)
    .map((m) => `${m.nom} ${fmt(m.total)} ${UNITES[m.unite] ?? m.unite}`)
    .join(" · ");

  return (
    <div style={{ border: "1px solid #E7E9E0", borderRadius: 10, background: "#fff", marginTop: 14 }}>
      <div
        onClick={() => setOuvert(!ouvert)}
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}
      >
        <span style={{ fontSize: 11, color: "var(--v2-text-3)", transform: ouvert ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▶</span>
        <strong style={{ fontSize: 13.5 }}>Besoins matières</strong>
        {synthese && <span style={{ fontSize: 12.5, color: "var(--v2-text-2)" }}>· {synthese}</span>}
        {anomalies.length > 0 && (
          <span
            style={{
              fontSize: 11.5, fontWeight: 600, color: "var(--v2-danger)",
              background: "var(--v2-danger-bg)", padding: "2px 8px", borderRadius: 10,
            }}
          >
            ⚠ {anomalies.length} couleur{anomalies.length > 1 ? "s" : ""} sans matière
          </span>
        )}
        <span style={{ marginLeft: "auto", fontSize: 11.5, color: "var(--v2-text-3)" }}>
          {data.fiche_statut === "validee"
            ? "Fiche technique validée"
            : data.fiche_statut === "archivee"
              ? "Fiche technique archivée"
              : "Brouillon — besoins susceptibles d'évoluer"}
        </span>
      </div>

      {ouvert && (
        <div style={{ padding: "0 14px 14px" }}>
          {anomalies.length > 0 && (
            <div
              style={{
                background: "var(--v2-danger-bg)", border: "1px solid var(--v2-danger)",
                borderRadius: 8, padding: "9px 12px", marginBottom: 12, fontSize: 12.5,
              }}
            >
              <strong style={{ color: "var(--v2-danger)" }}>Couleurs commandées sans matière associée</strong>
              <div style={{ marginTop: 4, color: "var(--v2-text-2)" }}>
                {anomalies.map((a) => `${a.couleur_nom} (${a.pieces} pièces)`).join(", ")}
              </div>
              <div style={{ marginTop: 4, color: "var(--v2-text-3)", fontSize: 12 }}>
                Leur besoin ne peut pas être calculé. Complétez la correspondance des coloris dans
                l'onglet Matières de la fiche technique.
              </div>
            </div>
          )}

          {data.matieres.map((m) => {
            const u = UNITES[m.unite] ?? m.unite;
            const commandees = m.lignes.filter((l) => l.commandee);
            return (
              <div key={m.ft_matiere_id} style={{ marginBottom: 14 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 5 }}>
                  <strong style={{ fontSize: 13 }}>{m.nom}</strong>
                  {m.utilisation && <span style={{ fontSize: 12, color: "var(--v2-text-3)" }}>{m.utilisation}</span>}
                  <span style={{ marginLeft: "auto", fontSize: 13, fontWeight: 600 }}>
                    {m.incomplete ? "—" : `${fmt(m.total)} ${u}`}
                  </span>
                </div>

                {m.incomplete ? (
                  <p style={{ fontSize: 12.5, color: "var(--v2-danger)", margin: "2px 0" }}>
                    Consommation technique non renseignée dans la fiche technique — besoin non calculable.
                  </p>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "var(--v2-text-3)", marginBottom: 5 }}>
                      {fmt(m.consommation_technique, 3)} {u}/pièce + {fmt(m.perte_pourcent, 0)} % de perte
                      {" = "}
                      <strong style={{ color: "var(--v2-text-2)" }}>{fmt(m.consommation_budgetee, 3)} {u}/pièce</strong>
                    </div>

                    {commandees.length === 0 ? (
                      <p style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>
                        Aucune couleur de cette matière n'est présente dans la commande.
                      </p>
                    ) : (
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                        <thead>
                          <tr style={{ color: "#9A9A90", fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em" }}>
                            <th style={{ textAlign: "left", fontWeight: 600, padding: "3px 0" }}>Couleur produit</th>
                            <th style={{ textAlign: "left", fontWeight: 600, padding: "3px 0" }}>Coloris matière</th>
                            <th style={{ textAlign: "right", fontWeight: 600, padding: "3px 0" }}>Pièces</th>
                            <th style={{ textAlign: "right", fontWeight: 600, padding: "3px 0" }}>Besoin</th>
                          </tr>
                        </thead>
                        <tbody>
                          {commandees.map((l) => (
                            <tr key={l.couleur_produit_id} style={{ borderTop: "1px solid #F0F1EC" }}>
                              <td style={{ padding: "4px 0" }}>{l.couleur_nom}</td>
                              <td style={{ padding: "4px 0", color: "var(--v2-text-2)" }}>
                                {l.coloris_matiere || <span style={{ color: "var(--v2-text-3)" }}>coloris à définir</span>}
                                {l.coloris_reference && (
                                  <span style={{ color: "var(--v2-text-3)", marginLeft: 6, fontSize: 12 }}>
                                    {l.coloris_reference}
                                  </span>
                                )}
                              </td>
                              <td style={{ padding: "4px 0", textAlign: "right" }}>{l.pieces}</td>
                              <td style={{ padding: "4px 0", textAlign: "right", fontWeight: 600 }}>
                                {fmt(l.besoin)} {u}
                              </td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: "1px solid #D8D9D0" }}>
                            <td colSpan={2} style={{ padding: "5px 0", fontWeight: 600 }}>Total</td>
                            <td style={{ padding: "5px 0", textAlign: "right", fontWeight: 600 }}>
                              {commandees.reduce((s, l) => s + l.pieces, 0)}
                            </td>
                            <td style={{ padding: "5px 0", textAlign: "right", fontWeight: 600 }}>
                              {fmt(m.total)} {u}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: 0, borderTop: "1px solid #F0F1EC", paddingTop: 8 }}>
            Besoin théorique calculé à la volée depuis la fiche technique et les quantités de cette
            commande. Aucune valeur n'est figée : les quantités réellement achetées relèvent du module Achats.
          </p>
        </div>
      )}
    </div>
  );
}
