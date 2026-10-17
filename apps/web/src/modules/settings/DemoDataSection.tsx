import { useState } from "react";
import ConfirmDialog from "../commandes/ConfirmDialog";

interface Props {
  onChanged?: () => void;
}

export default function DemoDataSection({ onChanged }: Props) {
  const [confirmLoad, setConfirmLoad] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleLoad() {
    setError(null);
    try {
      const res = await window.api.system.loadDemoData();
      setMessage(`${res.commandes} commande(s) et ${res.articles} article(s) de démonstration chargés.`);
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || "Erreur lors du chargement.");
    } finally {
      setConfirmLoad(false);
    }
  }

  async function handleClear() {
    setError(null);
    try {
      const res = await window.api.system.clearDemoData();
      setMessage(`${res.removed} commande(s) et ${res.articlesRemoved} article(s) de démonstration supprimés.`);
      onChanged?.();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la suppression.");
    } finally {
      setConfirmClear(false);
    }
  }

  return (
    <div className="settings-section">
      <h3>Données de démonstration</h3>
      <p className="desc">
        Un jeu d'exemples complet (produits, couleurs, articles, commandes couvrant tous les statuts) pour découvrir
        l'application. Une installation vierge n'en contient aucune par défaut.
      </p>
      <div className="settings-actions">
        <button className="btn ghost" onClick={() => setConfirmLoad(true)}>Charger les données de démonstration</button>
        <button className="btn danger" onClick={() => setConfirmClear(true)}>Supprimer les données de démonstration</button>
      </div>
      {message && <p style={{ color: "#2E7D46", fontSize: 12.5, marginTop: 8 }}>{message}</p>}
      {error && <p style={{ color: "#C0392B", fontSize: 12.5, marginTop: 8 }}>{error}</p>}

      {confirmLoad && (
        <ConfirmDialog
          title="Charger les données de démonstration ?"
          message="Ceci ajoute des produits, couleurs, articles et commandes d'exemple. Impossible si de vraies commandes existent déjà dans cette base."
          confirmLabel="Charger"
          onConfirm={handleLoad}
          onCancel={() => setConfirmLoad(false)}
        />
      )}
      {confirmClear && (
        <ConfirmDialog
          title="Supprimer les données de démonstration ?"
          message="Toutes les commandes et articles marqués comme démonstration seront supprimés définitivement. Vos vraies commandes ne sont pas concernées. Cette action est irréversible."
          confirmLabel="Supprimer définitivement"
          danger
          onConfirm={handleClear}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </div>
  );
}
