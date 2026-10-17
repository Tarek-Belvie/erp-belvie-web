import { useEffect, useState } from "react";
import { Article, EstimationResume } from "../../shared/types";

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " DT";
}

interface Props {
  onOuvrir: (articleId: number, nom: string) => void;
}

// Liste de travail VOLONTAIRE : seuls les articles pour lesquels une estimation a été démarrée
// apparaissent ici — jamais tout le catalogue. "+ Ajouter un article à estimer" est le seul point
// d'entrée, et réutilise le catalogue Articles existant (jamais un second catalogue Finance).
export default function FinanceCoutsProduits({ onOuvrir }: Props) {
  const [tousLesArticles, setTousLesArticles] = useState<Article[]>([]);
  const [resumes, setResumes] = useState<EstimationResume[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [showAjouter, setShowAjouter] = useState(false);
  const [confirmSupprimer, setConfirmSupprimer] = useState<EstimationResume | null>(null);
  const [busy, setBusy] = useState(false);

  async function charger() {
    try {
      const [arts, resumesListe] = await Promise.all([
        window.api.articles.list({ includeIncomplete: true }),
        window.api.finance.listEstimationsResume(),
      ]);
      setTousLesArticles(arts);
      setResumes(resumesListe);
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    } finally {
      setLoaded(true);
    }
  }
  useEffect(() => { charger(); }, []);

  const articlesParId = new Map(tousLesArticles.map((a) => [a.id, a]));
  const articleIdsSuivis = new Set(resumes.map((r) => r.article_id));

  async function handleSelectionner(article: Article) {
    setShowAjouter(false);
    if (articleIdsSuivis.has(article.id)) {
      // Déjà suivi : on ouvre directement son estimation existante, jamais un doublon.
      onOuvrir(article.id, article.produit);
      return;
    }
    await window.api.finance.getOuCreerEstimation(article.id);
    onOuvrir(article.id, article.produit);
  }

  async function handleSupprimer() {
    if (!confirmSupprimer) return;
    setBusy(true);
    try {
      await window.api.finance.supprimerEstimation(confirmSupprimer.estimation_id);
      setConfirmSupprimer(null);
      await charger();
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return <p className="empty-state">Chargement...</p>;
  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
        <button className="btn primary" onClick={() => setShowAjouter(true)}>+ Ajouter un article à estimer</button>
      </div>

      {resumes.length === 0 ? (
        <div className="finance-etat-vide">
          <div className="finance-etat-vide-titre">Aucun article suivi pour l'instant</div>
          <p>Choisissez un article existant pour démarrer son estimation de coût — il apparaîtra ici dès que vous commencez.</p>
          <button className="btn primary" onClick={() => setShowAjouter(true)}>+ Ajouter un article à estimer</button>
        </div>
      ) : (
        <div className="finance-tableau">
          <table className="grid-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Article</th><th style={{ textAlign: "left" }}>Référence</th>
                <th>Statut</th><th>Coût HT/pièce</th><th>Quantité prévue</th><th>Budget total HT</th><th></th>
              </tr>
            </thead>
            <tbody>
              {resumes.map((r) => {
                const a = articlesParId.get(r.article_id);
                const estime = r.nb_lignes > 0;
                return (
                  <tr key={r.article_id} onClick={() => onOuvrir(r.article_id, a?.produit || "Article")} style={{ cursor: "pointer" }}>
                    <td className="grid-row-label">{a?.produit || "Article supprimé"}</td>
                    <td style={{ color: "var(--v2-text-3)", fontSize: 12.5 }}>{a?.reference_principale || "—"}</td>
                    <td>
                      <span className="finance-statut-pastille" style={{ color: estime ? "var(--v2-green-dark)" : "var(--v2-text-2)", borderColor: estime ? "var(--v2-green-dark)" : "var(--v2-text-2)" }}>
                        {estime ? "Estimé" : "À estimer"}
                      </span>
                    </td>
                    <td>{estime ? formatMontant(r.cout_ht_piece) : "—"}</td>
                    <td>{r.quantite_prevue ?? "—"}</td>
                    <td>{r.budget_total_ht != null ? formatMontant(r.budget_total_ht) : "—"}</td>
                    <td>
                      <button
                        className="icon-btn" title="Supprimer cette estimation" aria-label="Supprimer"
                        onClick={(e) => { e.stopPropagation(); setConfirmSupprimer(r); }}
                      >✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showAjouter && (
        <SelecteurArticleModal
          articles={tousLesArticles}
          articleIdsSuivis={articleIdsSuivis}
          onFermer={() => setShowAjouter(false)}
          onSelectionner={handleSelectionner}
        />
      )}

      {confirmSupprimer && (
        <div className="modal-veil" onClick={() => !busy && setConfirmSupprimer(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>Supprimer cette estimation de coût ?</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
              L'article restera disponible dans le catalogue ERP. Seule son estimation dans Finance sera supprimée.
            </p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmSupprimer(null)} disabled={busy}>Annuler</button>
              <button className="btn danger" onClick={handleSupprimer} disabled={busy}>Supprimer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SelecteurArticleModal({ articles, articleIdsSuivis, onFermer, onSelectionner }: {
  articles: Article[]; articleIdsSuivis: Set<number>; onFermer: () => void; onSelectionner: (a: Article) => void;
}) {
  const [recherche, setRecherche] = useState("");
  const q = recherche.trim().toLowerCase();
  const resultats = q
    ? articles.filter((a) => a.produit.toLowerCase().includes(q) || (a.reference_principale || "").toLowerCase().includes(q)).slice(0, 30)
    : articles.slice(0, 30);

  return (
    <div className="modal-veil" onClick={onFermer}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Ajouter un article à estimer</h3></div>
        <input
          type="text" autoFocus value={recherche} onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher par nom ou référence..."
          style={{ width: "100%", border: "1px solid var(--v2-border-strong)", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}
        />
        <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
          {resultats.map((a) => (
            <div
              key={a.id} onClick={() => onSelectionner(a)}
              style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, cursor: "pointer", border: "1px solid var(--v2-border)" }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{a.produit}</div>
                <div style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>{a.reference_principale || "Référence à compléter"}</div>
              </div>
              {articleIdsSuivis.has(a.id) && <span style={{ fontSize: 10.5, color: "var(--v2-green-dark)", background: "var(--v2-green-bg)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>Déjà suivi</span>}
            </div>
          ))}
          {resultats.length === 0 && <p style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>Aucun article trouvé.</p>}
        </div>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onFermer}>Annuler</button>
        </div>
      </div>
    </div>
  );
}
