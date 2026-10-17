import { useEffect, useState } from "react";
import { Article, FicheTechnique } from "../../shared/types";
import Icon from "../../shared/Icon";
import FTInfosTab from "./FTInfosTab";
import FTDescriptionTab from "./FTDescriptionTab";
import FTCroquisTab from "./FTCroquisTab";
import FTMesuresTab from "./FTMesuresTab";
import FTMatieresTab from "./FTMatieresTab";
import FTFournituresTab from "./FTFournituresTab";
import FTApercuTab from "./FTApercuTab";

interface Props {
  article: Article;
  onBack: () => void;
}

// L'onglet « Documents » a été retiré : il n'affichait qu'un texte d'attente et ne reposait sur
// aucune table ni aucun canal IPC — vérifié avant suppression, rien n'en dépendait. Les pièces
// jointes externes (patronages, certificats, rapports) trouveront leur place dans les
// Informations générales le jour venu.
type Onglet = "infos" | "description" | "croquis" | "mesures" | "matieres" | "fournitures" | "apercu";

// Libellés des statuts de commande dans la fenêtre de confirmation. Afficher la valeur brute
// de la base — « validee », « controle_qualite » — donnerait un texte d'informaticien là où
// l'utilisateur attend le vocabulaire de son atelier.
const STATUT_COMMANDE: Record<string, string> = {
  validee: "validée",
  en_production: "en production",
  controle_qualite: "en contrôle qualité",
  terminee: "terminée",
};

const ONGLETS: { id: Onglet; label: string; icon: string }[] = [
  { id: "infos", label: "Informations générales", icon: "note" },
  { id: "description", label: "Description technique", icon: "note" },
  { id: "croquis", label: "Croquis et annotations", icon: "photo" },
  { id: "mesures", label: "Tableau des mesures", icon: "list-check" },
  { id: "matieres", label: "Matières", icon: "list-check" },
  // L'identifiant d'onglet reste "fournitures" : c'est une clé interne, elle ne s'affiche nulle
  // part. Seul le libellé change — la section s'appelle désormais Nomenclature.
  { id: "fournitures", label: "Nomenclature", icon: "plus" },
  { id: "apercu", label: "Aperçu / Impression", icon: "print" },
];

// Barre d'onglets : une seule ligne tant que la largeur le permet, défilement horizontal discret
// ensuite. Le choix structurant est `flex-wrap: nowrap` associé à `overflow-x: auto` — c'est ce
// qui empêche « Aperçu / Impression » de retomber seul sur une deuxième ligne. La taille de
// police ne bouge jamais : un libellé illisible serait un plus mauvais compromis qu'un
// défilement. Les règles sont portées par `.ft-page` pour ne rien changer ailleurs dans l'ERP.
const STYLES_ONGLETS = `
.ft-page .ft-tabs {
  display: flex; flex-wrap: nowrap; gap: 4px; overflow-x: auto; overflow-y: hidden;
  scrollbar-width: thin; -webkit-overflow-scrolling: touch;
  padding-bottom: 2px; scroll-padding-inline: 24px;
}
.ft-page .ft-tabs::-webkit-scrollbar { height: 5px; }
.ft-page .ft-tabs::-webkit-scrollbar-thumb { background: #D2D5CA; border-radius: 3px; }
.ft-page .ft-tabs::-webkit-scrollbar-track { background: transparent; }
.ft-page .ft-tab {
  flex: 0 0 auto; white-space: nowrap; display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 14px; line-height: 1.2;
}
/* Onglet actif : un trait plein sous le libellé plutôt qu'une simple nuance de gris — il se
   repère d'un coup d'œil, même sur un écran d'atelier mal calibré. */
.ft-page .ft-tab.active { box-shadow: inset 0 -2.5px 0 0 var(--v2-accent, #0E9F6E); font-weight: 650; }

/* Révisions. L'historique doit être consultable sans encombrer : un lien discret à côté du
   badge, et un panneau qui ne s'ouvre que si on le demande. */
.ft-page .ft-revision { font-size: 11.5px; color: var(--v2-text-3, #8A8A82); margin-left: 8px; }
.ft-page .ft-revision-lien {
  background: none; border: none; padding: 0; margin-left: 8px; cursor: pointer;
  font-size: 11.5px; color: var(--v2-text-2, #5B5C52); text-decoration: underline;
  text-decoration-color: #C9CBBE; font-family: inherit;
}
.ft-page .ft-revision-lien:hover { color: var(--v2-green-dark, #1F5F5B); text-decoration-color: currentColor; }
.ft-page .ft-revisions-panneau {
  border: 1px solid #E0E2DA; border-radius: 9px; background: #FAFBF7;
  padding: 12px 14px; margin-bottom: 16px; font-size: 12.5px;
}
.ft-page .ft-revisions-panneau table { width: 100%; border-collapse: collapse; background: none;
  border: none; box-shadow: none; }
.ft-page .ft-revisions-panneau td, .ft-page .ft-revisions-panneau th {
  padding: 5px 8px; text-align: left; border-bottom: 1px solid #E8EAE2; font-size: 12px;
}
.ft-page .ft-revisions-panneau th { color: var(--v2-text-3, #8A8A82); font-weight: 600; }

.ft-page .ft-confirm-fond {
  position: fixed; inset: 0; background: rgba(20,22,18,.42); display: flex;
  align-items: center; justify-content: center; z-index: 200; padding: 20px;
}
.ft-page .ft-confirm {
  background: #fff; border-radius: 12px; padding: 22px 24px; max-width: 540px; width: 100%;
  box-shadow: 0 12px 40px rgba(0,0,0,.22);
}
.ft-page .ft-confirm h3 { margin: 0 0 10px; font-size: 16px; }
.ft-page .ft-confirm p { font-size: 13px; line-height: 1.55; margin: 0 0 10px; color: #3A3B33; }
.ft-page .ft-confirm ul { font-size: 12.5px; margin: 0 0 10px; padding-left: 20px; color: #3A3B33; }
.ft-page .ft-confirm input {
  width: 100%; height: 34px; border: 1px solid #D8D9D0; border-radius: 6px;
  padding: 0 9px; font-size: 13px; font-family: inherit;
}
`;

export default function FicheTechniquePage({ article, onBack }: Props) {
  const [fiche, setFiche] = useState<FicheTechnique | null>(null);
  const [loading, setLoading] = useState(true);
  const [onglet, setOnglet] = useState<Onglet>("infos");
  const [confirmValider, setConfirmValider] = useState(false);
  // Révisions : l'aperçu annonce ce que la réouverture va protéger, le panneau montre l'historique.
  const [apercuModif, setApercuModif] = useState<any | null>(null);
  const [motifModif, setMotifModif] = useState("");
  const [revisions, setRevisions] = useState<any[] | null>(null);
  const [panneauRevisions, setPanneauRevisions] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    const base = await window.api.ficheTechnique.getOrCreateByArticleId(article.id);
    const complete = await window.api.ficheTechnique.get(base.id);
    setFiche(complete);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [article.id]);

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 3200); }

  /**
   * Ouvre la confirmation de « Modifier la nomenclature ». On demande d'abord au processus
   * principal CE QUE l'opération va faire : on ne fait pas approuver une action dont on ne dit
   * pas la portée. Cet aperçu ne modifie rien.
   */
  async function demanderModification() {
    if (!fiche) return;
    setError(null);
    try {
      const a = await window.api.ficheTechnique.apercuModification(fiche.id);
      setMotifModif("");
      setApercuModif(a);
    } catch (err: any) {
      setError(err?.message || "Impossible de préparer la modification.");
    }
  }

  async function confirmerModification() {
    if (!fiche) return;
    setBusy(true);
    setError(null);
    try {
      const r = await window.api.ficheTechnique.rouvrirPourModification(fiche.id, {
        motif: motifModif.trim() || null,
      });
      setApercuModif(null);
      setRevisions(null);
      await refresh();
      const n = r.productions_protegees.length;
      notify(
        n > 0
          ? `Nomenclature modifiable. ${n} production${n > 1 ? "s" : ""} conserve${n > 1 ? "nt" : ""} ${n > 1 ? "leur" : "sa"} nomenclature actuelle.`
          : "Nomenclature modifiable. Aucune production en cours à protéger."
      );
    } catch (err: any) {
      setError(err?.message || "La modification n'a pas pu être ouverte.");
    } finally {
      setBusy(false);
    }
  }

  async function basculerPanneauRevisions() {
    if (!fiche) return;
    if (panneauRevisions) { setPanneauRevisions(false); return; }
    try {
      setRevisions(await window.api.ficheTechnique.listRevisions(fiche.id));
      setPanneauRevisions(true);
    } catch (err: any) {
      setError(err?.message || "Historique indisponible.");
    }
  }

  async function handleValider() {
    if (!fiche) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.ficheTechnique.validerFiche(fiche.id);
      setConfirmValider(false);
      await refresh();
      notify("Fiche technique validée.");
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la validation.");
    } finally {
      setBusy(false);
    }
  }

  if (loading || !fiche) {
    return <div className="empty-state">Chargement...</div>;
  }

  const lecture_seule = fiche.statut !== "brouillon";

  return (
    <div className="ft-page">
      <style>{STYLES_ONGLETS}</style>
      <button className="ft-back-link" onClick={onBack}>
        <Icon name="arrow-left" size={15} /> Fiches techniques
      </button>

      <div className="topline">
        <div>
          <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {article.produit} — {article.reference_principale ?? "réf. à compléter"}
            <span className={`v2-badge ${fiche.statut === "validee" ? "v2-badge-validee" : fiche.statut === "archivee" ? "v2-badge-archivee" : "v2-badge-brouillon"}`}>
              {fiche.statut === "brouillon" ? "Brouillon" : fiche.statut === "validee" ? "Validée" : "Archivée"}
              {fiche.statut === "validee" && fiche.revision ? ` — V${fiche.revision}` : ""}
            </span>
          </div>
          <div className="page-sub">
            Fiche technique produit — bureau d'études
            {fiche.statut === "brouillon" && (fiche.revision ?? 1) > 1 && (
              <span className="ft-revision">
                modification de la V{fiche.revision} en cours
                {fiche.revision_motif ? ` — ${fiche.revision_motif}` : ""}
              </span>
            )}
            <button className="ft-revision-lien" onClick={basculerPanneauRevisions}>
              {panneauRevisions ? "Masquer l'historique" : "Historique des révisions"}
            </button>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {fiche.statut === "brouillon" && (
            <button className="btn primary" onClick={() => setConfirmValider(true)}>Valider la fiche technique</button>
          )}
          {fiche.statut === "validee" && (
            <button className="btn primary" onClick={demanderModification}>Modifier la nomenclature</button>
          )}
          {fiche.statut === "validee" && (
            <button className="btn ghost" onClick={async () => { await window.api.ficheTechnique.archiverFiche(fiche.id); await refresh(); notify("Fiche archivée."); }}>
              Archiver
            </button>
          )}
        </div>
      </div>

      {panneauRevisions && (
        <div className="ft-revisions-panneau">
          {!revisions || revisions.length === 0 ? (
            <span style={{ color: "var(--v2-text-3)" }}>
              Aucune révision archivée : cette fiche n'a jamais été rouverte pour modification.
            </span>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Version</th>
                  <th>Validée le</th>
                  <th>Archivée le</th>
                  <th>Motif de la modification</th>
                  <th>Productions protégées</th>
                </tr>
              </thead>
              <tbody>
                {revisions.map((r) => (
                  <tr key={r.id}>
                    <td><strong>V{r.revision}</strong></td>
                    <td>{(r.validated_at || "—").slice(0, 10)}</td>
                    <td>{(r.archivee_le || "—").slice(0, 10)}</td>
                    <td>{r.motif || "—"}</td>
                    <td>{r.productions_figees}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {apercuModif && (
        <div className="ft-confirm-fond" onClick={() => !busy && setApercuModif(null)}>
          <div className="ft-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Modifier la nomenclature</h3>
            <p>
              La fiche va redevenir modifiable : matières, fournitures, consommations, pertes,
              tailles et coloris. Vous la revaliderez ensuite, et elle deviendra la{" "}
              <strong>V{apercuModif.revision + 1}</strong>.
            </p>
            {apercuModif.productions_a_proteger.length > 0 ? (
              <>
                <p>
                  <strong>
                    {apercuModif.productions_a_proteger.length} production
                    {apercuModif.productions_a_proteger.length > 1 ? "s" : ""} en cours
                  </strong>{" "}
                  conserveront la nomenclature actuelle (V{apercuModif.revision}). Vos
                  modifications ne s'appliqueront qu'aux productions suivantes.
                </p>
                <ul>
                  {apercuModif.productions_a_proteger.slice(0, 8).map((c: any) => (
                    <li key={c.id}>{c.numero || `commande ${c.id}`} — {STATUT_COMMANDE[c.statut] || c.statut}</li>
                  ))}
                  {apercuModif.productions_a_proteger.length > 8 && (
                    <li>… et {apercuModif.productions_a_proteger.length - 8} autres</li>
                  )}
                </ul>
              </>
            ) : (
              <p>Aucune production en cours sur cet article : rien à protéger.</p>
            )}
            {apercuModif.productions_deja_protegees > 0 && (
              <p style={{ color: "var(--v2-text-3)", fontSize: 12 }}>
                {apercuModif.productions_deja_protegees} production(s) conservent déjà une
                nomenclature figée d'une révision précédente.
              </p>
            )}
            <label style={{ fontSize: 12, color: "var(--v2-text-3)", display: "block", marginBottom: 4 }}>
              Motif (facultatif, conservé dans l'historique)
            </label>
            <input
              value={motifModif}
              onChange={(e) => setMotifModif(e.target.value)}
              placeholder="Correction de la consommation du tissu principal"
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14 }}>
              <button className="btn ghost" onClick={() => setApercuModif(null)} disabled={busy}>Annuler</button>
              <button className="btn primary" onClick={confirmerModification} disabled={busy}>
                {busy ? "En cours…" : "Rendre la nomenclature modifiable"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="ft-tabs" role="tablist" aria-label="Sections de la fiche technique">
        {ONGLETS.map((o) => (
          <button
            key={o.id}
            role="tab"
            aria-selected={onglet === o.id}
            className={`ft-tab ${onglet === o.id ? "active" : ""}`}
            onClick={() => setOnglet(o.id)}
          >
            <Icon name={o.icon} size={15} /> {o.label}
          </button>
        ))}
      </div>

      <div className="ft-tab-body ft-tab-body-page">
        {onglet === "infos" && <FTInfosTab fiche={fiche} article={article} lectureSeule={lecture_seule} onChanged={refresh} />}
        {onglet === "description" && <FTDescriptionTab fiche={fiche} lectureSeule={lecture_seule} onChanged={refresh} />}
        {onglet === "croquis" && <FTCroquisTab fiche={fiche} lectureSeule={lecture_seule} onChanged={refresh} />}
        {onglet === "mesures" && <FTMesuresTab fiche={fiche} article={article} lectureSeule={lecture_seule} onChanged={refresh} />}
        {onglet === "matieres" && <FTMatieresTab fiche={fiche} article={article} lectureSeule={lecture_seule} onChanged={refresh} />}
        {onglet === "fournitures" && <FTFournituresTab fiche={fiche} article={article} lectureSeule={lecture_seule} onChanged={refresh} />}
        {onglet === "apercu" && <FTApercuTab fiche={fiche} article={article} />}
      </div>

      {error && <p className="no-print" style={{ background: "var(--v2-danger-bg)", color: "var(--v2-danger)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 12 }}>{error}</p>}
      {toast && <div className="toast no-print">{toast}</div>}

      {confirmValider && (
        <div className="modal-veil">
          <div className="modal small">
            <div className="modal-head"><h3>Valider la fiche technique ?</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              Une fois validée, la fiche ne pourra plus être modifiée dans cette version — croquis, mesures, matières et nomenclature seront figés.
              Elle restera consultable et imprimable à tout moment.
            </p>
            {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmValider(false)} disabled={busy}>Annuler</button>
              <button className="btn primary" onClick={handleValider} disabled={busy}>Confirmer la validation</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
