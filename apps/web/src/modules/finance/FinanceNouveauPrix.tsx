import { useEffect, useState } from "react";
import { MatiereCatalogue, AccessoireCatalogue } from "../../shared/types";

interface Props {
  fournisseurId: number;
  onRetour: () => void;
  onEnregistre: () => void;
}

export default function FinanceNouveauPrix({ fournisseurId, onRetour, onEnregistre }: Props) {
  const [type, setType] = useState<"matiere" | "accessoire" | "libre">("matiere");
  const [matieres, setMatieres] = useState<MatiereCatalogue[]>([]);
  const [accessoires, setAccessoires] = useState<AccessoireCatalogue[]>([]);
  const [matiereId, setMatiereId] = useState<number | "">("");
  const [accessoireId, setAccessoireId] = useState<number | "">("");
  const [designationLibre, setDesignationLibre] = useState("");
  const [unite, setUnite] = useState("kg");
  const [prixHt, setPrixHt] = useState<number | "">("");
  const [dateDebut, setDateDebut] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [juisteAjoute, setJusteAjoute] = useState(false);

  useEffect(() => {
    window.api.finance.listMatieresCatalogue().then(setMatieres);
    window.api.ficheTechnique.searchAccessoiresCatalogue("", 200).then(setAccessoires);
  }, []);

  function reinitialiser() {
    setMatiereId(""); setAccessoireId(""); setDesignationLibre(""); setPrixHt("");
  }

  async function soumettre(): Promise<boolean> {
    let designation = designationLibre.trim();
    let matiereCatalogueId: number | undefined;
    let accessoireCatalogueId: number | undefined;
    if (type === "matiere") {
      if (!matiereId) { setError("Sélectionnez une matière."); return false; }
      matiereCatalogueId = matiereId;
      designation = matieres.find((m) => m.id === matiereId)?.nom || "";
    } else if (type === "accessoire") {
      if (!accessoireId) { setError("Sélectionnez un accessoire."); return false; }
      accessoireCatalogueId = accessoireId;
      designation = accessoires.find((a) => a.id === accessoireId)?.nom || "";
    } else if (!designation) { setError("La désignation est obligatoire."); return false; }
    if (prixHt === "" || Number(prixHt) < 0) { setError("Le prix HT est obligatoire."); return false; }

    setError(null);
    await window.api.finance.ajouterPrixFournisseur({
      fournisseur_id: fournisseurId, matiere_catalogue_id: matiereCatalogueId, accessoire_catalogue_id: accessoireCatalogueId,
      designation, unite, prix_ht: Number(prixHt), date_debut_validite: dateDebut,
    });
    return true;
  }

  async function handleEnregistrer() {
    setBusy(true);
    try {
      if (await soumettre()) {
        reinitialiser();
        setJusteAjoute(true);
        setTimeout(() => setJusteAjoute(false), 2000);
      }
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    } finally {
      setBusy(false);
    }
  }
  async function handleEnregistrerEtQuitter() {
    setBusy(true);
    try {
      if (await soumettre()) onEnregistre();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="finance-page-form">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>
      <h2>Nouveau prix d'achat</h2>
      {juisteAjoute && <div className="planning-panel-confirmation">✓ Prix ajouté — vous pouvez en saisir un autre</div>}

      <div className="finance-type-switch" style={{ maxWidth: 420 }}>
        <button className={type === "matiere" ? "active" : ""} onClick={() => setType("matiere")}>Matière</button>
        <button className={type === "accessoire" ? "active" : ""} onClick={() => setType("accessoire")}>Accessoire</button>
        <button className={type === "libre" ? "active" : ""} onClick={() => setType("libre")}>Autre (libre)</button>
      </div>

      {type === "matiere" && (
        <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Matière
          <select value={matiereId} onChange={(e) => setMatiereId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sélectionner...</option>
            {matieres.map((m) => <option key={m.id} value={m.id}>{m.nom}</option>)}
          </select>
        </label>
      )}
      {type === "accessoire" && (
        <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Accessoire
          <select value={accessoireId} onChange={(e) => setAccessoireId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Sélectionner...</option>
            {accessoires.map((a) => <option key={a.id} value={a.id}>{a.nom}</option>)}
          </select>
        </label>
      )}
      {type === "libre" && (
        <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Désignation
          <input type="text" value={designationLibre} onChange={(e) => setDesignationLibre(e.target.value)} placeholder="Composant non catalogué" />
        </label>
      )}

      <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
        <label className="finance-fp-champ">Unité
          <select value={unite} onChange={(e) => setUnite(e.target.value)}>
            <option value="kg">kg</option><option value="m">m</option><option value="piece">pièce</option><option value="lot">lot</option>
          </select>
        </label>
        <label className="finance-fp-champ">Prix HT
          <input type="number" min={0} value={prixHt} onChange={(e) => setPrixHt(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
      </div>
      <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Début de validité
        <input type="date" value={dateDebut} onChange={(e) => setDateDebut(e.target.value)} />
      </label>

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
      <div className="finance-form-actions">
        <button className="btn ghost" onClick={handleEnregistrerEtQuitter} disabled={busy}>Enregistrer et quitter</button>
        <button className="btn primary finance-fp-btn-save" onClick={handleEnregistrer} disabled={busy}>Enregistrer</button>
      </div>
    </div>
  );
}
