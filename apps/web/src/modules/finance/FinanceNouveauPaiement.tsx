import { useState } from "react";
import { Fournisseur, FactureFournisseurDetaillee, TypePaiement } from "../../shared/types";
import { useEffect } from "react";

const MODES_PAIEMENT = ["Virement", "Chèque", "Espèces", "Traite", "Autre"];

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

interface Props {
  fournisseurId?: number;
  onRetour: () => void;
  onEnregistre: () => void;
}

export default function FinanceNouveauPaiement({ fournisseurId: fournisseurIdFixe, onRetour, onEnregistre }: Props) {
  const [tousFournisseurs, setTousFournisseurs] = useState<Fournisseur[]>([]);
  const [fournisseurId, setFournisseurId] = useState<number | "">(fournisseurIdFixe ?? "");
  const [fournisseur, setFournisseur] = useState<Fournisseur | null>(null);
  const [type, setType] = useState<TypePaiement>("reglement");
  const [montant, setMontant] = useState<number | "">("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [mode, setMode] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [etape, setEtape] = useState<"saisie" | "affectation">("saisie");
  const [paiementId, setPaiementId] = useState<number | null>(null);
  const [facturesOuvertes, setFacturesOuvertes] = useState<FactureFournisseurDetaillee[]>([]);
  const [affectations, setAffectations] = useState<Record<number, number | "">>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!fournisseurIdFixe) window.api.finance.listFournisseurs({}).then(setTousFournisseurs);
  }, [fournisseurIdFixe]);

  useEffect(() => {
    if (fournisseurId === "") { setFournisseur(null); return; }
    window.api.finance.getFournisseur(fournisseurId).then((f) => { setFournisseur(f); setMode(f.mode_paiement_defaut ?? ""); });
  }, [fournisseurId]);

  async function handleCreerPaiement() {
    if (fournisseurId === "") { setError("Le fournisseur est obligatoire."); return; }
    if (montant === "" || Number(montant) <= 0) { setError("Le montant est obligatoire."); return; }
    setBusy(true);
    setError(null);
    try {
      const p = await window.api.finance.creerPaiement({ fournisseur_id: fournisseurId, type, montant: Number(montant), date_paiement: date, mode: mode || undefined, reference: reference.trim() || undefined, notes: notes.trim() || undefined });
      setPaiementId(p.id);
      const factures = await window.api.finance.listFacturesFournisseur(fournisseurId);
      setFacturesOuvertes(factures.filter((f) => f.reste > 1e-9));
      setEtape("affectation");
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }

  let totalAffecte = 0;
  for (const v of Object.values(affectations)) { if (v !== "") totalAffecte += v; }
  const creditRestant = montant === "" ? 0 : Number(montant) - totalAffecte;

  async function handleAffecter(factureId: number) {
    const val = affectations[factureId];
    if (val === "" || val == null || Number(val) <= 0 || !paiementId || fournisseurId === "") return;
    try {
      await window.api.finance.affecterPaiement({ paiement_id: paiementId, achat_facture_id: factureId, montant_affecte: Number(val) });
      const factures = await window.api.finance.listFacturesFournisseur(fournisseurId);
      setFacturesOuvertes(factures.filter((f) => f.reste > 1e-9));
      setAffectations((prev) => ({ ...prev, [factureId]: "" }));
    } catch (err: any) {
      setError(err?.message || "Affectation refusée.");
    }
  }

  return (
    <div className="finance-page-form">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>
      {etape === "saisie" ? (
        <>
          <h2>Nouveau paiement / avance</h2>

          {!fournisseurIdFixe && (
            <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Fournisseur
              <select value={fournisseurId} onChange={(e) => setFournisseurId(e.target.value ? Number(e.target.value) : "")}>
                <option value="">Sélectionner...</option>
                {tousFournisseurs.map((f) => <option key={f.id} value={f.id}>{f.nom}</option>)}
              </select>
            </label>
          )}

          <div className="finance-type-switch" style={{ maxWidth: 300, marginBottom: 14 }}>
            <button className={type === "reglement" ? "active" : ""} onClick={() => setType("reglement")}>Paiement</button>
            <button className={type === "avance" ? "active" : ""} onClick={() => setType("avance")}>Avance</button>
          </div>
          {type === "avance" && (
            <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "-8px 0 14px" }}>
              Une avance sans facture reste un crédit fournisseur disponible, affectable dès qu'une facture arrive.
            </p>
          )}

          <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
            <label className="finance-fp-champ">Montant
              <input type="number" min={0} value={montant} onChange={(e) => setMontant(e.target.value === "" ? "" : Number(e.target.value))} />
            </label>
            <label className="finance-fp-champ">Date
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="finance-fp-grid-2" style={{ maxWidth: 420 }}>
            <label className="finance-fp-champ">Mode de paiement
              <select value={mode} onChange={(e) => setMode(e.target.value)}>
                <option value="">Non renseigné</option>
                {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{m}</option>)}
              </select>
            </label>
            <label className="finance-fp-champ">Référence
              <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
            </label>
          </div>
          <label className="finance-fp-champ" style={{ maxWidth: 420 }}>Note
            <input type="text" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
          <div className="finance-form-actions">
            <button className="btn primary finance-fp-btn-save" onClick={handleCreerPaiement} disabled={busy}>Continuer</button>
          </div>
        </>
      ) : (
        <>
          <h2>{type === "avance" ? "Avance" : "Paiement"} : {formatMontant(Number(montant))}{fournisseur ? ` — ${fournisseur.nom}` : ""}</h2>
          {facturesOuvertes.length === 0 ? (
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>Aucune facture ouverte pour ce fournisseur — {type === "avance" ? "l'avance" : "le paiement"} reste entièrement en crédit non affecté.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16, maxWidth: 520 }}>
              {facturesOuvertes.map((f) => (
                <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}>
                  <span style={{ flex: 1 }}>{f.reference_facture || f.achat_designation} — reste {formatMontant(f.reste)}</span>
                  <input
                    type="number" min={0} max={f.reste} value={affectations[f.id] ?? ""}
                    onChange={(e) => setAffectations((prev) => ({ ...prev, [f.id]: e.target.value === "" ? "" : Number(e.target.value) }))}
                    style={{ width: 100, border: "1px solid var(--v2-border-strong)", borderRadius: 6, padding: "6px 8px", fontSize: 12.5 }}
                  />
                  <button className="btn ghost tiny" onClick={() => handleAffecter(f.id)}>Affecter</button>
                </div>
              ))}
            </div>
          )}
          <p style={{ fontSize: 13.5, fontWeight: 600, color: creditRestant > 0 ? "var(--v2-warning)" : "var(--v2-green-dark)" }}>
            {creditRestant > 0 ? `Crédit fournisseur non affecté : ${formatMontant(creditRestant)}` : "Crédit restant : 0 DT"}
          </p>
          {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5 }}>{error}</p>}
          <div className="finance-form-actions">
            <button className="btn primary finance-fp-btn-save" onClick={onEnregistre}>Terminer</button>
          </div>
        </>
      )}
    </div>
  );
}
