import { Fragment, useEffect, useState } from "react";
import { Article } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";
import ArticleForm from "./ArticleForm";
import CompleterReferenceForm from "./CompleterReferenceForm";
import ArticlePhotoField from "./ArticlePhotoField";

export default function ArticlesPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  // Article en cours d'edition. Le meme formulaire sert a creer et a modifier : une seule
  // logique de saisie, aucune duplication dans la fiche technique.
  const [articleEnEdition, setArticleEnEdition] = useState<Article | null>(null);
  const [duplicationDe, setDuplicationDe] = useState<any>(null);
  const [completingId, setCompletingId] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    const list = await window.api.articles.list({ includeIncomplete: true });
    setArticles(list);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }

  const q = query.trim().toLowerCase();
  const filtered = q
    // La recherche porte aussi sur la DESIGNATION : depuis D2, « oversize » ne se trouve plus
    // dans le type (« T-shirt ») mais dans le nom commercial de l'article.
    ? articles.filter((a) =>
        (a.designation ?? "").toLowerCase().includes(q) ||
        a.produit.toLowerCase().includes(q) ||
        (a.categorie ?? "").toLowerCase().includes(q) ||
        (a.reference_principale ?? "").toLowerCase().includes(q)
      )
    : articles;

  const completeCount = articles.filter((a) => a.reference_principale).length;
  const incompleteCount = articles.length - completeCount;

  if (loading) return <div className="empty-state">Chargement des articles...</div>;

  return (
    <div>
      <div className="topline">
        <div>
          <div className="page-title">Articles</div>
          <div className="page-sub">
            {completeCount} article{completeCount > 1 ? "s" : ""} complet{completeCount > 1 ? "s" : ""}
            {incompleteCount > 0 && ` · ${incompleteCount} à compléter`}
          </div>
        </div>
        <button className="btn primary" onClick={() => setShowCreate(true)}>+ Nouvel article</button>
      </div>

      <div className="toolbar">
        <div className="search">
          🔍<input placeholder="Rechercher par produit ou référence..." value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Article</th>
            <th>Désignation</th>
            <th>Catégorie</th>
            <th>Type</th>
            <th>Saison</th>
            <th>Année</th>
            <th>Rayon</th>
            <th>Référence principale</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((a) => {
            const isOpen = expanded === a.id;
            const principale = a.photos.find((p) => p.est_principale);
            return (
              <Fragment key={a.id}>
                <tr className="row" onClick={() => setExpanded(isOpen ? null : a.id)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    {principale ? (
                      <div className="thumb-cell"><img src={mediaUrl(principale.photo_thumb_path)!} alt={a.designation || a.produit} /></div>
                    ) : (
                      <div className="thumb-cell empty"><span>Aucune photo</span></div>
                    )}
                  </td>
                  <td><strong>{a.designation || a.produit}</strong></td>
                  <td>{a.categorie ?? "—"}</td>
                  <td>{a.produit}</td>
                  <td>{a.saison ?? "—"}</td>
                  <td>{a.annee_collection ?? "—"}</td>
                  <td>{a.rayon ?? "—"}</td>
                  <td>
                    {a.reference_principale ? (
                      <span className="num">{a.reference_principale}</span>
                    ) : (
                      <span className="pill" style={{ background: "#FBEAE6", color: "#9A3412" }}>Référence à compléter</span>
                    )}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="detail-row">
                    <td colSpan={9}>
                      {/* Zone depliee volontairement MINIMALE : elle ne repete rien de la ligne
                          principale (designation, categorie, type, saison, annee, rayon,
                          reference y figurent deja). Elle ne sert qu'a la photo et aux actions.
                          La reference n'est rappelee QUE si elle manque — c'est alors une action
                          a mener, pas une information. */}
                      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 320px) 1fr", gap: 32, alignItems: "start", padding: "4px 0" }}>
                        <div style={{ minWidth: 0 }}>
                          <ArticlePhotoField article={a} onChanged={refresh} />
                        </div>

                        <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 14 }}>
                          {/* Actions sur l'ARTICLE : alignees a droite, avec un libelle explicite.
                              Les caracteres Unicode seuls (crayon, copie) se lisaient comme de
                              petits signes perdus et paraissaient rattaches a la photo.
                              Icone + mot leve l'ambiguite, et le titre « Actions article » separe
                              clairement ce bloc des commandes de la photo, a gauche. */}
                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6 }}>
                            <span style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "#9A9A90", fontWeight: 600 }}>
                              Actions article
                            </span>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button
                                className="btn ghost tiny" title="Modifier l'article"
                                onClick={() => setArticleEnEdition(a)}
                                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                              >
                                <span aria-hidden="true" style={{ fontSize: 12 }}>&#9998;</span> Modifier
                              </button>
                              <button
                                className="btn ghost tiny" title="Dupliquer l'article"
                                onClick={async () => {
                                  try { setDuplicationDe(await window.api.articles.preparerDuplication(a.id)); }
                                  catch (err: any) { notify(err?.message || "Duplication impossible."); }
                                }}
                                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                              >
                                <span aria-hidden="true" style={{ fontSize: 12 }}>&#10697;</span> Dupliquer
                              </button>
                            </div>
                          </div>

                          {!a.reference_principale && (
                            <div>
                              <p style={{ margin: "0 0 6px", fontWeight: 600 }}>Article migré, sans référence</p>
                              <p style={{ fontSize: 13, color: "#6B6B62", margin: "0 0 10px", maxWidth: 460 }}>
                                Cet article n'a pas encore de référence principale et ne peut pas être utilisé pour une
                                nouvelle commande tant qu'elle n'est pas générée.
                              </p>
                              <button className="btn primary" onClick={() => setCompletingId(a.id)}>Compléter et générer la référence</button>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
          {filtered.length === 0 && (
            <tr><td colSpan={9} className="empty-state">Aucun article ne correspond à cette recherche.</td></tr>
          )}
        </tbody>
      </table>

      {articleEnEdition && (
        <ArticleForm
          article={articleEnEdition}
          onCancel={() => setArticleEnEdition(null)}
          onCreated={(a) => { setArticleEnEdition(null); notify("Article « " + (a.designation || a.produit) + " » enregistré."); refresh(); }}
        />
      )}

      {duplicationDe && (
        <ArticleForm
          duplication={duplicationDe}
          onCancel={() => setDuplicationDe(null)}
          onCreated={(a) => { setDuplicationDe(null); notify("Article « " + (a.designation || a.produit) + " » créé par duplication."); refresh(); setExpanded(a.id); }}
        />
      )}

      {showCreate && (
        <ArticleForm
          onCancel={() => setShowCreate(false)}
          onCreated={(article) => { setShowCreate(false); notify(`Article "${article.reference_principale}" créé.`); refresh(); setExpanded(article.id); }}
        />
      )}

      {completingId != null && (
        <CompleterReferenceForm
          article={articles.find((a) => a.id === completingId)!}
          onCancel={() => setCompletingId(null)}
          onCompleted={(article) => { setCompletingId(null); notify(`Référence "${article.reference_principale}" générée.`); refresh(); }}
        />
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
