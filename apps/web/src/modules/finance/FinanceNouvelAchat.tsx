import { useEffect, useState } from "react";
import { CategorieAchat, CATEGORIES_ACHAT_LABELS, Fournisseur } from "../../shared/types";

const CATEGORIES: CategorieAchat[] = ["matiere", "fourniture", "confection", "impression", "transport", "retouche", "emballage", "autre"];

interface Props {
  fournisseurId?: number; // si fourni, le fournisseur est déjà connu et jamais redemandé
  onRetour: () => void;
  onEnregistre: () => void;
}

export default function FinanceNouvelAchat({ fournisseurId, onRetour, onEnregistre }: Props) {
  const [fournisseurs, setFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurChoisi, setFournisseurChoisi] = useState<number | "">(fournisseurId ?? "");
  const [categorie, setCategorie] = useState<CategorieAchat>("matiere");
  const [designation, setDesignation] = useState("");
  const [quantite, setQuantite] = useState<number | "">("");
  const [unite, setUnite] = useState("kg");
  const [montantEngage, setMontantEngage] = useState<number | "">("");
  const [partageable, setPartageable] = useState(true);
  const [commandeId, setCommandeId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [juisteAjoute, setJusteAjoute] = useState(false);

  useEffect(() => {
    if (!fournisseurId) window.api.finance.listFournisseurs({}).then(setFournisseurs);
  }, [fournisseurId]);

  function reinitialiser() {
    setDesignation(""); setQuantite(""); setMontantEngage(""); setCommandeId("");
  }

  async function soumettre(): Promise<boolean> {
    if (!fournisseurChoisi) { setError("Le fournisseur est obligatoire."); return false; }
    if (!designation.trim()) { setError("La désignation est obligatoire."); return false; }
    if (montantEngage === "" || Number(montantEngage) < 0) { setError("Le montant engagé est obligatoire."); return false; }
    setError(null);
    await window.api.finance.creerAchat({
      fournisseur_id: fournisseurChoisi, categorie, designation: designation.trim(),
      quantite: quantite === "" ? null : Number(quantite), unite: quantite === "" ? null : unite,
      montant_engage: Number(montantEngage), commande_id: !partageable && commandeId ? Number(commandeId) : null,
    });
    return true;
  }

  async function handleEnregistrer() {
    setBusy(true);
    try {
      if (await soumettre()) { reinitialiser(); setJusteAjoute(true); setTimeout(() => setJusteAjoute(false), 2000); }
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }
  async function handleEnregistrerEtQuitter() {
    setBusy(true);
    try {
      if (await soumettre()) onEnregistre();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="finance-page-form">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>
      <h2>Nouvel achat</h2>
      {juisteAjoute && <div className="planning-panel-confirmation">✓ Achat créé — vous pouvez en saisir un autre</div>}

      {!fournisseurId && (
        <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Fournisseur
          <select value={fournisseurChoisi} onChange={(e) => setFournisseurChoisi(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sélectionner...</option>
            {fournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
          </select>
        </label>
      )}

      <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
        <label className="finance-fp-champ">Catégorie
          <select value={categorie} onChange={(e) => setCategorie(e.target.value as CategorieAchat)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORIES_ACHAT_LABELS[c]}</option>)}
          </select>
        </label>
        <label className="finance-fp-champ">Montant engagé (DT)
          <input type="number" min={0} value={montantEngage} onChange={(e) => setMontantEngage(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
      </div>

      <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Désignation
        <input type="text" value={designation} onChange={(e) => setDesignation(e.target.value)} placeholder="ex: Tissu jersey coton" />
      </label>

      <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
        <label className="finance-fp-champ">Quantité (si répartissable)
          <input type="number" min={0} value={quantite} onChange={(e) => setQuantite(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="finance-fp-champ">Unité
          <select value={unite} onChange={(e) => setUnite(e.target.value)}>
            <option value="kg">kg</option><option value="m">m</option><option value="piece">pièce</option><option value="lot">lot</option>
          </select>
        </label>
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, marginBottom: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={partageable} onChange={(e) => setPartageable(e.target.checked)} />
        Achat partageable entre plusieurs productions (affectation à faire ensuite)
      </label>
      {!partageable && (
        <label className="finance-fp-champ" style={{ maxWidth: 420 }}>N° de commande liée (id interne)
          <input type="number" value={commandeId} onChange={(e) => setCommandeId(e.target.value)} />
        </label>
      )}

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
      <div className="finance-form-actions">
        <button className="btn ghost" onClick={handleEnregistrerEtQuitter} disabled={busy}>Enregistrer et quitter</button>
        <button className="btn primary finance-fp-btn-save" onClick={handleEnregistrer} disabled={busy}>Enregistrer</button>
      </div>
    </div>
  );
}
