import { useRef, useState } from "react";
import { FicheTechnique, FTAnnotation, FTCroquis, FTVue, FT_VUE_LABELS } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";
import Icon from "../../shared/Icon";

interface Props {
  fiche: FicheTechnique;
  lectureSeule: boolean;
  onChanged: () => void;
}

type PendingPoint = { x: number; y: number } | null;

export default function FTCroquisTab({ fiche, lectureSeule, onChanged }: Props) {
  const croquisList = fiche.croquis ?? [];
  const [activeCroquisId, setActiveCroquisId] = useState<number | null>(croquisList[0]?.id ?? null);
  const [showImport, setShowImport] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [pendingAnchor, setPendingAnchor] = useState<PendingPoint>(null);
  const [pendingLabel, setPendingLabel] = useState<PendingPoint>(null);
  const [draftTexte, setDraftTexte] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingTexte, setEditingTexte] = useState("");
  const [error, setError] = useState<string | null>(null);
  const imageBoxRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ annotationId: number; point: "ancre" | "label" } | null>(null);

  const active = croquisList.find((c) => c.id === activeCroquisId) || null;

  function notifyErr(msg: string) { setError(msg); setTimeout(() => setError(null), 3500); }

  function relativeCoords(e: React.MouseEvent): { x: number; y: number } | null {
    const box = imageBoxRef.current;
    if (!box) return null;
    const rect = box.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return { x, y };
  }

  function handleImageClick(e: React.MouseEvent) {
    if (lectureSeule || !active || dragRef.current) return;
    const p = relativeCoords(e);
    if (!p) return;
    if (!pendingAnchor) {
      setPendingAnchor(p);
    } else if (!pendingLabel) {
      setPendingLabel(p);
      setDraftTexte("");
    }
  }

  async function handleConfirmAnnotation() {
    if (!active || !pendingAnchor || !pendingLabel) return;
    if (!draftTexte.trim()) { notifyErr("Le texte de l'annotation est obligatoire."); return; }
    try {
      await window.api.ficheTechnique.addAnnotation(active.id, {
        ancre_x: pendingAnchor.x, ancre_y: pendingAnchor.y,
        label_x: pendingLabel.x, label_y: pendingLabel.y,
        texte: draftTexte.trim(),
      });
      setPendingAnchor(null);
      setPendingLabel(null);
      setDraftTexte("");
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur lors de l'ajout de l'annotation.");
    }
  }

  function cancelPending() {
    setPendingAnchor(null);
    setPendingLabel(null);
    setDraftTexte("");
  }

  function startDrag(annotationId: number, point: "ancre" | "label") {
    if (lectureSeule) return;
    dragRef.current = { annotationId, point };
    window.addEventListener("mousemove", handleDragMove);
    window.addEventListener("mouseup", handleDragEnd);
  }

  function handleDragMove(e: MouseEvent) {
    const drag = dragRef.current;
    const box = imageBoxRef.current;
    if (!drag || !box || !active) return;
    const rect = box.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const ann = active.annotations.find((a) => a.id === drag.annotationId);
    if (!ann) return;
    if (drag.point === "ancre") { ann.ancre_x = x; ann.ancre_y = y; } else { ann.label_x = x; ann.label_y = y; }
    // force un re-render léger en touchant le state zoom (évite de dupliquer tout l'état des annotations)
    setZoom((z) => z);
  }

  async function handleDragEnd() {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener("mousemove", handleDragMove);
    window.removeEventListener("mouseup", handleDragEnd);
    if (!drag || !active) return;
    const ann = active.annotations.find((a) => a.id === drag.annotationId);
    if (!ann) return;
    try {
      await window.api.ficheTechnique.updateAnnotation(ann.id, {
        ancre_x: ann.ancre_x, ancre_y: ann.ancre_y, label_x: ann.label_x, label_y: ann.label_y,
      });
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur lors du déplacement.");
    }
  }

  async function handleSaveEdit(ann: FTAnnotation) {
    if (!editingTexte.trim()) { notifyErr("Le texte de l'annotation est obligatoire."); return; }
    try {
      await window.api.ficheTechnique.updateAnnotation(ann.id, { texte: editingTexte.trim() });
      setEditingId(null);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur lors de la modification.");
    }
  }

  async function handleDeleteAnnotation(id: number) {
    await window.api.ficheTechnique.deleteAnnotation(id);
    onChanged();
  }

  async function handleDeleteCroquis(id: number) {
    await window.api.ficheTechnique.deleteCroquis(id);
    if (activeCroquisId === id) setActiveCroquisId(null);
    onChanged();
  }

  return (
    <div style={{ display: "flex", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
          {croquisList.map((c) => (
            <button
              key={c.id} className={`btn ghost tiny ${activeCroquisId === c.id ? "ft-vue-active" : ""}`}
              onClick={() => { setActiveCroquisId(c.id); cancelPending(); }}
            >
              {FT_VUE_LABELS[c.vue]}{c.vue === "autre" && c.vue_personnalisee ? ` — ${c.vue_personnalisee}` : ""}
            </button>
          ))}
          {!lectureSeule && <button className="btn ghost tiny" onClick={() => setShowImport(true)}><Icon name="plus" size={13} /> Importer un croquis</button>}
        </div>

        {!active ? (
          <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>Aucun croquis importé pour l'instant.</p>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>
                {lectureSeule ? "Consultation seule." : pendingAnchor && !pendingLabel ? "Cliquez où positionner le texte de l'annotation." : pendingAnchor ? "" : "Cliquez sur le croquis pour placer un point d'ancrage."}
              </span>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <button className="btn ghost tiny" onClick={() => setZoom((z) => Math.max(0.5, z - 0.25))}>−</button>
                <span style={{ fontSize: 12, width: 40, textAlign: "center" }}>{Math.round(zoom * 100)}%</span>
                <button className="btn ghost tiny" onClick={() => setZoom((z) => Math.min(3, z + 0.25))}>+</button>
                {!lectureSeule && <button className="btn ghost tiny" onClick={() => handleDeleteCroquis(active.id)}>Supprimer ce croquis</button>}
              </div>
            </div>

            <div style={{ overflow: "auto", border: "1px solid #E7E9E0", borderRadius: 10, background: "#FAFAF8", maxHeight: 640 }}>
              <div style={{ width: `${zoom * 100}%`, minWidth: 300 }}>
                <div
                  ref={imageBoxRef}
                  onClick={handleImageClick}
                  style={{ position: "relative", width: "100%", cursor: lectureSeule ? "default" : "crosshair", userSelect: "none" }}
                >
                  <img src={mediaUrl(active.image_path)!} alt="" style={{ width: "100%", display: "block", pointerEvents: "none" }} draggable={false} />
                  <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}>
                    {active.annotations.map((a) => (
                      <line key={a.id} x1={a.label_x * 100} y1={a.label_y * 100} x2={a.ancre_x * 100} y2={a.ancre_y * 100} stroke={a.couleur || "#1A1A1A"} strokeWidth={a.epaisseur || 1.5} vectorEffect="non-scaling-stroke" />
                    ))}
                    {pendingAnchor && pendingLabel && <line x1={pendingLabel.x * 100} y1={pendingLabel.y * 100} x2={pendingAnchor.x * 100} y2={pendingAnchor.y * 100} stroke="#0E9F6E" strokeDasharray="3,2" vectorEffect="non-scaling-stroke" />}
                  </svg>

                  {active.annotations.map((a) => (
                    <div key={a.id}>
                      <div
                        onMouseDown={(e) => { e.stopPropagation(); startDrag(a.id, "ancre"); }}
                        title="Glisser pour déplacer le point d'ancrage"
                        style={{ position: "absolute", left: `${a.ancre_x * 100}%`, top: `${a.ancre_y * 100}%`, width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: "50%", background: a.couleur || "#1A1A1A", border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.3)", cursor: lectureSeule ? "default" : "move" }}
                      />
                      <div
                        onMouseDown={(e) => { e.stopPropagation(); startDrag(a.id, "label"); }}
                        onClick={(e) => { e.stopPropagation(); if (!lectureSeule) { setEditingId(a.id); setEditingTexte(a.texte); } }}
                        style={{ position: "absolute", left: `${a.label_x * 100}%`, top: `${a.label_y * 100}%`, transform: "translate(-50%, -100%)", background: "#fff", border: `1px solid ${a.couleur || "#1A1A1A"}`, borderRadius: 5, padding: "2px 7px", fontSize: 11.5, whiteSpace: "nowrap", cursor: lectureSeule ? "default" : "move", boxShadow: "0 1px 3px rgba(0,0,0,.12)" }}
                      >
                        {a.texte}
                      </div>
                    </div>
                  ))}

                  {pendingAnchor && (
                    <div style={{ position: "absolute", left: `${pendingAnchor.x * 100}%`, top: `${pendingAnchor.y * 100}%`, width: 12, height: 12, marginLeft: -6, marginTop: -6, borderRadius: "50%", background: "#0E9F6E", border: "2px solid #fff", boxShadow: "0 0 0 1px #0E9F6E" }} />
                  )}
                  {pendingLabel && (
                    <div style={{ position: "absolute", left: `${pendingLabel.x * 100}%`, top: `${pendingLabel.y * 100}%`, width: 10, height: 10, marginLeft: -5, marginTop: -5, borderRadius: "50%", background: "#0E9F6E", opacity: 0.6 }} />
                  )}
                </div>
              </div>
            </div>

            {pendingAnchor && pendingLabel && (
              <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                <input
                  type="text" autoFocus value={draftTexte} onChange={(e) => setDraftTexte(e.target.value)}
                  placeholder="Texte de l'annotation (ex : Bord-côte 2x2)"
                  style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 9px", fontSize: 13 }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleConfirmAnnotation(); } if (e.key === "Escape") cancelPending(); }}
                />
                <button className="btn primary" onClick={handleConfirmAnnotation}>Ajouter</button>
                <button className="btn ghost" onClick={cancelPending}>Annuler</button>
              </div>
            )}
            {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginTop: 8 }}>{error}</p>}
          </>
        )}
      </div>

      {active && (
        <div style={{ width: 220, flexShrink: 0 }}>
          <p style={{ fontWeight: 600, fontSize: 12.5, margin: "0 0 8px", color: "#6B6B62", textTransform: "uppercase", letterSpacing: ".04em" }}>
            Annotations ({active.annotations.length})
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 460, overflowY: "auto" }}>
            {active.annotations.length === 0 && <p style={{ fontSize: 12, color: "var(--v2-text-3)" }}>Aucune annotation.</p>}
            {active.annotations.map((a) => (
              <div key={a.id} style={{ border: "1px solid #E7E9E0", borderRadius: 8, padding: "7px 9px" }}>
                {editingId === a.id ? (
                  <div style={{ display: "flex", gap: 4 }}>
                    <input
                      type="text" value={editingTexte} onChange={(e) => setEditingTexte(e.target.value)} autoFocus
                      style={{ flex: 1, fontSize: 12, border: "1px solid #D8D9D0", borderRadius: 5, padding: "3px 6px" }}
                      onKeyDown={(e) => { if (e.key === "Enter") handleSaveEdit(a); if (e.key === "Escape") setEditingId(null); }}
                    />
                    <button className="btn ghost tiny" onClick={() => handleSaveEdit(a)}>OK</button>
                  </div>
                ) : (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 12.5 }}>{a.texte}</span>
                    {!lectureSeule && (
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        <button className="btn ghost tiny" onClick={() => { setEditingId(a.id); setEditingTexte(a.texte); }}>✎</button>
                        <button className="btn ghost tiny" onClick={() => handleDeleteAnnotation(a.id)}>✕</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {showImport && (
        <ImportCroquisDialog
          ficheId={fiche.id}
          onClose={() => setShowImport(false)}
          onImported={(c) => { setActiveCroquisId(c.id); setShowImport(false); onChanged(); }}
        />
      )}
    </div>
  );
}

function ImportCroquisDialog({ ficheId, onClose, onImported }: { ficheId: number; onClose: () => void; onImported: (c: FTCroquis) => void }) {
  const [vue, setVue] = useState<FTVue>("face");
  const [vuePerso, setVuePerso] = useState("");
  const [legende, setLegende] = useState("");
  const [picked, setPicked] = useState<{ filePath: string; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handlePick() {
    const result = await window.api.ficheTechnique.pickCroquis();
    if (result.canceled) return;
    if (!("filePath" in result)) { setError((result as { error: string }).error); return; }
    setPicked({ filePath: result.filePath, dataUrl: result.dataUrl });
  }

  async function handleConfirm() {
    if (!picked) { setError("Merci de choisir une image."); return; }
    if (vue === "autre" && !vuePerso.trim()) { setError("Merci de préciser le nom de la vue."); return; }
    setBusy(true);
    setError(null);
    try {
      const c = await window.api.ficheTechnique.addCroquis(ficheId, picked.filePath, { vue, vue_personnalisee: vuePerso, legende });
      onImported(c);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'import.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-veil" style={{ zIndex: 60 }}>
      <div className="modal small">
        <div className="modal-head"><h3>Importer un croquis</h3></div>

        <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
          {(["face", "dos", "detail", "autre"] as FTVue[]).map((v) => (
            <button key={v} className={`btn ghost tiny ${vue === v ? "ft-vue-active" : ""}`} onClick={() => setVue(v)}>
              {FT_VUE_LABELS[v]}
            </button>
          ))}
        </div>
        {vue === "autre" && (
          <input
            type="text" value={vuePerso} onChange={(e) => setVuePerso(e.target.value)} placeholder="Nom de la vue (ex : Poche intérieure)"
            style={{ width: "100%", border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 9px", fontSize: 13, marginBottom: 10 }}
          />
        )}
        <input
          type="text" value={legende} onChange={(e) => setLegende(e.target.value)} placeholder="Légende (facultative)"
          style={{ width: "100%", border: "1px solid #D8D9D0", borderRadius: 6, padding: "7px 9px", fontSize: 13, marginBottom: 10 }}
        />

        {picked ? (
          <div style={{ textAlign: "center", marginBottom: 10 }}>
            <img src={picked.dataUrl} alt="" style={{ maxHeight: 180, maxWidth: "100%", borderRadius: 8, border: "1px solid #E7E9E0" }} />
          </div>
        ) : (
          <button className="btn ghost" onClick={handlePick} style={{ width: "100%", marginBottom: 10 }}>Choisir une image...</button>
        )}

        {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn primary" onClick={handleConfirm} disabled={busy || !picked}>Importer</button>
        </div>
      </div>
    </div>
  );
}
