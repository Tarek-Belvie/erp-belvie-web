import { useEffect, useState } from "react";
import { AchatDetaille, Fournisseur } from "../../shared/types";

interface Props {
  fournisseurId: number;
  onRetour: () => void;
  onEnregistre: () => void;
}

export default function FinanceNouvelleFacture({ fournisseurId, onRetour, onEnregistre }: Props) {
  const [fournisseur, setFournisseur] = useState<Fournisseur | null>(null);
  const [achats, setAchats] = useState<AchatDetaille[]>([]);
  const [achatId, setAchatId] = useState<number | "">("");
  const [reference, setReference] = useState("");
  const [dateFacture, setDateFacture] = useState(new Date().toISOString().slice(0, 10));
  const [montantHt, setMontantHt] = useState<number | "">("");
  const [dateEcheance, setDateEcheance] = useState("");
  const [echeanceModifieeManuellement, setEcheanceModifieeManuellement] = useState(false);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [juisteAjoute, setJusteAjoute] = useState(false);

  useEffect(() => {
    window.api.finance.getFournisseur(fournisseurId).then(setFournisseur).catch((err: any) => setError(err?.message || "Erreur lors du chargement."));
    window.api.finance.listAchatsDetailles({ fournisseurId }).then(setAchats).catch(() => {});
  }, [fournisseurId]);

  useEffect(() => {
    if (!fournisseur || echeanceModifieeManuellement || fournisseur.delai_paiement_jours == null) return;
    window.api.finance.calculerEcheanceSuggeree(dateFacture, fournisseur.delai_paiement_jours, fournisseur.delai_fin_de_mois).then((d) => { if (d) setDateEcheance(d); });
  }, [dateFacture, fournisseur, echeanceModifieeManuellement]);

  function reinitialiser() {
    setReference(""); setMontantHt(""); setNotes(""); setEcheanceModifieeManuellement(false);
  }

  async function soumettre(): Promise<boolean> {
    if (!achatId) { setError("Sélectionnez l'achat concerné."); return false; }
    if (montantHt === "" || Number(montantHt) < 0) { setError("Le montant HT est obligatoire."); return false; }
    setError(null);
    const facture = await window.api.finance.ajouterFactureAchat(achatId, {
      date_facture: dateFacture, montant_ht: Number(montantHt), reference_facture: reference.trim() || undefined,
    });
    if (dateEcheance) {
      await window.api.finance.ajouterEcheance(achatId, {
        date_echeance: dateEcheance, montant: Number(montantHt), achat_facture_id: facture.id, notes: notes.trim() || undefined,
      });
    }
    return true;
  }

  async function handleEnregistrer() {
    setBusy(true);
    try {
      if (await soumettre()) { reinitialiser(); setJusteAjoute(true); setTimeout(() => setJusteAjoute(false), 2000); }
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

  if (error && !fournisseur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {error}</p>;
  if (!fournisseur) return <p className="empty-state">Chargement...</p>;

  return (
    <div className="finance-page-form">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>
      <h2>Nouvelle facture</h2>
      {juisteAjoute && <div className="planning-panel-confirmation">✓ Facture ajoutée — vous pouvez en saisir une autre</div>}

      <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Achat concerné
        <select value={achatId} onChange={(e) => setAchatId(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Sélectionner...</option>
          {achats.map((a) => <option key={a.id} value={a.id}>{a.designation}</option>)}
        </select>
      </label>

      <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
        <label className="finance-fp-champ">N° / Référence facture
          <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
        </label>
        <label className="finance-fp-champ">Date de facture
          <input type="date" value={dateFacture} onChange={(e) => setDateFacture(e.target.value)} />
        </label>
      </div>

      <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
        <label className="finance-fp-champ">Montant HT
          <input type="number" min={0} value={montantHt} onChange={(e) => setMontantHt(e.target.value === "" ? "" : Number(e.target.value))} />
        </label>
        <label className="finance-fp-champ">Date d'échéance
          <input type="date" value={dateEcheance} onChange={(e) => { setDateEcheance(e.target.value); setEcheanceModifieeManuellement(true); }} />
        </label>
      </div>
      {fournisseur.delai_paiement_jours != null && !echeanceModifieeManuellement && dateEcheance && (
        <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "-8px 0 12px" }}>
          Échéance suggérée automatiquement à partir des conditions du fournisseur — modifiable librement pour cette facture.
        </p>
      )}

      <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Note
        <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
      <div className="finance-form-actions">
        <button className="btn ghost" onClick={handleEnregistrerEtQuitter} disabled={busy}>Enregistrer et quitter</button>
        <button className="btn primary finance-fp-btn-save" onClick={handleEnregistrer} disabled={busy}>Enregistrer</button>
      </div>
    </div>
  );
}
