import { useEffect, useState } from "react";
import { Fournisseur, PrixFournisseur, AchatDetaille, FactureFournisseurDetaillee, Paiement, DetteFournisseur, StatutFactureFournisseur } from "../../shared/types";
import { labelJour } from "../../shared/dateLabels";

type Onglet = "infos" | "prix" | "achats" | "factures" | "paiements";

const DELAIS_PRESET = [
  { valeur: 0, label: "Comptant" }, { valeur: 7, label: "7 jours" }, { valeur: 15, label: "15 jours" },
  { valeur: 30, label: "30 jours" }, { valeur: 45, label: "45 jours" }, { valeur: 60, label: "60 jours" }, { valeur: 90, label: "90 jours" },
];
const MODES_PAIEMENT = ["Virement", "Chèque", "Espèces", "Traite", "Autre"];

const FACTURE_STATUT_LABELS: Record<StatutFactureFournisseur, string> = { payee: "Payée", partiel: "Partiel", en_retard: "En retard", a_payer: "À payer" };
const FACTURE_STATUT_COULEURS: Record<StatutFactureFournisseur, string> = { payee: "var(--v2-green-dark)", partiel: "var(--v2-warning)", en_retard: "var(--v2-danger)", a_payer: "var(--v2-text-2)" };

function formatMontant(n: number): string {
  return n.toLocaleString("fr-FR", { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + " DT";
}

interface Props {
  fournisseurId: number;
  onOuvrirForm: (form: "prix" | "achat" | "facture" | "paiement") => void;
  onOuvrirAchat: (achatId: number) => void;
  onRetourListe: () => void;
}

export default function FinanceFournisseurDetail({ fournisseurId, onOuvrirForm, onOuvrirAchat, onRetourListe }: Props) {
  const [onglet, setOnglet] = useState<Onglet>("infos");
  const [fournisseur, setFournisseur] = useState<Fournisseur | null>(null);
  const [dette, setDette] = useState<DetteFournisseur | null>(null);
  const [prochaineEcheance, setProchaineEcheance] = useState<string | null>(null);
  const [prix, setPrix] = useState<PrixFournisseur[]>([]);
  const [achats, setAchats] = useState<AchatDetaille[]>([]);
  const [factures, setFactures] = useState<FactureFournisseurDetaillee[]>([]);
  const [paiements, setPaiements] = useState<Paiement[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);

  async function chargerBase() {
    try {
      const [f, d, liste] = await Promise.all([
        window.api.finance.getFournisseur(fournisseurId),
        window.api.finance.detteFournisseur(fournisseurId),
        window.api.finance.listFournisseursAvecSynthese({}),
      ]);
      setFournisseur(f);
      setDette(d);
      setProchaineEcheance(liste.find((x) => x.id === fournisseurId)?.prochaine_echeance ?? null);
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    }
  }
  useEffect(() => { chargerBase(); }, [fournisseurId]);

  async function chargerOnglet() {
    try {
      if (onglet === "prix") setPrix(await window.api.finance.listPrixFournisseur(fournisseurId, { includeHistorique: true }));
      if (onglet === "achats") setAchats(await window.api.finance.listAchatsDetailles({ fournisseurId }));
      if (onglet === "factures") setFactures(await window.api.finance.listFacturesFournisseur(fournisseurId));
      if (onglet === "paiements") setPaiements(await window.api.finance.listPaiementsFournisseur(fournisseurId));
    } catch (err: any) {
      setErreur(err?.message || "Erreur lors du chargement.");
    }
  }
  useEffect(() => { chargerOnglet(); }, [onglet, fournisseurId]);

  async function handleChange() { await chargerBase(); await chargerOnglet(); }

  if (erreur) return <p className="empty-state" style={{ color: "var(--v2-danger)" }}>Erreur : {erreur}</p>;
  if (!fournisseur || !dette) return <p className="empty-state">Chargement...</p>;

  return (
    <div className="finance-fournisseur-page">
      <button className="finance-retour" onClick={onRetourListe}>← Retour à la liste</button>

      <div className="finance-fp-header">
        <h2>{fournisseur.nom}</h2>
        <span className={`finance-statut-pastille ${dette.dette_restante > 0 ? "dette" : "ok"}`}>
          {dette.dette_restante > 0 ? "Dette en cours" : "À jour"}
        </span>
        <div className="finance-fp-header-resume">
          <span>Reste dû : <strong>{formatMontant(dette.dette_restante)}</strong></span>
          <span className="finance-fp-header-sep" />
          <span>Prochaine échéance : <strong>{prochaineEcheance ? labelJour(prochaineEcheance) : "—"}</strong></span>
        </div>
      </div>

      <div className="finance-onglets-panel" style={{ maxWidth: 480, margin: "0 0 22px" }}>
        {(["infos", "prix", "achats", "factures", "paiements"] as Onglet[]).map((o) => (
          <button key={o} className={onglet === o ? "active" : ""} onClick={() => setOnglet(o)}>
            {o === "infos" ? "Infos" : o === "prix" ? "Prix d'achat" : o === "achats" ? "Achats" : o === "factures" ? "Factures" : "Paiements"}
          </button>
        ))}
      </div>

      <div className="finance-fp-body-large">
        {onglet === "infos" && (
          <OngletInfos fournisseur={fournisseur} dette={dette} onSaved={handleChange} onSavedAndClose={async () => { await handleChange(); onRetourListe(); }} />
        )}

        {onglet === "prix" && (
          <>
            <div className="finance-fp-onglet-action">
              <button className="btn primary tiny" onClick={() => onOuvrirForm("prix")}>+ Ajouter un prix</button>
            </div>
            {prix.length === 0 ? (
              <p className="empty-state">Aucun prix d'achat enregistré.</p>
            ) : (
              <div className="finance-tableau">
                <table className="grid-table">
                  <thead><tr><th style={{ textAlign: "left" }}>Composant</th><th>Unité</th><th>Prix HT</th><th>Début</th><th>Statut</th></tr></thead>
                  <tbody>
                    {prix.map((p) => (
                      <tr key={p.id}>
                        <td className="grid-row-label">{p.designation}</td>
                        <td>{p.unite}</td>
                        <td>{formatMontant(p.prix_ht)}</td>
                        <td>{labelJour(p.date_debut_validite)}</td>
                        <td>{p.date_fin_validite ? <span style={{ color: "var(--v2-text-3)" }}>Historique</span> : <span style={{ color: "var(--v2-green-dark)" }}>● En vigueur</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {onglet === "achats" && (
          <>
            <div className="finance-fp-onglet-action">
              <button className="btn primary tiny" onClick={() => onOuvrirForm("achat")}>+ Nouvel achat</button>
            </div>
            {achats.length === 0 ? (
              <p className="empty-state">Aucun achat enregistré.</p>
            ) : (
              <div className="finance-tableau">
                <table className="grid-table">
                  <thead><tr><th style={{ textAlign: "left" }}>Désignation</th><th>Engagé</th><th>Facturé</th><th>Payé</th><th>Reste à payer</th></tr></thead>
                  <tbody>
                    {achats.map((a) => (
                      <tr key={a.id} onClick={() => onOuvrirAchat(a.id)} style={{ cursor: "pointer" }}>
                        <td className="grid-row-label">{a.designation}</td>
                        <td>{formatMontant(a.montant_engage)}</td>
                        <td>{formatMontant(a.facture_reel)}</td>
                        <td>{formatMontant(a.paye)}</td>
                        <td>{formatMontant(a.reste_a_payer)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {onglet === "factures" && (
          <>
            <div className="finance-fp-onglet-action">
              <button className="btn primary tiny" onClick={() => onOuvrirForm("facture")}>+ Ajouter une facture</button>
            </div>
            {factures.length === 0 ? (
              <p className="empty-state">Aucune facture enregistrée.</p>
            ) : (
              <div className="finance-tableau">
                <table className="grid-table">
                  <thead><tr><th style={{ textAlign: "left" }}>N° / Achat</th><th>Date</th><th>Montant HT</th><th>Échéance</th><th>Payé</th><th>Reste</th><th>Statut</th></tr></thead>
                  <tbody>
                    {factures.map((f) => (
                      <tr key={f.id}>
                        <td className="grid-row-label">{f.reference_facture || f.achat_designation}</td>
                        <td>{labelJour(f.date_facture)}</td>
                        <td>{formatMontant(f.montant_ht)}</td>
                        <td>{f.date_echeance ? labelJour(f.date_echeance) : "—"}</td>
                        <td>{formatMontant(f.paye)}</td>
                        <td>{formatMontant(f.reste)}</td>
                        <td><span className="finance-statut-pastille" style={{ color: FACTURE_STATUT_COULEURS[f.statut], borderColor: FACTURE_STATUT_COULEURS[f.statut] }}>{FACTURE_STATUT_LABELS[f.statut]}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {onglet === "paiements" && (
          <>
            <div className="finance-fp-onglet-action">
              <button className="btn primary tiny" onClick={() => onOuvrirForm("paiement")}>+ Ajouter un paiement</button>
            </div>
            {paiements.length === 0 ? (
              <p className="empty-state">Aucun paiement enregistré.</p>
            ) : (
              <div className="finance-tableau">
                <table className="grid-table">
                  <thead><tr><th>Date</th><th>Montant</th><th style={{ textAlign: "left" }}>Mode</th><th style={{ textAlign: "left" }}>Référence</th></tr></thead>
                  <tbody>
                    {paiements.map((p) => (
                      <tr key={p.id}>
                        <td>{labelJour(p.date_paiement)}</td>
                        <td>{formatMontant(p.montant)}</td>
                        <td>{p.mode || "—"}</td>
                        <td>{p.reference || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ====================================================================================================
// Onglet Infos — reste intégré (ce n'est pas un formulaire de création séparé), avec les deux
// actions distinctes déjà validées : Enregistrer / Enregistrer et quitter.
// ====================================================================================================
function OngletInfos({ fournisseur, dette, onSaved, onSavedAndClose }: { fournisseur: Fournisseur; dette: DetteFournisseur; onSaved: () => void; onSavedAndClose: () => void }) {
  function construireInstantane(f: Fournisseur) {
    return {
      nom: f.nom, activite: f.activite ?? "", contact: f.contact ?? "", telephone: f.telephone ?? "",
      email: f.email ?? "", adresse: f.adresse ?? "",
      delaiPreset: (f.delai_paiement_jours == null ? "" : DELAIS_PRESET.some((d) => d.valeur === f.delai_paiement_jours) ? f.delai_paiement_jours : "personnalise") as number | "personnalise" | "",
      delaiPersonnalise: (f.delai_paiement_jours != null && !DELAIS_PRESET.some((d) => d.valeur === f.delai_paiement_jours) ? f.delai_paiement_jours : "") as number | "",
      finDeMois: !!f.delai_fin_de_mois, modePaiement: f.mode_paiement_defaut ?? "", notes: f.notes ?? "",
    };
  }
  const [initial, setInitial] = useState(construireInstantane(fournisseur));
  const [nom, setNom] = useState(initial.nom);
  const [activite, setActivite] = useState(initial.activite);
  const [contact, setContact] = useState(initial.contact);
  const [telephone, setTelephone] = useState(initial.telephone);
  const [email, setEmail] = useState(initial.email);
  const [adresse, setAdresse] = useState(initial.adresse);
  const [delaiPreset, setDelaiPreset] = useState(initial.delaiPreset);
  const [delaiPersonnalise, setDelaiPersonnalise] = useState(initial.delaiPersonnalise);
  const [finDeMois, setFinDeMois] = useState(initial.finDeMois);
  const [modePaiement, setModePaiement] = useState(initial.modePaiement);
  const [notes, setNotes] = useState(initial.notes);
  const [busy, setBusy] = useState(false);
  const [juisteEnregistre, setJusteEnregistre] = useState(false);

  const modifie =
    nom !== initial.nom || activite !== initial.activite || contact !== initial.contact || telephone !== initial.telephone ||
    email !== initial.email || adresse !== initial.adresse || delaiPreset !== initial.delaiPreset ||
    delaiPersonnalise !== initial.delaiPersonnalise || finDeMois !== initial.finDeMois ||
    modePaiement !== initial.modePaiement || notes !== initial.notes;

  async function enregistrer(): Promise<void> {
    const delaiFinal = delaiPreset === "" ? null : delaiPreset === "personnalise" ? (delaiPersonnalise === "" ? null : Number(delaiPersonnalise)) : delaiPreset;
    await window.api.finance.mettreAJourFournisseur(fournisseur.id, {
      nom: nom.trim(), activite: activite.trim() || null, contact: contact.trim() || null,
      telephone: telephone.trim() || null, email: email.trim() || null, adresse: adresse.trim() || null,
      delai_paiement_jours: delaiFinal, delai_fin_de_mois: finDeMois ? 1 : 0,
      mode_paiement_defaut: modePaiement || null, notes: notes.trim() || null,
    });
    setInitial({ nom, activite, contact, telephone, email, adresse, delaiPreset, delaiPersonnalise, finDeMois, modePaiement, notes });
  }

  async function handleEnregistrer() {
    setBusy(true);
    try {
      await enregistrer();
      onSaved();
      setJusteEnregistre(true);
      setTimeout(() => setJusteEnregistre(false), 2500);
    } finally {
      setBusy(false);
    }
  }
  async function handleEnregistrerEtQuitter() {
    setBusy(true);
    try {
      await enregistrer();
      onSavedAndClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="finance-fp-section">
        <div className="finance-fp-section-titre">Informations générales</div>
        <div className="finance-fp-grid-2">
          <label className="finance-fp-champ">Nom / Raison sociale
            <input type="text" value={nom} onChange={(e) => setNom(e.target.value)} />
          </label>
          <label className="finance-fp-champ">Activité
            <input type="text" placeholder="ex: Tissu / Matière" value={activite} onChange={(e) => setActivite(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="finance-fp-section">
        <div className="finance-fp-section-titre">Coordonnées</div>
        <div className="finance-fp-grid-2">
          <label className="finance-fp-champ">Contact principal
            <input type="text" value={contact} onChange={(e) => setContact(e.target.value)} />
          </label>
          <label className="finance-fp-champ">Téléphone
            <input type="text" value={telephone} onChange={(e) => setTelephone(e.target.value)} />
          </label>
        </div>
        <label className="finance-fp-champ">E-mail
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="finance-fp-champ">Adresse
          <input type="text" value={adresse} onChange={(e) => setAdresse(e.target.value)} />
        </label>
      </div>

      <div className="finance-fp-section">
        <div className="finance-fp-section-titre">Conditions commerciales</div>
        <div className="finance-fp-grid-2">
          <label className="finance-fp-champ">Délai habituel
            <select value={delaiPreset} onChange={(e) => setDelaiPreset(e.target.value === "" ? "" : e.target.value === "personnalise" ? "personnalise" : Number(e.target.value))}>
              <option value="">Non renseigné</option>
              {DELAIS_PRESET.map((d) => <option key={d.valeur} value={d.valeur}>{d.label}</option>)}
              <option value="personnalise">Personnalisé</option>
            </select>
          </label>
          <label className="finance-fp-champ">Mode de paiement habituel
            <select value={modePaiement} onChange={(e) => setModePaiement(e.target.value)}>
              <option value="">Non renseigné</option>
              {MODES_PAIEMENT.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </label>
        </div>
        {delaiPreset === "personnalise" && (
          <label className="finance-fp-champ" style={{ maxWidth: 200 }}>Nombre de jours
            <input type="number" min={0} value={delaiPersonnalise} onChange={(e) => setDelaiPersonnalise(e.target.value === "" ? "" : Number(e.target.value))} />
          </label>
        )}
        {delaiPreset !== "" && delaiPreset !== 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--v2-text-2)", marginTop: 4, cursor: "pointer" }}>
            <input type="checkbox" checked={finDeMois} onChange={(e) => setFinDeMois(e.target.checked)} />
            Le délai démarre en fin de mois de facturation (ex : "30 jours fin de mois")
          </label>
        )}
        <label className="finance-fp-champ" style={{ marginTop: 12 }}>Notes
          <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </label>
      </div>

      <div className="finance-fp-section">
        <div className="finance-fp-section-titre">Situation financière</div>
        <div className="finance-fp-indicateurs">
          <div><span>Engagé</span><strong>{formatMontant(dette.engage)}</strong></div>
          <div><span>Facturé</span><strong>{formatMontant(dette.facture)}</strong></div>
          <div><span>Payé</span><strong>{formatMontant(dette.paye)}</strong></div>
          <div><span>Reste dû</span><strong>{formatMontant(dette.dette_restante)}</strong></div>
          <div><span>Engagement restant</span><strong>{formatMontant(dette.engagement_restant)}</strong></div>
          <div><span>Crédit disponible</span><strong>{formatMontant(dette.credit_non_affecte)}</strong></div>
        </div>
      </div>

      <div className="finance-fp-actions">
        {juisteEnregistre && <span className="planning-panel-confirmation">✓ Enregistré</span>}
        <button className="btn ghost" onClick={handleEnregistrerEtQuitter} disabled={busy || !nom.trim()}>Enregistrer et quitter</button>
        <button className="btn primary finance-fp-btn-save" onClick={handleEnregistrer} disabled={busy || !nom.trim() || !modifie}>Enregistrer</button>
      </div>
    </>
  );
}
