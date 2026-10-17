import { useEffect, useState } from "react";
import { Article, Commande, CommandePayload, Etape, ListeValeur, PRIORITE_LABELS, TypeProduction } from "../../shared/types";
import { mediaUrl, todayISO } from "./uiHelpers";
import QuickAddSelect from "./QuickAddSelect";
import SizeColorGrid from "./SizeColorGrid";
import RepartitionTable from "./RepartitionTable";
import ArticleForm from "../articles/ArticleForm";

interface Props {
  etapes: Etape[];
  existing?: Commande | null;
  onCancel: () => void;
  onSubmit: (payload: CommandePayload) => Promise<void>;
}

function addDays(iso: string, n: number) {
  const d = new Date(iso);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function prochaineReferenceReassort(article: Article): string {
  const next = (article.max_numero_reassort || 0) + 1;
  return `${article.reference_principale}-R${String(next).padStart(2, "0")}`;
}

function visibleOptions(all: ListeValeur[], currentIds: (number | undefined | null)[]) {
  const keep = new Set(currentIds.filter((x): x is number => x != null));
  return all.filter((v) => v.actif || keep.has(v.id));
}

export default function OrderForm({ etapes, existing, onCancel, onSubmit }: Props) {
  const isLocked = !!existing && existing.statut !== "brouillon";

  const [articles, setArticles] = useState<Article[]>([]);
  const [couleurs, setCouleurs] = useState<ListeValeur[]>([]);
  const [tailles, setTailles] = useState<ListeValeur[]>([]);
  const [ateliers, setAteliers] = useState<ListeValeur[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [typeProduction, setTypeProduction] = useState<TypeProduction | null>(existing?.type_production ?? null);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [showCreateArticle, setShowCreateArticle] = useState(false);

  const [f, setF] = useState<Partial<CommandePayload>>({
    responsable_nom: existing?.responsable ?? "",
    atelier_id: existing?.atelier_id,
    date_lancement: existing?.date_lancement ?? todayISO(),
    date_fin_prevue: existing?.date_fin_prevue ?? addDays(todayISO(), 14),
    etape_id: existing?.etape_id ?? etapes[0]?.id,
    priorite: existing?.priorite ?? "normale",
    commentaires: existing?.commentaires ?? "",
    lignes: existing?.lignes?.map((l) => ({ couleur_id: l.couleur_id, taille_id: l.taille_id, quantite: l.quantite })) ?? [],
  });
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [arts, c, t, a] = await Promise.all([
        window.api.articles.list({ includeIncomplete: false }),
        window.api.listes.list("couleur", { includeInactive: true }),
        window.api.listes.list("taille", { includeInactive: true }),
        window.api.listes.list("atelier", { includeInactive: true }),
      ]);
      setArticles(arts);
      setCouleurs(c);
      setTailles(t);
      setAteliers(a);
      if (existing) {
        setSelectedArticle(arts.find((x) => x.id === existing.article_id) ?? null);
      }
      setLoaded(true);
    }
    load();
  }, []);

  useEffect(() => {
    if (!loaded || existing) return;
    setF((prev) => {
      const atelierParDefaut = ateliers.find((v) => v.actif);
      return {
        ...prev,
        atelier_id: prev.atelier_id ?? atelierParDefaut?.id,
        responsable_nom: prev.responsable_nom || atelierParDefaut?.responsable_nom || "",
      };
    });
  }, [loaded, ateliers, existing]);

  const set = (k: keyof CommandePayload) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: e.target.value });

  const articlesPourNouveau = articles.filter((a) => a.nb_commandes_nouveau === 0);
  const articlesPourReassort = articles.filter((a) => a.nb_commandes_nouveau > 0);

  function validate(): string | null {
    if (!selectedArticle) return "Sélectionnez ou créez un article.";
    if (!f.responsable_nom || !f.responsable_nom.trim()) return "Renseignez un responsable.";
    if (!f.atelier_id) return "Sélectionnez un atelier.";
    if (!f.lignes || f.lignes.length === 0) return "Renseignez au moins une quantité dans le tableau couleur × taille.";
    if (f.date_fin_prevue! < f.date_lancement!) return "La date limite de production ne peut pas être antérieure à la date de lancement.";
    return null;
  }

  async function handleSubmit() {
    const clientError = validate();
    if (clientError) {
      setError(clientError);
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        ...(f as CommandePayload),
        article_id: selectedArticle!.id,
        type_production: typeProduction ?? "nouveau",
      });
    } catch (err: any) {
      setError(err?.message || "Une erreur est survenue lors de l'enregistrement.");
    } finally {
      setSubmitting(false);
    }
  }

  const couleursVisibles = visibleOptions(couleurs, (existing?.lignes ?? []).map((l) => l.couleur_id));
  const taillesVisibles = visibleOptions(tailles, (existing?.lignes ?? []).map((l) => l.taille_id));
  const photoPrincipale = selectedArticle?.photos.find((p) => p.est_principale) ?? null;

  return (
    <div className="modal-veil">
      <div className="modal wide">
        <div className="modal-head">
          <div>
            <p className="eyebrow">
              {existing ? (existing.numero ?? "Brouillon non validé") : "Nouvelle commande"}
              {!isLocked && <span className="v2-badge v2-badge-brouillon" style={{ marginLeft: 8 }}>Brouillon non validé</span>}
            </p>
            <h3>
              {existing?.reference_production ??
                (selectedArticle && typeProduction === "reassort" ? prochaineReferenceReassort(selectedArticle) : selectedArticle?.reference_principale) ??
                "Choisissez un article"}
            </h3>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>

        {!loaded && <p className="hint">Chargement...</p>}

        {loaded && !existing && !typeProduction && (
          <div className="type-production-choice">
            <button type="button" className="type-choice-btn" onClick={() => setTypeProduction("nouveau")}>
              <span className="type-choice-title">Nouvel article</span>
              <span className="type-choice-desc">Première commande de production pour un article.</span>
            </button>
            <button type="button" className="type-choice-btn" onClick={() => setTypeProduction("reassort")}>
              <span className="type-choice-title">Réassort</span>
              <span className="type-choice-desc">Production supplémentaire d'un article déjà lancé.</span>
            </button>
          </div>
        )}

        {loaded && typeProduction && !selectedArticle && !isLocked && (
          <div className="article-picker">
            <p className="hint" style={{ marginTop: 0 }}>
              {typeProduction === "nouveau"
                ? "Choisissez un article n'ayant encore aucune commande initiale, ou créez-en un nouveau."
                : "Choisissez un article ayant déjà une première commande de production."}
            </p>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                defaultValue=""
                onChange={(e) => { const a = articles.find((x) => x.id === Number(e.target.value)); if (a) setSelectedArticle(a); }}
              >
                <option value="" disabled>— Sélectionner un article —</option>
                {(typeProduction === "nouveau" ? articlesPourNouveau : articlesPourReassort).map((a) => (
                  <option key={a.id} value={a.id}>{a.reference_principale} — {a.produit}</option>
                ))}
              </select>
              {typeProduction === "nouveau" && (
                <button type="button" className="btn ghost" onClick={() => setShowCreateArticle(true)}>+ Créer un nouvel article</button>
              )}
              <button type="button" className="btn ghost" onClick={() => setTypeProduction(null)}>← Changer de type</button>
            </div>
            {typeProduction === "nouveau" && articlesPourNouveau.length === 0 && (
              <p className="hint">Aucun article disponible sans commande initiale — créez-en un.</p>
            )}
            {typeProduction === "reassort" && articlesPourReassort.length === 0 && (
              <p className="hint">Aucun article n'a encore de première commande de production.</p>
            )}
          </div>
        )}

        {selectedArticle && (
          <>
            <div className="article-summary">
              <div className="photo-preview-box" style={{ width: 64, height: 64 }}>
                {photoPrincipale ? (
                  <img src={mediaUrl(photoPrincipale.photo_thumb_path)!} alt={selectedArticle.produit} />
                ) : (
                  <span className="photo-preview-empty">Aucune photo</span>
                )}
              </div>
              <div className="article-summary-grid">
                <div><span className="article-summary-label">Référence principale</span>{selectedArticle.reference_principale}</div>
                <div><span className="article-summary-label">Produit</span>{selectedArticle.produit}</div>
                <div><span className="article-summary-label">Saison</span>{selectedArticle.saison}</div>
                <div><span className="article-summary-label">Année</span>{selectedArticle.annee_collection}</div>
                <div><span className="article-summary-label">Rayon</span>{selectedArticle.rayon}</div>
                {typeProduction === "reassort" && (
                  <>
                    <div><span className="article-summary-label">Productions déjà réalisées</span>{selectedArticle.nb_productions}</div>
                    <div><span className="article-summary-label">Dernière référence</span>{selectedArticle.derniere_reference_production ?? "—"}</div>
                    <div><span className="article-summary-label">Nouvelle référence proposée</span><strong>{prochaineReferenceReassort(selectedArticle)}</strong></div>
                  </>
                )}
              </div>
              {!isLocked && (
                <button type="button" className="btn ghost tiny" onClick={() => setSelectedArticle(null)}>Changer d'article</button>
              )}
            </div>

            <div className="modal-grid">
              <label>
                Responsable
                <input
                  type="text"
                  placeholder="Nom du responsable"
                  value={f.responsable_nom ?? ""}
                  onChange={(e) => setF({ ...f, responsable_nom: e.target.value })}
                />
              </label>
              <QuickAddSelect
                label="Atelier de confection"
                type="atelier"
                options={visibleOptions(ateliers, [f.atelier_id])}
                value={f.atelier_id}
                onChange={(id) => {
                  // Suggère automatiquement le responsable de cet atelier (Fabrication → Ateliers)
                  // — reste librement modifiable juste après si besoin, sans jamais toucher les
                  // commandes déjà créées si le responsable de l'atelier change plus tard.
                  const atelier = ateliers.find((a) => a.id === id);
                  setF({ ...f, atelier_id: id, responsable_nom: atelier?.responsable_nom || f.responsable_nom });
                }}
                onCreated={(v) => setAteliers((prev) => [...prev, v])}
              />
              <label>
                Date de lancement
                <input type="date" value={f.date_lancement} onChange={set("date_lancement")} />
              </label>
              <label>
                Date limite de production
                <input type="date" min={f.date_lancement} value={f.date_fin_prevue} onChange={set("date_fin_prevue")} />
              </label>
              <label>
                Étape actuelle
                <select value={f.etape_id} onChange={(e) => setF({ ...f, etape_id: Number(e.target.value) })}>
                  {etapes.map((s) => (
                    <option key={s.id} value={s.id}>{s.libelle}{s.optionnelle ? " (optionnelle)" : ""}</option>
                  ))}
                </select>
              </label>
              <label>
                Priorité
                <select value={f.priorite} onChange={set("priorite")}>
                  {Object.entries(PRIORITE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>

              {isLocked ? (
                <div className="span-2">
                  <label style={{ marginBottom: 6, display: "block" }}>Répartition couleurs × tailles (verrouillée)</label>
                  <RepartitionTable lignes={existing?.lignes ?? []} />
                </div>
              ) : (
                <SizeColorGrid
                  couleurs={couleursVisibles}
                  tailles={taillesVisibles}
                  initialLignes={existing?.lignes ?? []}
                  onChange={(lignes) => setF((prev) => ({ ...prev, lignes }))}
                />
              )}

              <label className="span-2">
                Commentaire (optionnel)
                <textarea rows={2} value={f.commentaires ?? ""} onChange={set("commentaires")} placeholder="Précision utile pour l'atelier..." />
              </label>
            </div>
          </>
        )}

        {error && <p className="hint" style={{ background: "#FBEAE6", color: "#7A2818", padding: "8px 10px", borderRadius: 8, marginTop: 10 }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={submitting}>Annuler</button>
          {selectedArticle && (
            <button className="btn primary" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Enregistrement..." : existing ? "Enregistrer les modifications" : "Enregistrer le brouillon"}
            </button>
          )}
        </div>
      </div>

      {showCreateArticle && (
        <ArticleForm
          onCancel={() => setShowCreateArticle(false)}
          onCreated={(article) => {
            setShowCreateArticle(false);
            setArticles((prev) => [...prev, article]);
            setSelectedArticle(article);
          }}
        />
      )}
    </div>
  );
}
