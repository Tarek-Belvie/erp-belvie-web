import { useEffect, useState } from "react";
import { Article, ArticleVariante, DeclinaisonType, DeclinaisonValeur, ImpactConfigurationDeclinaisons, ResultatGenerationVariantes } from "../../shared/types";

interface Props {
  article: Article;
}

export default function ArticleDeclinaisonsSection({ article }: Props) {
  const [allTypes, setAllTypes] = useState<DeclinaisonType[]>([]);
  const [selectedTypeIds, setSelectedTypeIds] = useState<number[]>([]);
  const [valeursByType, setValeursByType] = useState<Record<number, DeclinaisonValeur[]>>({});
  const [selectedValeurIds, setSelectedValeurIds] = useState<Record<number, number[]>>({});
  const [variantes, setVariantes] = useState<ArticleVariante[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [pendingImpact, setPendingImpact] = useState<ImpactConfigurationDeclinaisons | null>(null);
  const [genResult, setGenResult] = useState<ResultatGenerationVariantes | null>(null);

  async function refresh() {
    const [types, articleTypes, articleValeurs, varList] = await Promise.all([
      window.api.declinaisons.listTypes(),
      window.api.declinaisons.getArticleTypes(article.id),
      window.api.declinaisons.getArticleValeurs(article.id),
      window.api.declinaisons.listVariantes(article.id, { includeInactive: true }),
    ]);
    setAllTypes(types);

    const ordered = [...articleTypes].sort((a, b) => a.ordre - b.ordre);
    const orderedIds = ordered.map((t) => t.id);
    setSelectedTypeIds(orderedIds);

    const grouped: Record<number, number[]> = {};
    articleValeurs.forEach((v) => {
      if (!grouped[v.declinaison_type_id]) grouped[v.declinaison_type_id] = [];
      grouped[v.declinaison_type_id].push(v.declinaison_valeur_id);
    });
    setSelectedValeurIds(grouped);

    const valeursMap: Record<number, DeclinaisonValeur[]> = {};
    await Promise.all(orderedIds.map(async (id) => { valeursMap[id] = await window.api.declinaisons.listValeurs(id); }));
    setValeursByType((prev) => ({ ...prev, ...valeursMap }));

    setVariantes(varList);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, [article.id]);

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function handleToggleType(typeId: number, checked: boolean) {
    if (checked) {
      setSelectedTypeIds((prev) => [...prev, typeId]);
      if (!valeursByType[typeId]) {
        const vals = await window.api.declinaisons.listValeurs(typeId);
        setValeursByType((prev) => ({ ...prev, [typeId]: vals }));
      }
    } else {
      setSelectedTypeIds((prev) => prev.filter((id) => id !== typeId));
      setSelectedValeurIds((prev) => { const copy = { ...prev }; delete copy[typeId]; return copy; });
    }
  }

  function moveType(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selectedTypeIds.length) return;
    const reordered = [...selectedTypeIds];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(target, 0, moved);
    setSelectedTypeIds(reordered);
  }

  function toggleValeur(typeId: number, valeurId: number) {
    setSelectedValeurIds((prev) => {
      const current = prev[typeId] || [];
      const next = current.includes(valeurId) ? current.filter((id) => id !== valeurId) : [...current, valeurId];
      return { ...prev, [typeId]: next };
    });
  }

  function buildSelections(): Record<number, number[]> {
    const sel: Record<number, number[]> = {};
    selectedTypeIds.forEach((id) => { sel[id] = selectedValeurIds[id] || []; });
    return sel;
  }

  const comptesParType = selectedTypeIds.map((id) => (selectedValeurIds[id] || []).length);
  const typesSansValeur = selectedTypeIds.filter((id) => (selectedValeurIds[id] || []).length === 0);
  const totalCombinaisons = selectedTypeIds.length > 0 && typesSansValeur.length === 0
    ? comptesParType.reduce((a, b) => a * b, 1)
    : 0;

  async function handleSaveConfig() {
    setError(null);
    if (typesSansValeur.length > 0) {
      setError("Chaque type sélectionné doit avoir au moins une valeur choisie avant d'enregistrer.");
      return;
    }
    setBusy(true);
    try {
      const selections = buildSelections();
      const hasVariantes = await window.api.declinaisons.articleHasVariantes(article.id);
      if (hasVariantes) {
        const impact = await window.api.declinaisons.previsualiserImpact(article.id, selections);
        setPendingImpact(impact);
      } else {
        await window.api.declinaisons.appliquerConfiguration(article.id, selectedTypeIds, selections);
        notify("Configuration enregistrée.");
        await refresh();
      }
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSaveConfig() {
    setBusy(true);
    setError(null);
    try {
      const selections = buildSelections();
      await window.api.declinaisons.appliquerConfiguration(article.id, selectedTypeIds, selections);
      setPendingImpact(null);
      notify("Configuration enregistrée.");
      await refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGenerer() {
    setBusy(true);
    setError(null);
    try {
      const selections = buildSelections();
      const result = await window.api.declinaisons.genererVariantes(article.id, selections);
      setGenResult(result);
      await refresh();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la génération.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleVarianteActif(v: ArticleVariante) {
    await window.api.declinaisons.updateVariante(v.id, { actif: !v.actif });
    refresh();
  }

  async function handleEditChamp(v: ArticleVariante, champ: "sku" | "code_barres" | "reference_interne", valeur: string) {
    await window.api.declinaisons.updateVariante(v.id, { [champ]: valeur || null } as any);
    refresh();
  }

  if (loading) return <p style={{ fontSize: 13, color: "#6B6B62" }}>Chargement des déclinaisons...</p>;

  const disponibles = allTypes.filter((t) => !selectedTypeIds.includes(t.id));

  return (
    <div>
      <p style={{ margin: "0 0 10px", fontWeight: 600 }}>Déclinaisons</p>

      {disponibles.length > 0 && (
        <div style={{ marginBottom: 12, display: "flex", flexWrap: "wrap", gap: 10 }}>
          {disponibles.map((t) => (
            <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 12.5, color: "#4B4B43" }}>
              <input type="checkbox" checked={false} onChange={() => handleToggleType(t.id, true)} />
              {t.nom}
            </label>
          ))}
        </div>
      )}

      {selectedTypeIds.length === 0 ? (
        <p style={{ fontSize: 12.5, color: "#9A9A90" }}>Aucun type de déclinaison sélectionné pour cet article. Cochez-en un ci-dessus pour commencer.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {selectedTypeIds.map((typeId, index) => {
            const t = allTypes.find((x) => x.id === typeId);
            const vals = valeursByType[typeId] || [];
            const chosen = selectedValeurIds[typeId] || [];
            if (!t) return null;
            return (
              <div key={typeId} style={{ border: "1px solid #E5E7DE", borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <button className="btn ghost quick-add-btn" style={{ padding: "1px 6px", fontSize: 10 }} disabled={index === 0} onClick={() => moveType(index, -1)}>▲</button>
                    <button className="btn ghost quick-add-btn" style={{ padding: "1px 6px", fontSize: 10 }} disabled={index === selectedTypeIds.length - 1} onClick={() => moveType(index, 1)}>▼</button>
                  </div>
                  <strong style={{ fontSize: 13 }}>{t.nom}</strong>
                  <span style={{ fontSize: 11.5, color: chosen.length === 0 ? "#C0392B" : "#9A9A90" }}>
                    {chosen.length === 0 ? "aucune valeur choisie" : `${chosen.length} valeur${chosen.length > 1 ? "s" : ""} choisie${chosen.length > 1 ? "s" : ""}`}
                  </span>
                  <div style={{ flex: 1 }} />
                  <button className="btn ghost" style={{ fontSize: 11.5, padding: "3px 8px" }} onClick={() => handleToggleType(typeId, false)}>Retirer ce type</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  {vals.map((v) => (
                    <label key={v.id} style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, background: chosen.includes(v.id) ? "#ECFDF5" : "#F6F7F5", border: "1px solid #E5E7DE", borderRadius: 20, padding: "3px 9px" }}>
                      <input type="checkbox" checked={chosen.includes(v.id)} onChange={() => toggleValeur(typeId, v.id)} />
                      {!!t.affichage_couleur && v.couleur_hex && <span style={{ width: 10, height: 10, borderRadius: "50%", background: v.couleur_hex, display: "inline-block" }} />}
                      {v.valeur}
                    </label>
                  ))}
                  {vals.length === 0 && <span style={{ fontSize: 11.5, color: "#9A9A90" }}>Aucune valeur définie pour ce type — ajoutez-en dans Paramètres → Déclinaisons.</span>}
                </div>
              </div>
            );
          })}

          <div style={{ background: totalCombinaisons > 0 ? "#ECFDF5" : "#FEF2F2", border: "1px solid " + (totalCombinaisons > 0 ? "#B7E4CF" : "#F5C6C0"), borderRadius: 8, padding: "9px 12px", fontSize: 13 }}>
            {typesSansValeur.length > 0
              ? "Sélectionnez au moins une valeur pour chaque type coché avant de pouvoir générer."
              : `${comptesParType.join(" × ")} = ${totalCombinaisons} variante${totalCombinaisons > 1 ? "s" : ""} attendue${totalCombinaisons > 1 ? "s" : ""}`}
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn ghost" onClick={handleSaveConfig} disabled={busy}>Enregistrer la configuration</button>
            <button className="btn primary" onClick={handleGenerer} disabled={busy || totalCombinaisons === 0}>Générer les variantes</button>
          </div>
        </div>
      )}

      {error && <p style={{ color: "#C0392B", fontSize: 12.5, marginTop: 8 }}>{error}</p>}

      {genResult && (
        <div style={{ marginTop: 12, background: "#F6F7F5", borderRadius: 8, padding: "10px 12px", fontSize: 13 }}>
          <strong>{genResult.total_attendu} variantes attendues</strong><br />
          {genResult.deja_existantes} déjà existantes<br />
          {genResult.creees} nouvelle{genResult.creees > 1 ? "s" : ""} variante{genResult.creees > 1 ? "s" : ""} créée{genResult.creees > 1 ? "s" : ""}
          <button className="btn ghost" style={{ marginLeft: 12, fontSize: 11.5, padding: "2px 8px" }} onClick={() => setGenResult(null)}>Fermer</button>
        </div>
      )}

      {variantes.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontWeight: 600, fontSize: 13, marginBottom: 8 }}>Variantes ({variantes.filter((v) => v.actif).length} active{variantes.filter((v) => v.actif).length > 1 ? "s" : ""} / {variantes.length} au total)</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 320, overflowY: "auto" }}>
            {variantes.map((v) => (
              <div key={v.id} className="settings-row" style={{ opacity: v.actif ? 1 : 0.55 }}>
                <div className="libelle" style={{ flex: "0 0 auto", minWidth: 160 }}>
                  {v.valeurs.map((x) => x.valeur).join(" / ")}
                </div>
                <span className={`v2-badge ${v.actif ? "v2-badge-validee" : "v2-badge-brouillon"}`} style={{ fontSize: 11 }}>{v.actif ? "Active" : "Désactivée"}</span>
                <input
                  type="text" defaultValue={v.sku ?? ""} placeholder="SKU (facultatif)"
                  onBlur={(e) => { if (e.target.value !== (v.sku ?? "")) handleEditChamp(v, "sku", e.target.value); }}
                  style={{ width: 120, border: "1px solid #D8D9D0", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                />
                <input
                  type="text" defaultValue={v.code_barres ?? ""} placeholder="Code-barres (facultatif)"
                  onBlur={(e) => { if (e.target.value !== (v.code_barres ?? "")) handleEditChamp(v, "code_barres", e.target.value); }}
                  style={{ width: 130, border: "1px solid #D8D9D0", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                />
                <input
                  type="text" defaultValue={v.reference_interne ?? ""} placeholder="Référence interne (facultative)"
                  onBlur={(e) => { if (e.target.value !== (v.reference_interne ?? "")) handleEditChamp(v, "reference_interne", e.target.value); }}
                  style={{ width: 150, border: "1px solid #D8D9D0", borderRadius: 6, padding: "4px 6px", fontSize: 11.5 }}
                />
                <button className="btn ghost" style={{ fontSize: 11.5, padding: "3px 8px" }} onClick={() => toggleVarianteActif(v)}>{v.actif ? "Désactiver" : "Réactiver"}</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}

      {pendingImpact && (
        <div className="modal-veil" style={{ zIndex: 60 }}>
          <div className="modal">
            <div className="modal-head"><h3>Impact de cette modification</h3></div>
            <p style={{ fontSize: 13, color: "#4B4B43" }}>Des variantes existent déjà pour cet article. Voici précisément ce que ce changement va faire :</p>
            <ul style={{ fontSize: 13, lineHeight: 1.8, paddingLeft: 20 }}>
              <li><strong>{pendingImpact.conservees}</strong> variante{pendingImpact.conservees > 1 ? "s" : ""} conservée{pendingImpact.conservees > 1 ? "s" : ""} (aucun changement)</li>
              {pendingImpact.a_reactiver > 0 && <li><strong>{pendingImpact.a_reactiver}</strong> variante{pendingImpact.a_reactiver > 1 ? "s" : ""} désactivée{pendingImpact.a_reactiver > 1 ? "s" : ""} qui redevien{pendingImpact.a_reactiver > 1 ? "nent" : "t"} valide{pendingImpact.a_reactiver > 1 ? "s" : ""} et sera{pendingImpact.a_reactiver > 1 ? "ont" : ""} réactivée{pendingImpact.a_reactiver > 1 ? "s" : ""}</li>}
              <li><strong>{pendingImpact.nouvelles}</strong> nouvelle{pendingImpact.nouvelles > 1 ? "s" : ""} combinaison{pendingImpact.nouvelles > 1 ? "s" : ""} à créer (via « Générer les variantes »)</li>
              {pendingImpact.obsoletes > 0 && <li><strong>{pendingImpact.obsoletes}</strong> variante{pendingImpact.obsoletes > 1 ? "s" : ""} qui ne correspond{pendingImpact.obsoletes > 1 ? "ent" : ""} plus à la sélection et sera{pendingImpact.obsoletes > 1 ? "ont" : ""} <strong>désactivée{pendingImpact.obsoletes > 1 ? "s" : ""}</strong> (jamais supprimée)</li>}
              {pendingImpact.deja_utilisees_ailleurs > 0 && <li style={{ color: "#B45309" }}><strong>{pendingImpact.deja_utilisees_ailleurs}</strong> variante{pendingImpact.deja_utilisees_ailleurs > 1 ? "s" : ""} déjà utilisée{pendingImpact.deja_utilisees_ailleurs > 1 ? "s" : ""} ailleurs (commandes, stock...)</li>}
            </ul>
            {error && <p style={{ color: "#C0392B", fontSize: 12.5 }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setPendingImpact(null)} disabled={busy}>Annuler</button>
              <button className="btn primary" onClick={confirmSaveConfig} disabled={busy}>Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
