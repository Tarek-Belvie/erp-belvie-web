import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BcPf, BC_STATUT_LABELS, Commande, Entreprise, TYPE_PRODUCTION_LABELS } from "../../shared/types";
import { mediaUrl, fmtDateTime } from "../commandes/uiHelpers";
import Icon from "../../shared/Icon";
import BcPfRepartitionTable from "./BcPfRepartitionTable";

function typeDocumentLabel(numero: string): string {
  return numero && numero.startsWith("MP-") ? "Matières premières (MP)" : "Produits finis (PF)";
}

function badgeLancement(typeProduction: string | null): { label: string; couleur: string } | null {
  if (typeProduction === "nouveau") return { label: "Lancement de production", couleur: "#1F4B3C" };
  if (typeProduction === "reassort") return { label: "Réassort", couleur: "#4B4B43" };
  return null;
}

interface Props {
  bcPfId: number;
  onClose: () => void;
  onChanged?: () => void;
  autoPrint?: boolean;
  autoDownloadPdf?: boolean;
}

export default function BcPfDetailModal({ bcPfId, onClose, onChanged, autoPrint, autoDownloadPdf }: Props) {
  const [currentId, setCurrentId] = useState(bcPfId);
  const [bc, setBc] = useState<BcPf | null>(null);
  const [commande, setCommande] = useState<Commande | null>(null);
  const [entreprise, setEntreprise] = useState<Entreprise | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [notesAtelier, setNotesAtelier] = useState("");
  const [observations, setObservations] = useState("");
  const [showRemplacer, setShowRemplacer] = useState(false);
  const [motifRemplacement, setMotifRemplacement] = useState("");

  async function refresh() {
    const b = await window.api.bcPf.get(currentId);
    setBc(b);
    if (b) {
      const c = await window.api.commandes.get(b.commande_id);
      setCommande(c);
      setNotesAtelier(b.notes_atelier ?? "");
      setObservations(b.observations_internes ?? "");
    }
    setLoading(false);
    onChanged?.();
  }
  useEffect(() => { refresh(); }, [currentId]);
  useEffect(() => { window.api.entreprise.get().then(setEntreprise); }, []);

  const autoPrintedRef = useRef(false);
  useEffect(() => { autoPrintedRef.current = false; }, [currentId]);
  useEffect(() => {
    if (!autoPrint || loading || !bc || autoPrintedRef.current) return;
    autoPrintedRef.current = true;
    requestAnimationFrame(() => window.print());
  }, [autoPrint, loading, bc]);

  const autoDownloadedRef = useRef(false);
  useEffect(() => { autoDownloadedRef.current = false; }, [currentId]);
  useEffect(() => {
    if (!autoDownloadPdf || loading || !bc || autoDownloadedRef.current) return;
    autoDownloadedRef.current = true;
    requestAnimationFrame(() => { handleTelechargerPdf(); });
  }, [autoDownloadPdf, loading, bc]);

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function run(action: () => Promise<void>, successMsg?: string) {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (successMsg) notify(successMsg);
    } catch (err: any) {
      setError(err?.message || "Une erreur est survenue.");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnregistrer() {
    if (!bc) return;
    await run(async () => {
      const updated = await window.api.bcPf.update(bc.id, { notes_atelier: notesAtelier || null, observations_internes: observations || null });
      setBc(updated);
    }, "Enregistré.");
  }

  async function handleMettreAJour() {
    if (!bc) return;
    await run(async () => {
      const updated = await window.api.bcPf.mettreAJourDepuisCommande(bc.id);
      setBc(updated);
      setNotesAtelier(updated.notes_atelier ?? "");
      setObservations(updated.observations_internes ?? "");
      const c = await window.api.commandes.get(updated.commande_id);
      setCommande(c);
    }, "Bon de commande synchronisé avec la commande.");
  }

  async function handleValider() {
    if (!bc) return;
    await run(async () => {
      // Enregistre d'abord toute note/observation en cours de frappe — sans ça, un texte tapé
      // juste avant de valider était perdu silencieusement (le champ de saisie disparaît une fois
      // le document validé, sans aucun moyen de le récupérer ensuite).
      const aChange = notesAtelier !== (bc.notes_atelier ?? "") || observations !== (bc.observations_internes ?? "");
      if (aChange) {
        await window.api.bcPf.update(bc.id, { notes_atelier: notesAtelier || null, observations_internes: observations || null });
      }
      setBc(await window.api.bcPf.valider(bc.id));
    }, "Bon de commande validé.");
  }

  async function handleLancer() {
    if (!bc) return;
    await run(async () => { setBc(await window.api.bcPf.lancer(bc.id)); }, "Bon de commande lancé.");
  }

  async function handleConfirmerRemplacement() {
    if (!bc) return;
    if (!motifRemplacement.trim()) {
      setError("Le motif du remplacement est obligatoire.");
      return;
    }
    await run(async () => {
      const nouveau = await window.api.bcPf.remplacer(bc.id, motifRemplacement);
      setShowRemplacer(false);
      setMotifRemplacement("");
      setCurrentId(nouveau.id);
    }, "BC de remplacement créé.");
  }

  function handleImprimer() { window.print(); }

  async function handleTelechargerPdf() {
    await run(async () => {
      const suggested = `${bc?.numero || "bon-de-commande"}.pdf`;
      const result = await window.api.bcPf.telechargerPdf(currentId, suggested);
      if ("filePath" in result) notify(`PDF enregistré : ${result.filePath}`);
    });
  }

  if (loading || !bc) {
    return createPortal(
      <div className="modal-veil">
        <div className="modal wide"><p style={{ color: "var(--v2-text-3)" }}>Chargement...</p></div>
      </div>,
      document.body
    );
  }

  const estObsolete = bc.statut === "brouillon" && !!commande && !!bc.commande_synced_at && commande.updated_at > bc.commande_synced_at;
  const quantiteTotale = (bc.lignes ?? []).reduce((s, l) => s + l.quantite, 0);

  return createPortal(
    <div className="modal-veil">
      <div className="modal wide bcpf-viewer-modal" style={{ fontFamily: "var(--v2-font)" }}>
        <div className="modal-head">
          <h3 style={{ fontFamily: "inherit" }}>Bon de commande {bc.numero}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>
        </div>

        {bc.remplace_qui && (
          <p className="no-print" style={{ background: "var(--v2-page-bg)", border: "1px solid var(--v2-border)", padding: "9px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Ce document remplace <strong>{bc.remplace_qui.numero}</strong> ({BC_STATUT_LABELS[bc.remplace_qui.statut]}).</span>
            <button className="v2-btn ghost" onClick={() => setCurrentId(bc.remplace_qui!.id)}>Consulter l'ancien document</button>
          </p>
        )}
        {bc.remplace_par && (
          <p className="no-print" style={{ background: "var(--v2-warning-bg)", color: "var(--v2-warning)", padding: "9px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span><Icon name="alert-triangle" /> Ce document a été remplacé par <strong>{bc.remplace_par.numero}</strong>.</span>
            <button className="v2-btn primary" onClick={() => setCurrentId(bc.remplace_par!.id)}>Consulter le document actif</button>
          </p>
        )}
        {estObsolete && (
          <p className="no-print" style={{ background: "var(--v2-warning-bg)", color: "var(--v2-warning)", padding: "9px 14px", borderRadius: 8, fontSize: 12.5, marginBottom: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span><Icon name="alert-triangle" /> La commande a été modifiée depuis la dernière synchronisation.</span>
            <button className="v2-btn primary" onClick={handleMettreAJour} disabled={busy}>Synchroniser avec la commande</button>
          </p>
        )}

        <div id="bc-pf-print-area">
          <div className="bcpf-doc">
            {bc.statut === "brouillon" && <div className="bcpf-doc-brouillon-tag">BROUILLON</div>}

            <div className="bcpf-doc-header-fixed">
              <div>
                {bc.entreprise_logo_snapshot_path ? (
                  <img src={mediaUrl(bc.entreprise_logo_snapshot_path)!} alt="Belvie" className="bcpf-doc-logo" />
                ) : (
                  <div className="bcpf-doc-brand">Belvie</div>
                )}
                <p className="bcpf-doc-titre">Bon de commande</p>
                {badgeLancement(bc.type_production) && (
                  <div className="bcpf-doc-badge-lancement" style={{ color: badgeLancement(bc.type_production)!.couleur }}>
                    {badgeLancement(bc.type_production)!.label}
                  </div>
                )}
                <p className="bcpf-doc-sous-titre">{typeDocumentLabel(bc.numero)}</p>
                <p className="bcpf-doc-numero-titre">N° {bc.numero}</p>
              </div>
              <div className="bcpf-doc-info-list">
                <div><span>Commande</span><strong>{bc.commande_numero}</strong></div>
                <div><span>Date</span><strong>{fmtDateTime(bc.created_at).split(" ")[0]}</strong></div>
                <div><span>Date limite</span><strong>{bc.date_limite_production || "—"}</strong></div>
                <div><span>Statut</span><strong>{BC_STATUT_LABELS[bc.statut] || bc.statut}</strong></div>
                <div><span>Priorité</span><strong>{bc.priorite || "—"}</strong></div>
              </div>
            </div>

            {entreprise && (entreprise.raison_sociale || entreprise.telephone || entreprise.email || entreprise.matricule_fiscal) && (
              <div className="bcpf-doc-footer-fixed">
                {entreprise.raison_sociale && (
                  <div className="name">
                    {[entreprise.raison_sociale, [entreprise.adresse, [entreprise.code_postal, entreprise.ville].filter(Boolean).join(" "), entreprise.pays].filter(Boolean).join(", ")].filter(Boolean).join(" • ")}
                  </div>
                )}
                {(entreprise.telephone || entreprise.email || entreprise.matricule_fiscal) && (
                  <div>{[entreprise.telephone, entreprise.email, entreprise.matricule_fiscal && `MF : ${entreprise.matricule_fiscal}`].filter(Boolean).join(" • ")}</div>
                )}
              </div>
            )}

            <div className="bcpf-doc-content">
              <div className="bcpf-doc-destinataire">
                <div className="bcpf-doc-section-title">Destinataire</div>
                <div className="bcpf-doc-destinataire-grid">
                  <div><div className="bcpf-doc-field-k">Atelier</div><div className="bcpf-doc-field-v">{bc.atelier_nom || "—"}</div></div>
                  <div><div className="bcpf-doc-field-k">Responsable</div><div className="bcpf-doc-field-v">{bc.responsable_nom || "—"}</div></div>
                  <div><div className="bcpf-doc-field-k">Téléphone</div><div className="bcpf-doc-field-v">—</div></div>
                  <div><div className="bcpf-doc-field-k">Adresse</div><div className="bcpf-doc-field-v">—</div></div>
                </div>
              </div>

              <div className="bcpf-doc-article">
                <div className="bcpf-doc-photo">
                  {bc.photo_snapshot_path ? (
                    <img src={mediaUrl(bc.photo_snapshot_path)!} alt="" />
                  ) : (
                    <span className="bcpf-doc-photo-empty">Aucune image</span>
                  )}
                </div>
                <div className="bcpf-doc-article-info">
                  <div className="bcpf-doc-article-title">{bc.article_nom}</div>
                  <span className="bcpf-doc-article-ref">{bc.article_reference}</span>
                  <div className="bcpf-doc-field-grid">
                    <div><div className="bcpf-doc-field-k">Type</div><div className="bcpf-doc-field-v">{bc.type_production ? TYPE_PRODUCTION_LABELS[bc.type_production] : "—"}</div></div>
                    <div><div className="bcpf-doc-field-k">Saison</div><div className="bcpf-doc-field-v">{bc.saison_nom || "—"}</div></div>
                  </div>
                </div>
              </div>

              <div className="bcpf-doc-resume">
                <div className="bcpf-doc-resume-item"><span>Nombre de couleurs</span><strong>{new Set((bc.lignes ?? []).map((l) => l.couleur_nom)).size}</strong></div>
                <div className="bcpf-doc-resume-item"><span>Nombre de tailles</span><strong>{new Set((bc.lignes ?? []).filter((l) => l.taille_nom != null).map((l) => l.taille_nom)).size || "—"}</strong></div>
                <div className="bcpf-doc-resume-item"><span>Quantité totale</span><strong className="accent">{quantiteTotale} pièces</strong></div>
              </div>

              <div className="bcpf-doc-section-title">Répartition</div>
              <div className="bcpf-doc-table-wrap">
                <BcPfRepartitionTable lignes={(bc.lignes ?? []).map((l) => ({ couleur_id: 0, couleur: l.couleur_nom, couleur_reference: l.couleur_reference, taille_id: null, taille: l.taille_nom, quantite: l.quantite }))} docMode />
              </div>

              <div className="bcpf-doc-notes">
                <div className="bcpf-doc-notes-label">Notes / instructions (atelier)</div>
                <div className="bcpf-doc-notes-text">{bc.notes_atelier || "—"}</div>
              </div>
            </div>
          </div>
        </div>

        {bc.statut === "brouillon" && (
          <div className="v2-card-grid no-print" style={{ marginTop: 16 }}>
            <div className="v2-info-card" style={{ gridColumn: "span 2" }}>
              <label>Notes / instructions (atelier) — modifiable</label>
              <textarea rows={2} value={notesAtelier} onChange={(e) => setNotesAtelier(e.target.value)} />
            </div>
            <div className="v2-info-card" style={{ gridColumn: "span 2" }}>
              <label>Observations internes (jamais imprimées)</label>
              <textarea rows={2} value={observations} onChange={(e) => setObservations(e.target.value)} />
            </div>
          </div>
        )}
        {bc.statut !== "brouillon" && bc.observations_internes && (
          <div className="v2-info-card no-print" style={{ marginTop: 12 }}>
            <label>Observations internes (jamais imprimées)</label>
            <p style={{ fontSize: 13, margin: "4px 0 0" }}>{bc.observations_internes}</p>
          </div>
        )}

        {error && <p className="no-print" style={{ background: "var(--v2-danger-bg)", color: "var(--v2-danger)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 16 }}>{error}</p>}

        <div className="modal-actions no-print" style={{ marginTop: 20, flexWrap: "wrap" }}>
          <button className="btn ghost" onClick={onClose} disabled={busy}>Fermer</button>
          <button className="btn ghost" onClick={handleImprimer} disabled={busy}>Imprimer{bc.statut === "brouillon" ? " (brouillon)" : ""}</button>
          <button className="btn ghost" onClick={handleTelechargerPdf} disabled={busy}>Télécharger en PDF</button>

          {bc.statut === "brouillon" && (
            <>
              {estObsolete && <button className="btn ghost" onClick={handleMettreAJour} disabled={busy}>Synchroniser avec la commande</button>}
              <button className="btn ghost" onClick={handleEnregistrer} disabled={busy}>Enregistrer</button>
              <button className="btn primary" onClick={handleValider} disabled={busy}>Valider le BC</button>
            </>
          )}
          {bc.statut === "valide" && (
            <>
              <button className="btn ghost" onClick={() => setShowRemplacer(true)} disabled={busy}>Créer un BC de remplacement</button>
              <button className="btn primary" onClick={handleLancer} disabled={busy}>Lancer le BC</button>
            </>
          )}
          {bc.statut === "lance" && (
            <button className="btn primary" onClick={() => setShowRemplacer(true)} disabled={busy}>Créer un BC de remplacement</button>
          )}
        </div>

        {toast && <div className="toast no-print">{toast}</div>}
      </div>

      {showRemplacer && (
        <div className="modal-veil" style={{ zIndex: 60 }}>
          <div className="modal small">
            <div className="modal-head"><h3>Créer un BC de remplacement</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              Le BC actuel sera marqué comme remplacé. Un nouveau BC portant un nouveau numéro sera créé en brouillon et devra être validé puis lancé.
            </p>
            <textarea
              rows={3} style={{ width: "100%", fontFamily: "inherit" }}
              value={motifRemplacement} onChange={(e) => setMotifRemplacement(e.target.value)}
              placeholder="Motif du remplacement (obligatoire) — ex : erreur de quantité constatée à l'atelier"
              autoFocus
            />
            {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginTop: 6 }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => { setShowRemplacer(false); setMotifRemplacement(""); setError(null); }} disabled={busy}>Annuler</button>
              <button className="btn primary" onClick={handleConfirmerRemplacement} disabled={busy || !motifRemplacement.trim()}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>,
    document.body
  );
}
