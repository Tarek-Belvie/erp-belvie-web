import { useEffect, useState } from "react";
import { Article, ListeValeur } from "../../shared/types";

interface Props {
  article: Article;
  onCancel: () => void;
  onCompleted: (article: Article) => void;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = Array.from({ length: 7 }, (_, i) => CURRENT_YEAR - 1 + i);

export default function CompleterReferenceForm({ article, onCancel, onCompleted }: Props) {
  const [saisons, setSaisons] = useState<ListeValeur[]>([]);
  const [rayons, setRayons] = useState<ListeValeur[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [saisonId, setSaisonId] = useState<number | undefined>();
  const [annee, setAnnee] = useState<number>(CURRENT_YEAR);
  const [rayonId, setRayonId] = useState<number | undefined>();
  const [abreviation, setAbreviation] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function load() {
      const [s, r] = await Promise.all([window.api.listes.list("saison"), window.api.listes.list("rayon")]);
      setSaisons(s);
      setRayons(r);
      setSaisonId(s[0]?.id);
      setRayonId(r[0]?.id);
      setLoaded(true);
    }
    load();
  }, []);

  const saison = saisons.find((s) => s.id === saisonId);
  const rayon = rayons.find((r) => r.id === rayonId);
  const preview = saison && rayon && abreviation
    ? `${saison.code}${String(annee).slice(-2)}-${rayon.code}-${abreviation}-XX`
    : null;

  async function handleSubmit() {
    if (!saisonId) { setError("Sélectionnez une saison."); return; }
    if (!rayonId) { setError("Sélectionnez un rayon."); return; }
    if (!abreviation.trim() || abreviation.trim().length < 2) {
      setError("L'abréviation doit contenir de 2 à 5 lettres.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await window.api.articles.completerReference(article.id, {
        saison_id: saisonId, annee_collection: annee, rayon_id: rayonId, abreviation,
      });
      onCompleted(updated);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la génération.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-veil">
      <div className="modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Article migré — {article.produit}</p>
            <h3>Compléter et générer la référence</h3>
          </div>
          <button className="icon-btn" onClick={onCancel} aria-label="Fermer">✕</button>
        </div>

        <p className="hint" style={{ marginBottom: 14 }}>
          Cet article provient d'une ancienne version de l'application et n'a pas encore de référence principale.
          Une fois générée, elle ne pourra plus jamais être modifiée.
        </p>

        {loaded && (
          <div className="modal-grid">
            <label>
              Saison
              <select value={saisonId} onChange={(e) => setSaisonId(Number(e.target.value))}>
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
              <select value={rayonId} onChange={(e) => setRayonId(Number(e.target.value))}>
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
                onChange={(e) => setAbreviation(e.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
              />
            </label>
            <div className="span-2">
              <label style={{ marginBottom: 5, display: "block" }}>Référence principale (aperçu)</label>
              <div className="reference-preview">{preview || "—"}</div>
            </div>
          </div>
        )}

        {error && <p className="hint" style={{ background: "#FBEAE6", color: "#7A2818", padding: "8px 10px", borderRadius: 8 }}>{error}</p>}

        <div className="modal-actions">
          <button className="btn ghost" onClick={onCancel} disabled={submitting}>Annuler</button>
          <button className="btn primary" onClick={handleSubmit} disabled={submitting || !loaded}>
            {submitting ? "Génération..." : "Générer la référence"}
          </button>
        </div>
      </div>
    </div>
  );
}
