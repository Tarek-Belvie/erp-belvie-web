import { useEffect, useState } from "react";
import { Article, ListeValeur } from "../../shared/types";
import QuickAddSelect from "../commandes/QuickAddSelect";

interface Props {
  onCancel: () => void;
  onCreated: (article: Article) => void;
  /** Present = mode EDITION. Absent = creation, comportement inchange. */
  article?: Article;
  /** Present = CREATION prereglee depuis un article existant (duplication). */
  duplication?: any;
}

function suggestAbreviation(nom: string): string {
  const cleaned = nom
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z]/g, "")
    .toUpperCase();
  return cleaned.slice(0, 3) || "ART";
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 1 + i);

export default function ArticleForm({ onCancel, onCreated, article, duplication }: Props) {
  const edition = !!article;
  const [categories, setCategories] = useState<ListeValeur[]>([]);
  const [categorieId, setCategorieId] = useState<number | undefined>();
  const [designation, setDesignation] = useState(article?.designation ?? duplication?.designation ?? "");
  const [nouvelleCategorie, setNouvelleCategorie] = useState<string | null>(null);
  const [nouveauType, setNouveauType] = useState<string | null>(null);
  const [reference, setReference] = useState(article?.reference_principale ?? "");
  const [confirmRef, setConfirmRef] = useState<any>(null);
  const [produits, setProduits] = useState<ListeValeur[]>([]);
  const [saisons, setSaisons] = useState<ListeValeur[]>([]);
  const [rayons, setRayons] = useState<ListeValeur[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [produitId, setProduitId] = useState<number | undefined>(article?.produit_id ?? duplication?.produit_id ?? undefined);
  const [saisonId, setSaisonId] = useState<number | undefined>(article?.saison_id ?? duplication?.saison_id ?? undefined);
  const [annee, setAnnee] = useState<number>(article?.annee_collection ?? duplication?.annee_collection ?? CURRENT_YEAR);
  const [rayonId, setRayonId] = useState<number | undefined>(article?.rayon_id ?? duplication?.rayon_id ?? undefined);
  const [abreviation, setAbreviation] = useState(article?.abreviation ?? duplication?.abreviation ?? "");
  const [abreviationTouchee, setAbreviationTouchee] = useState(!!article || !!duplication);

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [c, s, r] = await Promise.all([
        window.api.listes.list("categorie"),
        window.api.listes.list("saison"),
        window.api.listes.list("rayon"),
      ]);
      setCategories(c);
      setSaisons(s);
      setRayons(r);
      if (!edition && !duplication) { setSaisonId(s[0]?.id); setRayonId(r[0]?.id); }
      if (duplication?.categorie_id_type) setCategorieId(duplication.categorie_id_type);
      // En edition, la categorie de depart est celle du type de l'article (parent_id).
      if (article && article.produit_id) {
        const tous = await window.api.listes.list("produit", { includeInactive: true });
        const t = tous.find((x: ListeValeur) => x.id === article.produit_id);
        if (t && (t as any).parent_id) setCategorieId((t as any).parent_id);
      }
      // Synchronisation explicite APRES chargement des listes : l'etat interne reprend les
      // valeurs de l'article, et seulement si elles existent reellement dans la liste. Une valeur
      // absente reste vide, donc visible, au lieu d'etre remplacee en douce par la premiere option.
      if (article) {
        if (article.saison_id && s.some((x: ListeValeur) => x.id === article.saison_id)) setSaisonId(article.saison_id);
        if (article.rayon_id && r.some((x: ListeValeur) => x.id === article.rayon_id)) setRayonId(article.rayon_id);
      }
      setLoaded(true);
    }
    load();
  }, []);

  // Les types proposes dependent STRICTEMENT de la categorie choisie : c'est ce qui rend
  // impossible une combinaison incoherente comme « T-shirts et Polos » avec « Jean ».
  useEffect(() => {
    if (categorieId == null) { setProduits([]); return; }
    window.api.listes.list("produit", { parentId: categorieId }).then((p: ListeValeur[]) => {
      setProduits(p);
      if (produitId && !p.some((x) => x.id === produitId)) setProduitId(undefined);
    });
  }, [categorieId]);

  // L'abreviation derive de la DESIGNATION, pas du type : sinon tous les T-shirts porteraient
  // « TSH ». « Sweat Oversize » suggere « SWE », que l'on peut corriger a la main.
  useEffect(() => {
    if (abreviationTouchee || !designation.trim()) return;
    setAbreviation(suggestAbreviation(designation));
  }, [designation, abreviationTouchee]);

  const saison = saisons.find((s) => s.id === saisonId);
  const rayon = rayons.find((r) => r.id === rayonId);
  const preview = saison && rayon && abreviation
    ? `${saison.code}${String(annee).slice(-2)}-${rayon.code}-${abreviation}-XX`
    : null;

  // Etape 1 du changement de reference : on interroge le backend SANS rien modifier, pour
  // afficher une confirmation chiffree. Les commandes gardent leur reference_production, qui est
  // un snapshot fige a l'emission — un document deja emis ne se reecrit pas.
  async function handleSubmit() {
    if (edition && reference.trim().toUpperCase() !== String(article!.reference_principale || "").toUpperCase() && !confirmRef) {
      try {
        const v = await window.api.articles.verifierChangementReference(article!.id, reference.trim());
        if (!v.disponible) { setError("La référence « " + v.nouvelle + " » est déjà utilisée par un autre article."); return; }
        setConfirmRef(v);
        return;
      } catch (err: any) { setError(err?.message || "Vérification impossible."); return; }
    }
    return enregistrer();
  }

  async function enregistrer() {
    if (!categorieId) { setError("Sélectionnez une catégorie."); return; }
    if (!produitId) { setError("Sélectionnez un type d'article."); return; }
    if (!designation.trim()) { setError("La désignation est obligatoire."); return; }
    if (!saisonId) { setError("Sélectionnez une saison."); return; }
    if (!rayonId) { setError("Sélectionnez un rayon."); return; }
    if (!abreviation.trim() || abreviation.trim().length < 2) {
      setError("L'abréviation doit contenir de 2 à 5 lettres.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      // En EDITION, articles.update n'appelle jamais la generation de reference : une reference
      // deja attribuee ne peut structurellement pas changer, meme si le type, la designation, la
      // saison ou le rayon sont modifies.
      // La reference n'est envoyee QUE si elle a change : sans cela, un simple changement de
      // type declencherait le controle d'unicite pour rien.
      const refAChange = edition && reference.trim().toUpperCase() !== String(article!.reference_principale || "").toUpperCase();
      const enregistre = edition
        ? await window.api.articles.update(article!.id, Object.assign({
            produit_id: produitId, designation: designation.trim(),
            saison_id: saisonId, annee_collection: annee, rayon_id: rayonId,
          }, refAChange ? { reference_principale: reference.trim() } : {}))
        : await window.api.articles.create({
            produit_id: produitId, designation: designation.trim(),
            saison_id: saisonId, annee_collection: annee, rayon_id: rayonId, abreviation,
          });
      onCreated(enregistre);
    } catch (err: any) {
      setError(err?.message || (edition ? "Erreur lors de l'enregistrement." : "Erreur lors de la création."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-veil">
      {/* Largeur FIXE de la modale : sans elle, la grille se dimensionnait sur son contenu, donc
          la popup changeait de taille selon l'etat des champs. Le placeholder long du Type
          desactive (« — choisissez d'abord une categorie — ») imposait sa largeur a la colonne et
          provoquait le debordement horizontal ; il a ete remplace par un texte court, et
          l'indication a ete deplacee sous le champ ou elle ne contraint plus rien.
          minWidth: 0 sur les conteneurs flex : sans cela un enfant flex refuse de retrecir sous
          la largeur de son contenu, ce qui reproduit le debordement. */}
      <div className="modal" style={{ width: "min(760px, 92vw)", maxWidth: "92vw", boxSizing: "border-box", overflowX: "hidden" }}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">{edition ? "Modifier l'article" : duplication ? "Duplication" : "Nouvel article"}</p>
            <h3>{edition ? (article!.reference_principale || "Article") : duplication ? "Copie de " + (duplication.source?.reference || duplication.source?.designation || "l'article") : "Créer un article"}</h3>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>

        {loaded && (
          <div className="modal-grid" style={{ minWidth: 0 }}>
            {/* Categorie -> Type : le choix se fait toujours dans cet ordre, et le second est
                filtre par le premier via listes_valeurs.parent_id. Seul produit_id (le TYPE) est
                enregistre sur l'article ; la categorie n'est jamais ressaisie ni stockee. */}
            <label>
              Catégorie
              <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
                <select
                  value={categorieId ?? ""}
                  onChange={(e) => { setCategorieId(e.target.value ? Number(e.target.value) : undefined); setProduitId(undefined); }}
                  style={{ flex: 1, minWidth: 0, width: "100%" }}
                >
                  <option value="">— choisir —</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                </select>
                <button type="button" className="btn ghost tiny" title="Nouvelle catégorie" onClick={() => setNouvelleCategorie("")}>+</button>
              </div>
            </label>

            {nouvelleCategorie !== null && (
              <label>
                Nom de la nouvelle catégorie
                <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
                  <input
                    autoFocus value={nouvelleCategorie} style={{ flex: 1, minWidth: 0, width: "100%" }}
                    onChange={(e) => setNouvelleCategorie(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setNouvelleCategorie(null); }}
                  />
                  <button type="button" className="btn tiny" onClick={async () => {
                    const nom = (nouvelleCategorie || "").trim();
                    if (!nom) return;
                    try {
                      const c = await window.api.listes.create("categorie", nom);
                      setCategories((p) => [...p, c]);
                      setCategorieId(c.id);
                      setNouvelleCategorie(null);
                    } catch (err: any) { setError(err?.message || "Création impossible."); }
                  }}>Créer</button>
                  <button type="button" className="btn ghost tiny" onClick={() => setNouvelleCategorie(null)}>Annuler</button>
                </div>
              </label>
            )}

            <label>
              Type d'article
              <div style={{ display: "flex", gap: 6, minWidth: 0 }}>
                <select
                  value={produitId ?? ""}
                  disabled={categorieId == null}
                  onChange={(e) => setProduitId(e.target.value ? Number(e.target.value) : undefined)}
                  style={{ flex: 1, minWidth: 0, width: "100%" }}
                >
                  <option value="">— choisir —</option>
                  {produits.map((p) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                </select>
                <button
                  type="button" className="btn ghost tiny" title="Nouveau type d'article"
                  disabled={categorieId == null} onClick={() => setNouveauType("")}
                >+</button>
              </div>
              {categorieId == null && (
                <span style={{ fontSize: 11.5, color: "#6B6B62" }}>Choisissez d'abord une catégorie.</span>
              )}
            </label>

            {nouveauType !== null && (
              <label>
                Nom du nouveau type d'article
                <div style={{ display: "flex", gap: 6 }}>
                  <input
                    autoFocus value={nouveauType} style={{ flex: 1, minWidth: 0, width: "100%" }}
                    onChange={(e) => setNouveauType(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Escape") setNouveauType(null); }}
                  />
                  <button type="button" className="btn tiny" onClick={async () => {
                    const nom = (nouveauType || "").trim();
                    if (!nom || categorieId == null) return;
                    try {
                      // parent_id : le type nait rattache a sa categorie, jamais orphelin.
                      const t = await window.api.listes.create("produit", nom, { parent_id: categorieId });
                      setProduits((p) => [...p, t]);
                      setProduitId(t.id);
                      setNouveauType(null);
                    } catch (err: any) { setError(err?.message || "Création impossible."); }
                  }}>Créer</button>
                  <button type="button" className="btn ghost tiny" onClick={() => setNouveauType(null)}>Annuler</button>
                </div>
              </label>
            )}

            {/* Designation = nom commercial reel de l'article, distinct du type generique. */}
            {edition && (
              <label>
                Référence principale
                <input
                  value={reference}
                  onChange={(e) => { setReference(e.target.value.toUpperCase()); setConfirmRef(null); }}
                  style={{ width: "100%", minWidth: 0, fontFamily: "var(--v2-font-mono, monospace)" }}
                />
                <span style={{ fontSize: 11.5, color: "#6B6B62" }}>
                  Modifiable uniquement ici. Changer le type, la désignation, la saison ou le rayon ne la modifie jamais.
                </span>
              </label>
            )}

            <label>
              Désignation
              <input
                value={designation}
                placeholder="Sweat Oversize, Pantalon en molleton…"
                onChange={(e) => setDesignation(e.target.value)}
              />
            </label>
            <label>
              Saison
              {/* Meme correction que pour le Rayon : un select non controle masquait l'absence
                  de valeur derriere la premiere option. */}
              <select
                value={saisonId ?? ""}
                onChange={(e) => setSaisonId(e.target.value ? Number(e.target.value) : undefined)}
                style={{ width: "100%", minWidth: 0 }}
              >
                <option value="">— choisir —</option>
                {saisons.map((s) => <option key={s.id} value={s.id}>{s.nom} ({s.code})</option>)}
              </select>
            </label>
            <label>
              Année de collection
              <select value={annee} onChange={(e) => setAnnee(Number(e.target.value))}>
                {YEAR_OPTIONS.map((y) => <option key={y} value={y}>{y}</option>)}
              </select>
            </label>
            <label>
              Rayon
              {/* value={rayonId} tout court rendait le select NON CONTROLE des que rayonId etait
                  undefined : le navigateur affichait alors la premiere option (« Homme »), alors
                  que l'etat interne restait vide — d'ou « Selectionnez un rayon » a l'enregistrement
                  sans que rien ne semble manquer. articles.rayon_id etant nullable, un article
                  ancien peut tres bien n'en avoir aucun.
                  Avec `?? ""` et une option vide explicite, l'absence de valeur devient VISIBLE
                  au lieu d'etre masquee par la premiere option. */}
              <select
                value={rayonId ?? ""}
                onChange={(e) => setRayonId(e.target.value ? Number(e.target.value) : undefined)}
                style={{ width: "100%", minWidth: 0 }}
              >
                <option value="">— choisir —</option>
                {rayons.map((r) => <option key={r.id} value={r.id}>{r.nom} ({r.code})</option>)}
              </select>
            </label>
            <label>
              Abréviation de l'article
              <input
                type="text"
                value={abreviation}
                maxLength={5}
                placeholder="Ex: JEA"
                onChange={(e) => { setAbreviation(e.target.value.toUpperCase().replace(/[^A-Z]/g, "")); setAbreviationTouchee(true); }}
              />
            </label>
            <div>
              <label style={{ marginBottom: 5, display: "block" }}>Référence principale (aperçu)</label>
              <div className="reference-preview">{preview || "—"}</div>
            </div>
          </div>
        )}

        <p className="hint">
          Le numéro séquentiel final (01, 02...) est attribué à la création. La référence, une fois générée, ne change
          plus jamais. Vous pourrez ajouter une photo juste après la création.
        </p>

        {confirmRef && (
          <div style={{ margin: "0 0 12px", padding: 12, border: "1px solid #C2410C", borderRadius: 8, background: "#FEF3EC" }}>
            <p style={{ margin: "0 0 6px", fontSize: 13.5, fontWeight: 600 }}>
              Modifier la référence de {confirmRef.ancienne} vers {confirmRef.nouvelle} ?
            </p>
            {confirmRef.nb_commandes > 0 ? (
              <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--v2-text-2)" }}>
                {confirmRef.nb_commandes} commande{confirmRef.nb_commandes > 1 ? "s" : ""} existante
                {confirmRef.nb_commandes > 1 ? "s" : ""} conservera{confirmRef.nb_commandes > 1 ? "ont" : ""} l'ancienne
                référence <strong>{confirmRef.ancienne}</strong> dans leur référence de production : ce sont des
                snapshots historiques, et les documents déjà émis ne sont jamais réécrits.
              </p>
            ) : (
              <p style={{ margin: "0 0 8px", fontSize: 12.5, color: "var(--v2-text-2)" }}>
                Aucune commande existante pour cet article.
              </p>
            )}
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn ghost tiny" onClick={() => setConfirmRef(null)}>Annuler</button>
              <button className="btn primary tiny" onClick={enregistrer}>Confirmer la modification</button>
            </div>
          </div>
        )}

        {error && <p className="hint" style={{ background: "#FBEAE6", color: "#7A2818", padding: "8px 10px", borderRadius: 8 }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={submitting}>Annuler</button>
          <button className="btn primary" onClick={handleSubmit} disabled={submitting || !loaded}>
            {submitting ? (edition ? "Enregistrement..." : "Création...") : (edition ? "Enregistrer" : "Créer l'article")}
          </button>
        </div>
      </div>
    </div>
  );
}
