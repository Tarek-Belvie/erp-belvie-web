import { useEffect, useState } from "react";
import { PosteCoutPredefini, CategorieEstimation, CATEGORIES_ESTIMATION_LABELS, ModeCalculEstimation } from "../../shared/types";

const CATEGORIES: CategorieEstimation[] = ["matiere", "fourniture", "habillage", "emballage", "transport", "confection", "impression", "retouche", "autre"];
const MODES_LABELS: Record<ModeCalculEstimation, string> = {
  consommation_prix: "Consommation × prix", unitaire_direct: "Coût direct / pièce", montant_global: "Montant global",
};

// Référentiel des habitudes de calcul PROPRES à l'utilisateur (étiquette marque, transport, façon...)
// — jamais un catalogue fournisseur : aucun prix, aucune quantité de centaines de références.
export default function PostesCoutSection() {
  const [postes, setPostes] = useState<PosteCoutPredefini[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showAjouter, setShowAjouter] = useState(false);

  async function refresh() {
    setPostes(await window.api.finance.listPostesCout({}));
    setLoaded(true);
  }
  useEffect(() => { refresh(); }, []);

  async function handleSupprimer(id: number) {
    await window.api.finance.supprimerPosteCout(id);
    refresh();
  }

  async function handleToggleAuto(p: PosteCoutPredefini) {
    await window.api.finance.mettreAJourPosteCout(p.id, { ajouter_automatiquement: p.ajouter_automatiquement ? 0 : 1 });
    refresh();
  }

  if (!loaded) return null;

  return (
    <div className="settings-section">
      <h3>Postes de coût</h3>
      <p className="desc">
        Vos habitudes de calcul récurrentes (étiquettes, emballage, transport, façon...) — pas un catalogue fournisseur. Un poste coché "Ajouter automatiquement" génère sa ligne dès la création de chaque nouvelle estimation ; les autres restent disponibles via "+ Ajouter un élément" pour les cas exceptionnels. Le taux de TVA vient toujours du profil entreprise au moment de la création.
      </p>

      <div style={{ display: "flex", justifyContent: "flex-end", margin: "12px 0" }}>
        <button className="btn ghost tiny" onClick={() => setShowAjouter(true)}>+ Ajouter un poste</button>
      </div>

      {postes.length === 0 ? (
        <p className="empty-state">Aucun poste enregistré pour l'instant.</p>
      ) : (
        <div className="finance-tableau">
          <table className="grid-table">
            <thead>
              <tr><th style={{ textAlign: "left" }}>Désignation</th><th style={{ textAlign: "left" }}>Catégorie</th><th style={{ textAlign: "left" }}>Mode</th><th>Unité</th><th>Qté</th><th>Auto.</th><th></th></tr>
            </thead>
            <tbody>
              {postes.map((p) => (
                <tr key={p.id}>
                  <td className="grid-row-label">{p.designation}</td>
                  <td>{CATEGORIES_ESTIMATION_LABELS[p.categorie]}</td>
                  <td>{MODES_LABELS[p.mode_calcul_defaut]}</td>
                  <td>{p.unite_defaut || "—"}</td>
                  <td>{p.quantite_defaut ?? "—"}</td>
                  <td>
                    <input type="checkbox" checked={!!p.ajouter_automatiquement} onChange={() => handleToggleAuto(p)} title="Ajouter automatiquement aux nouvelles estimations" />
                  </td>
                  <td><button className="icon-btn" onClick={() => handleSupprimer(p.id)} title="Supprimer" aria-label="Supprimer">✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAjouter && (
        <AjouterPosteModal onClose={() => setShowAjouter(false)} onAjoute={() => { setShowAjouter(false); refresh(); }} />
      )}
    </div>
  );
}

function AjouterPosteModal({ onClose, onAjoute }: { onClose: () => void; onAjoute: () => void }) {
  const [categorie, setCategorie] = useState<CategorieEstimation>("habillage");
  const [designation, setDesignation] = useState("");
  const [modeCalcul, setModeCalcul] = useState<ModeCalculEstimation>("consommation_prix");
  const [unite, setUnite] = useState("piece");
  const [quantite, setQuantite] = useState<number | "">(1);
  const [ajouterAuto, setAjouterAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleCreer() {
    if (!designation.trim()) { setError("La désignation est obligatoire."); return; }
    setBusy(true);
    setError(null);
    try {
      await window.api.finance.creerPosteCout({
        categorie, designation: designation.trim(), mode_calcul_defaut: modeCalcul,
        unite_defaut: modeCalcul !== "montant_global" ? unite : null,
        quantite_defaut: modeCalcul !== "montant_global" && quantite !== "" ? quantite : null,
        ajouter_automatiquement: ajouterAuto ? 1 : 0,
      });
      onAjoute();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Nouveau poste de coût</h3></div>

        <label className="finance-fp-champ">Désignation
          <input type="text" autoFocus value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="ex: Étiquette marque" />
        </label>

        <div className="finance-fp-grid-2">
          <label className="finance-fp-champ">Catégorie
            <select value={categorie} onChange={(e) => setCategorie(e.target.value as CategorieEstimation)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORIES_ESTIMATION_LABELS[c]}</option>)}
            </select>
          </label>
          <label className="finance-fp-champ">Mode de calcul
            <select value={modeCalcul} onChange={(e) => setModeCalcul(e.target.value as ModeCalculEstimation)}>
              {(["consommation_prix", "unitaire_direct", "montant_global"] as ModeCalculEstimation[]).map((m) => <option key={m} value={m}>{MODES_LABELS[m]}</option>)}
            </select>
          </label>
        </div>

        {modeCalcul !== "montant_global" && (
          <div className="finance-fp-grid-2">
            <label className="finance-fp-champ">Unité par défaut
              <select value={unite} onChange={(e) => setUnite(e.target.value)}>
                <option value="kg">kg</option><option value="m">m</option><option value="piece">pièce</option><option value="lot">lot</option>
              </select>
            </label>
            <label className="finance-fp-champ">Quantité par défaut
              <input type="number" step={unite === "piece" ? "1" : "0.01"} value={quantite} onChange={(e) => setQuantite(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
          </div>
        )}

        {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, margin: "4px 0 14px", cursor: "pointer" }}>
          <input type="checkbox" checked={ajouterAuto} onChange={(e) => setAjouterAuto(e.target.checked)} />
          Ajouter automatiquement aux nouvelles estimations
        </label>
        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose} disabled={busy}>Annuler</button>
          <button className="btn primary" onClick={handleCreer} disabled={busy}>Créer</button>
        </div>
      </div>
    </div>
  );
}
