import { useState } from "react";
import { Article } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";

interface Props {
  article: Article;
  onChanged: () => void;
}

export default function ArticlePhotoField({ article, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const principale = article.photos.find((p) => p.est_principale) ?? null;

  async function handlePick() {
    setError(null);
    setBusy(true);
    try {
      const res = await window.api.photos.pick();
      if (res.canceled) return;
      if ("error" in res && res.error) { setError(res.error); return; }
      if ("filePath" in res) {
        const nouvellePhoto = await window.api.articles.ajouterPhoto(article.id, res.filePath);
        await window.api.articles.definirPhotoPrincipale(nouvellePhoto.id);
        if (principale) await window.api.articles.retirerPhoto(principale.id);
        onChanged();
      }
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout de la photo.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove() {
    if (!principale) return;
    setBusy(true);
    setError(null);
    try {
      await window.api.articles.retirerPhoto(principale.id);
      onChanged();
    } catch (err: any) {
      setError(err?.message || "Erreur lors du retrait.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
      <div className="photo-preview-box">
        {principale ? (
          <img src={mediaUrl(principale.photo_path)!} alt={article.produit} />
        ) : (
          <span className="photo-preview-empty">Aucune photo</span>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button type="button" className="btn ghost" disabled={busy} onClick={handlePick}>
          {principale ? "Remplacer la photo" : "Ajouter une photo"}
        </button>
        {principale && (
          <button type="button" className="btn ghost" disabled={busy} onClick={handleRemove}>Retirer la photo</button>
        )}
        <p style={{ fontSize: 11.5, color: "#8A8A82", margin: 0 }}>JPG, JPEG, PNG ou WEBP — 10 Mo maximum.</p>
        {error && <p style={{ fontSize: 12, color: "#C0392B", margin: 0 }}>{error}</p>}
      </div>
    </div>
  );
}
