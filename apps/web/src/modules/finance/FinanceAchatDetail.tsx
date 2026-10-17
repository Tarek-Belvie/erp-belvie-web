import { useEffect, useState } from "react";
import { Achat, AchatReception, AchatFacture, AchatAffectation, Echeance, CoutAchatResultat, CATEGORIES_ACHAT_LABELS, CategorieAchat } from "../../shared/types";
import { labelJour } from "../../shared/dateLabels";

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

interface Props {
  achatId: number;
  onRetour: () => void;
}

export default function FinanceAchatDetail({ achatId, onRetour }: Props) {
  const [achat, setAchat] = useState<Achat | null>(null);
  const [cout, setCout] = useState<CoutAchatResultat | null>(null);
  const [receptions, setReceptions] = useState<AchatReception[]>([]);
  const [factures, setFactures] = useState<AchatFacture[]>([]);
  const [affectations, setAffectations] = useState<(AchatAffectation & { cout_suivi?: number })[]>([]);
  const [echeances, setEcheances] = useState<Echeance[]>([]);
  const [disponible, setDisponible] = useState<number | null>(null);
  const [paye, setPaye] = useState(0);

  const [showFacture, setShowFacture] = useState(false);
  const [showReception, setShowReception] = useState(false);
  const [showEcheance, setShowEcheance] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  async function refresh() {
    try {
      const [a, c, r, f, aff, e, d] = await Promise.all([
        window.api.finance.getAchat(achatId),
        window.api.finance.coutAchat(achatId),
        window.api.finance.listReceptionsAchat(achatId),
        window.api.finance.listFacturesAchat(achatId),
        window.api.finance.listAffectationsAchat(achatId),
        window.api.finance.listEcheances({}),
        window.api.finance.quantiteDisponibleAchat(achatId),
      ]);
      setAchat(a); setCout(c); setReceptions(r); setFactures(f); setDisponible(d);
      setEcheances(e.filter((ech) => ech.achat_id === achatId));

      const affEnrichies = await Promise.all(aff.map(async (x) => {
        const cx = await window.api.finance.coutAffectation(x.id);
        return { ...x, cout_suivi: cx.cout_suivi };
      }));
      setAffectations(affEnrichies);

      const totalPaye = (await Promise.all(f.map((fac) => window.api.finance.statutFacture(fac.id)))).reduce((s, st) => s + st.paye, 0);
      setPaye(totalPaye);
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    }
  }
  useEffect(() => { refresh(); }, [achatId]);

  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;
  if (!achat || !cout) return <p className="empty-state">Chargement...</p>;

  const quantiteRecue = receptions.reduce((s, r) => s + (r.quantite_recue || 0), 0);
  const resteAPayer = Math.max(0, cout.facture_reel - paye);

  return (
    <div className="finance-fournisseur-page">
      <button className="finance-retour" onClick={onRetour}>← Retour</button>

      <div className="finance-fp-header">
        <h2>{achat.designation}</h2>
        <div style={{ fontSize: 12.5, color: "var(--v2-text-3)", marginTop: 4 }}>
          {CATEGORIES_ACHAT_LABELS[achat.categorie as CategorieAchat]}
          {achat.quantite != null && ` · ${achat.quantite} ${achat.unite}`}
        </div>
      </div>

      <div className="finance-fp-body-large">
        <div className="finance-resume-achat">
          <div><span>Engagé</span><strong>{formatMontant(achat.montant_engage)}</strong></div>
          <div><span>Réceptionné</span><strong>{achat.quantite != null ? `${quantiteRecue} ${achat.unite}` : "—"}</strong></div>
          <div><span>Facturé</span><strong>{formatMontant(cout.facture_reel)}</strong></div>
          <div><span>Payé</span><strong>{formatMontant(paye)}</strong></div>
          <div><span>Reste à payer</span><strong style={{ color: resteAPayer > 0 ? "var(--v2-danger)" : "var(--v2-green-dark)" }}>{formatMontant(resteAPayer)}</strong></div>
          {cout.provisoire_restant > 0 && (
            <div><span>Provisoire restant</span><strong style={{ color: "var(--v2-warning)" }}>{formatMontant(cout.provisoire_restant)}</strong></div>
          )}
        </div>

        <div className="finance-panel-section">
          <div className="finance-panel-section-titre">
            Réceptions
            <button className="btn ghost tiny" onClick={() => setShowReception((v) => !v)}>{showReception ? "Annuler" : "+ Ajouter"}</button>
          </div>
          {showReception && <ReceptionInline achatId={achatId} unite={achat.unite} onAdded={() => { setShowReception(false); refresh(); }} />}
          {receptions.map((r) => (
            <div key={r.id} className="finance-ligne-simple">
              <span>{labelJour(r.date_reception)}</span>
              <span>{r.quantite_recue != null ? `${r.quantite_recue} ${achat.unite || ""}` : "—"}</span>
            </div>
          ))}
          {receptions.length === 0 && !showReception && <p className="finance-vide">Aucune réception enregistrée.</p>}
        </div>

        <div className="finance-panel-section">
          <div className="finance-panel-section-titre">
            Factures
            <button className="btn ghost tiny" onClick={() => setShowFacture((v) => !v)}>{showFacture ? "Annuler" : "+ Ajouter"}</button>
          </div>
          {showFacture && <FactureInline achatId={achatId} onAdded={() => { setShowFacture(false); refresh(); }} />}
          {factures.map((f) => (
            <div key={f.id} className="finance-ligne-simple">
              <span>{f.reference_facture || `Facture du ${labelJour(f.date_facture)}`}</span>
              <span>{formatMontant(f.montant_ht)}</span>
            </div>
          ))}
          {factures.length === 0 && !showFacture && <p className="finance-vide">Aucune facture — coût suivi basé sur l'engagement (provisoire).</p>}
        </div>

        <div className="finance-panel-section">
          <div className="finance-panel-section-titre">
            Échéances
            <button className="btn ghost tiny" onClick={() => setShowEcheance((v) => !v)}>{showEcheance ? "Annuler" : "+ Ajouter"}</button>
          </div>
          {showEcheance && <EcheanceInline achatId={achatId} onAdded={() => { setShowEcheance(false); refresh(); }} />}
          {echeances.map((e) => (
            <div key={e.id} className="finance-ligne-simple">
              <span>{labelJour(e.date_echeance)}</span>
              <span>{formatMontant(e.montant)}</span>
            </div>
          ))}
          {echeances.length === 0 && !showEcheance && <p className="finance-vide">Aucune échéance définie.</p>}
        </div>

        {achat.quantite != null && !achat.commande_id && (
          <div className="finance-panel-section">
            <div className="finance-panel-section-titre">Affectation aux productions</div>
            <p style={{ fontSize: 12.5, color: "var(--v2-text-2)", margin: "0 0 8px" }}>
              Quantité achetée : <strong>{achat.quantite} {achat.unite}</strong> — Affectée : <strong>{(achat.quantite - (disponible ?? 0)).toFixed(2)} {achat.unite}</strong> — Disponible : <strong style={{ color: "var(--v2-green-dark)" }}>{disponible?.toFixed(2)} {achat.unite}</strong>
            </p>
            {affectations.map((a) => (
              <div key={a.id} className="finance-ligne-simple">
                <span>Production #{a.commande_id}</span>
                <span>{a.quantite_affectee} {achat.unite} · {a.cout_suivi != null ? formatMontant(a.cout_suivi) : "—"}</span>
              </div>
            ))}
            {affectations.length === 0 && <p className="finance-vide">Aucune affectation pour l'instant.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// Trois petits blocs dépliables en ligne — aucune fenêtre superposée, conformément à la règle
// générale du module (aucun pop-up ni panneau métier, quelle que soit la taille du formulaire).
function ReceptionInline({ achatId, unite, onAdded }: { achatId: number; unite: string | null; onAdded: () => void }) {
  const [quantite, setQuantite] = useState<number | "">("");
  async function handleAjouter() {
    await window.api.finance.ajouterReceptionAchat(achatId, { quantite_recue: quantite === "" ? undefined : Number(quantite) });
    onAdded();
  }
  return (
    <div className="finance-inline-form">
      <label className="finance-fp-champ" style={{ maxWidth: 220 }}>Quantité reçue {unite ? `(${unite})` : ""}
        <input type="number" value={quantite} onChange={(e) => setQuantite(e.target.value === "" ? "" : Number(e.target.value))} />
      </label>
      <button className="btn primary tiny" onClick={handleAjouter}>Ajouter</button>
    </div>
  );
}

function FactureInline({ achatId, onAdded }: { achatId: number; onAdded: () => void }) {
  const [montant, setMontant] = useState<number | "">("");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function handleAjouter() {
    if (montant === "" || Number(montant) < 0) { setError("Le montant HT est obligatoire."); return; }
    try {
      await window.api.finance.ajouterFactureAchat(achatId, { montant_ht: Number(montant), reference_facture: reference.trim() || undefined });
      onAdded();
    } catch (err: any) { setError(err?.message || "Erreur."); }
  }
  return (
    <div className="finance-inline-form">
      <label className="finance-fp-champ" style={{ maxWidth: 160 }}>Montant HT
        <input type="number" value={montant} onChange={(e) => setMontant(e.target.value === "" ? "" : Number(e.target.value))} />
      </label>
      <label className="finance-fp-champ" style={{ maxWidth: 200 }}>Référence
        <input type="text" value={reference} onChange={(e) => setReference(e.target.value)} />
      </label>
      <button className="btn primary tiny" onClick={handleAjouter}>Ajouter</button>
      {error && <p style={{ color: "var(--v2-danger)", fontSize: 11.5, width: "100%" }}>{error}</p>}
    </div>
  );
}

function EcheanceInline({ achatId, onAdded }: { achatId: number; onAdded: () => void }) {
  const [date, setDate] = useState("");
  const [montant, setMontant] = useState<number | "">("");
  const [error, setError] = useState<string | null>(null);
  async function handleAjouter() {
    if (!date) { setError("La date d'échéance est obligatoire."); return; }
    if (montant === "" || Number(montant) <= 0) { setError("Le montant est obligatoire."); return; }
    try {
      await window.api.finance.ajouterEcheance(achatId, { date_echeance: date, montant: Number(montant) });
      onAdded();
    } catch (err: any) { setError(err?.message || "Erreur."); }
  }
  return (
    <div className="finance-inline-form">
      <label className="finance-fp-champ" style={{ maxWidth: 160 }}>Date d'échéance
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="finance-fp-champ" style={{ maxWidth: 140 }}>Montant
        <input type="number" value={montant} onChange={(e) => setMontant(e.target.value === "" ? "" : Number(e.target.value))} />
      </label>
      <button className="btn primary tiny" onClick={handleAjouter}>Ajouter</button>
      {error && <p style={{ color: "var(--v2-danger)", fontSize: 11.5, width: "100%" }}>{error}</p>}
    </div>
  );
}
