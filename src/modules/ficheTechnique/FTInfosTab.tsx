import { useEffect, useState } from "react";
import { Article, FicheTechnique, ListeValeur } from "../../shared/types";
import QuickAddSelect from "../commandes/QuickAddSelect";
import { mediaUrl } from "../commandes/uiHelpers";

interface Props {
  fiche: FicheTechnique;
  article: Article;
  lectureSeule: boolean;
  onChanged: () => void;
}

export default function FTInfosTab({ fiche, article, lectureSeule, onChanged }: Props) {
  const [notes, setNotes] = useState(fiche.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [coupes, setCoupes] = useState<ListeValeur[]>([]);

  useEffect(() => { window.api.listes.list("coupe").then(setCoupes); }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      await window.api.ficheTechnique.updateNotes(fiche.id, notes || null);
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleCoupeChange(coupeId: number) {
    try {
      await window.api.ficheTechnique.updateCoupe(fiche.id, coupeId);
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement de la coupe.");
    }
  }

  return (
    <div>
      <div className="detail-block">
        <h4>Identité de l'article</h4>
        <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", marginTop: 0 }}>
          Ces informations appartiennent à l'article — elles ne sont jamais ressaisies ici, pour éviter tout risque de désynchronisation.
        </p>
        {/* Carte d'identite : photo a gauche, informations a droite.
            La photo vient de article.photos, la MEME source qu'ArticlesPage — attachee par
            articles.get(). Aucune photo propre a la fiche technique, aucun fichier duplique en
            base. Lecture seule ici : remplacer ou retirer se fait depuis le module Articles. */}
        <div style={{ display: "grid", gridTemplateColumns: "104px 1fr", gap: 18, alignItems: "start" }}>
          {(() => {
            const principale = (article.photos ?? []).find((p: any) => p.est_principale) ?? (article.photos ?? [])[0];
            return principale ? (
              <img
                src={mediaUrl(principale.photo_thumb_path || principale.photo_path)!}
                alt={article.designation || article.produit}
                style={{ width: 104, height: 104, objectFit: "cover", borderRadius: 8, border: "1px solid #E7E9E0", display: "block" }}
              />
            ) : (
              // Emplacement discret, a la MEME taille : le bloc ne change pas de hauteur selon
              // la presence d'une photo.
              <div style={{ width: 104, height: 104, borderRadius: 8, border: "1px dashed #C9CAC0", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11.5, color: "#9A9A90" }}>
                Aucune photo
              </div>
            );
          })()}

          <div className="detail-fields" style={{ minWidth: 0 }}>
            <div className="detail-field"><span className="detail-field-label">Désignation</span><span className="detail-field-value">{article.designation || article.produit}</span></div>
            <div className="detail-field"><span className="detail-field-label">Catégorie</span><span className="detail-field-value">{article.categorie ?? "—"}</span></div>
            <div className="detail-field"><span className="detail-field-label">Type d'article</span><span className="detail-field-value">{article.produit}</span></div>
            <div className="detail-field"><span className="detail-field-label">Référence</span><span className="detail-field-value">{article.reference_principale ?? "—"}</span></div>
            <div className="detail-field"><span className="detail-field-label">Saison</span><span className="detail-field-value">{article.saison ?? "—"}</span></div>
            <div className="detail-field"><span className="detail-field-label">Collection</span><span className="detail-field-value">{article.annee_collection ?? "—"}</span></div>
            <div className="detail-field"><span className="detail-field-label">Genre / Univers</span><span className="detail-field-value">{article.rayon ?? "—"}</span></div>
          </div>
        </div>
      </div>

      <div className="detail-block">
        <h4>Caractéristiques techniques du produit</h4>
        <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", marginTop: 0 }}>
          Ces informations appartiennent à la fiche technique — elles décrivent le produit lui-même, pas son organisation de production.
        </p>
        <div className="detail-fields">
          <div style={{ maxWidth: 260 }}>
            {lectureSeule ? (
              <div className="detail-field"><span className="detail-field-label">Coupe</span><span className="detail-field-value">{fiche.coupe_nom ?? "—"}</span></div>
            ) : (
              <QuickAddSelect
                label="Coupe"
                type="coupe"
                options={coupes}
                value={fiche.coupe_id ?? undefined}
                onChange={handleCoupeChange}
                onCreated={(v) => setCoupes((prev) => [...prev, v])}
              />
            )}
          </div>
          <div className="detail-field">
            <span className="detail-field-label">Matière principale</span>
            <span className="detail-field-value" style={{ color: "var(--v2-text-3)", fontWeight: 400 }}>
              À compléter dans l'onglet Matières (à venir)
            </span>
          </div>
        </div>
      </div>

      <div className="detail-block">
        <h4>Notes générales</h4>
        <textarea
          rows={6}
          style={{ width: "100%", fontFamily: "inherit", fontSize: 13.5 }}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={lectureSeule}
          placeholder="Consignes générales, particularités de fabrication, remarques du bureau d'études..."
        />
        {!lectureSeule && (
          <div style={{ marginTop: 8 }}>
            <button className="btn ghost" onClick={handleSave} disabled={saving}>Enregistrer</button>
          </div>
        )}
      </div>

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}

      {lectureSeule && (
        <p style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>
          Cette fiche est {fiche.statut === "validee" ? "validée" : "archivée"} : les informations générales ne sont plus modifiables.
        </p>
      )}
    </div>
  );
}
