import { useEffect, useState } from "react";
import { Article } from "../../shared/types";
import ArticleForm from "../articles/ArticleForm";

interface Props {
  onArticleChosen: (article: Article) => void;
  onCancel: () => void;
}

export default function FTCreationFlow({ onArticleChosen, onCancel }: Props) {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [showCreateArticle, setShowCreateArticle] = useState(false);

  useEffect(() => {
    window.api.articles.list().then((list: Article[]) => { setArticles(list); setLoading(false); });
  }, []);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? articles.filter((a) =>
        (a.produit ?? "").toLowerCase().includes(q) ||
        (a.reference_principale ?? "").toLowerCase().includes(q)
      )
    : articles;

  if (showCreateArticle) {
    return (
      <ArticleForm
        onCancel={() => setShowCreateArticle(false)}
        onCreated={(article) => onArticleChosen(article)}
      />
    );
  }

  return (
    <div className="ft-page">
      <button className="ft-back-link" onClick={onCancel}>← Fiches techniques</button>
      <div className="topline">
        <div>
          <div className="page-title">Nouvelle fiche technique</div>
          <div className="page-sub">Choisissez l'article concerné — une fiche technique est toujours liée à un article existant.</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="search">
          🔍 <input placeholder="Rechercher un produit ou une référence..." value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>
        <button className="btn ghost" onClick={() => setShowCreateArticle(true)}>+ Créer un nouvel article</button>
      </div>

      {loading ? (
        <div className="empty-state">Chargement des articles...</div>
      ) : filtered.length === 0 ? (
        <div className="empty-state" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "40px 20px" }}>
          <p style={{ margin: 0 }}>
            {articles.length === 0
              ? "Aucun article n'existe encore dans l'ERP."
              : "Aucun article ne correspond à cette recherche."}
          </p>
          <button className="btn primary" onClick={() => setShowCreateArticle(true)}>Créer un nouvel article</button>
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th style={{ textAlign: "left", padding: "10px 14px" }}>Référence</th>
              <th style={{ textAlign: "left" }}>Produit</th>
              <th style={{ textAlign: "left" }}>Saison</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a) => (
              <tr key={a.id}>
                <td style={{ padding: "10px 14px", fontWeight: 600 }}>{a.reference_principale ?? "réf. à compléter"}</td>
                <td>{a.produit}</td>
                <td>{a.saison ?? "—"}</td>
                <td style={{ textAlign: "right", paddingRight: 14 }}>
                  <button className="btn ghost tiny" onClick={() => onArticleChosen(a)}>Choisir cet article</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
