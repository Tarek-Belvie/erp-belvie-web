import { useEffect, useState } from "react";
import { Article, FicheTechnique } from "../../shared/types";
import FicheTechniquePage from "./FicheTechniquePage";
import FTCreationFlow from "./FTCreationFlow";

const STATUT_BADGE: Record<string, string> = { brouillon: "v2-badge-brouillon", validee: "v2-badge-validee", archivee: "v2-badge-archivee" };
const STATUT_LABEL: Record<string, string> = { brouillon: "Brouillon", validee: "Validée", archivee: "Archivée" };

type Vue = "liste" | "creation" | "detail";

export default function FichesTechniquesPage() {
  const [fiches, setFiches] = useState<FicheTechnique[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [vue, setVue] = useState<Vue>("liste");
  const [detailArticle, setDetailArticle] = useState<Article | null>(null);

  async function refresh() {
    const list = await window.api.ficheTechnique.listAll();
    setFiches(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function handleOpen(articleId: number) {
    const article = await window.api.articles.get(articleId);
    if (article) { setDetailArticle(article); setVue("detail"); }
  }

  function handleArticleChoisi(article: Article) {
    setDetailArticle(article);
    setVue("detail");
  }

  function handleRetourListe() {
    setVue("liste");
    setDetailArticle(null);
    refresh();
  }

  if (vue === "detail" && detailArticle) {
    return <FicheTechniquePage article={detailArticle} onBack={handleRetourListe} />;
  }

  if (vue === "creation") {
    return <FTCreationFlow onArticleChosen={handleArticleChoisi} onCancel={() => setVue("liste")} />;
  }

  const q = query.trim().toLowerCase();
  const filtered = fiches.filter((f) =>
    !q || (f.produit ?? "").toLowerCase().includes(q) || (f.reference_principale ?? "").toLowerCase().includes(q)
  );

  if (loading) return <div className="empty-state">Chargement des fiches techniques...</div>;

  return (
    <div className="ft-page">
      <div className="topline">
        <div>
          <div className="page-title">Fiches techniques</div>
          <div className="page-sub">{fiches.length} fiche{fiches.length > 1 ? "s" : ""} — bureau d'études</div>
        </div>
        <button className="btn primary" onClick={() => setVue("creation")}>+ Nouvelle fiche technique</button>
      </div>

      <div className="toolbar">
        <div className="search">
          🔍 <input placeholder="Rechercher un produit ou une référence..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ textAlign: "left", padding: "10px 14px" }}>Référence</th>
            <th style={{ textAlign: "left" }}>Produit</th>
            <th style={{ textAlign: "left" }}>Saison</th>
            <th>Statut</th>
            <th>Croquis</th>
            <th>Mesures</th>
            <th>Accessoires</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((f) => (
            <tr key={f.id} style={{ cursor: "pointer" }} onClick={() => handleOpen(f.article_id)}>
              <td style={{ padding: "10px 14px", fontWeight: 600 }}>{f.reference_principale ?? "—"}</td>
              <td>{f.produit}</td>
              <td>{f.saison ?? "—"}</td>
              <td style={{ textAlign: "center" }}><span className={`v2-badge ${STATUT_BADGE[f.statut]}`}>{STATUT_LABEL[f.statut]}</span></td>
              <td style={{ textAlign: "center" }}>{f.nb_croquis}</td>
              <td style={{ textAlign: "center" }}>{f.nb_mesures}</td>
              <td style={{ textAlign: "center" }}>{f.nb_accessoires}</td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={7} className="empty-state">
              {fiches.length === 0 ? "Aucune fiche technique pour l'instant." : "Aucune fiche technique ne correspond à cette recherche."}
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
