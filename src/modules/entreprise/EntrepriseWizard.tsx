import { useEffect, useState } from "react";
import { Entreprise, EntreprisePayload } from "../../shared/types";
import { checkProfilGeneral } from "../../shared/entrepriseRequirements";
import { mediaUrl } from "../commandes/uiHelpers";
import Icon from "../../shared/Icon";

interface Props {
  firstLaunch?: boolean;
  onClose: () => void;
  onSaved: (entreprise: Entreprise) => void;
}

const STEPS = ["Identité de l'entreprise", "Coordonnées", "Identité visuelle"];

export default function EntrepriseWizard({ firstLaunch = false, onClose, onSaved }: Props) {
  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [logoUploading, setLogoUploading] = useState(false);

  const [f, setF] = useState<EntreprisePayload>({});
  const [logoPath, setLogoPathState] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      const existing = await window.api.entreprise.get();
      if (existing) {
        setF({
          nom_commercial: existing.nom_commercial,
          raison_sociale: existing.raison_sociale,
          matricule_fiscal: existing.matricule_fiscal,
          registre_commerce: existing.registre_commerce,
          identifiant_tva: existing.identifiant_tva,
          adresse: existing.adresse,
          ville: existing.ville,
          code_postal: existing.code_postal,
          pays: existing.pays,
          telephone: existing.telephone,
          email: existing.email,
          site_web: existing.site_web,
          banque: existing.banque,
          agence_bancaire: existing.agence_bancaire,
          rib: existing.rib,
          swift_bic: existing.swift_bic,
          taux_tva_defaut: existing.taux_tva_defaut,
        });
        setLogoPathState(existing.logo_path);
      }
      setLoaded(true);
    }
    load();
  }, []);

  function set<K extends keyof EntreprisePayload>(key: K, value: EntreprisePayload[K]) {
    setF((prev) => ({ ...prev, [key]: value }));
  }

  async function persist(): Promise<Entreprise> {
    return window.api.entreprise.save(f);
  }

  async function handleSaveAsDraft() {
    setSaving(true);
    setError(null);
    try {
      const saved = await persist();
      const etat = await window.api.entreprise.getEtatWizard();
      if (etat === "never_shown") await window.api.entreprise.setEtatWizard("postponed");
      onSaved(saved);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleFinish() {
    setSaving(true);
    setError(null);
    try {
      const saved = await persist();
      await window.api.entreprise.setEtatWizard("completed");
      onSaved(saved);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleConfigurerPlusTard() {
    setSaving(true);
    setError(null);
    try {
      await persist();
      await window.api.entreprise.setEtatWizard("postponed");
      onClose();
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'enregistrement.");
    } finally {
      setSaving(false);
    }
  }

  async function handlePickLogo() {
    const result = await window.api.entreprise.pickLogo();
    if (!result.canceled && "error" in result) { setError(result.error); return; }
    if (result.canceled || !("filePath" in result)) return;
    setLogoUploading(true);
    setError(null);
    try {
      const saved = await window.api.entreprise.setLogo(result.filePath);
      setLogoPathState(saved.logo_path);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de l'ajout du logo.");
    } finally {
      setLogoUploading(false);
    }
  }

  async function handleRemoveLogo() {
    setLogoUploading(true);
    try {
      const saved = await window.api.entreprise.removeLogo();
      setLogoPathState(saved.logo_path);
    } finally {
      setLogoUploading(false);
    }
  }

  const profil = checkProfilGeneral({ ...f, id: 1, logo_path: logoPath, created_at: "", updated_at: "" } as Entreprise);

  return (
    <div className="modal-veil">
      <div className="modal wide" style={{ maxWidth: 720, fontFamily: "var(--v2-font)" }}>
        <div className="modal-head">
          <h3 style={{ fontFamily: "inherit" }}>Configuration de l'entreprise</h3>
          {!firstLaunch && <button className="icon-btn" onClick={onClose} aria-label="Fermer"><Icon name="x" /></button>}
        </div>

        <div className="wizard-stepper" style={{ padding: "4px 0 20px" }}>
          {STEPS.map((label, i) => (
            <div key={label} className={`wizard-step-tab ${i < step ? "done" : ""} ${i === step ? "active" : ""}`}>
              <div className="wizard-step-bar" />
              <span className="wizard-step-label">{i + 1}. {label}</span>
            </div>
          ))}
        </div>

        {!loaded ? (
          <p style={{ color: "var(--v2-text-3)" }}>Chargement...</p>
        ) : (
          <>
            {step === 0 && (
              <div className="v2-card-grid">
                <div className="v2-info-card">
                  <Icon name="building-factory" />
                  <label>Nom commercial</label>
                  <input type="text" value={f.nom_commercial ?? ""} onChange={(e) => set("nom_commercial", e.target.value)} placeholder="Belvie" />
                </div>
                <div className="v2-info-card">
                  <Icon name="note" />
                  <label>Raison sociale</label>
                  <input type="text" value={f.raison_sociale ?? ""} onChange={(e) => set("raison_sociale", e.target.value)} placeholder="Belvie Confection SARL" />
                </div>
                <div className="v2-info-card">
                  <Icon name="list-check" />
                  <label>Matricule fiscal</label>
                  <input type="text" value={f.matricule_fiscal ?? ""} onChange={(e) => set("matricule_fiscal", e.target.value)} />
                </div>
                <div className="v2-info-card">
                  <Icon name="list-check" />
                  <label>Registre de commerce (si nécessaire)</label>
                  <input type="text" value={f.registre_commerce ?? ""} onChange={(e) => set("registre_commerce", e.target.value)} />
                </div>
                <div className="v2-info-card">
                  <Icon name="list-check" />
                  <label>Identifiant TVA (si applicable)</label>
                  <input type="text" value={f.identifiant_tva ?? ""} onChange={(e) => set("identifiant_tva", e.target.value)} />
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="v2-card-grid">
                <div className="v2-info-card" style={{ gridColumn: "span 2" }}>
                  <Icon name="info-circle" />
                  <label>Adresse</label>
                  <textarea rows={2} value={f.adresse ?? ""} onChange={(e) => set("adresse", e.target.value)} placeholder="Adresse complète du siège" />
                </div>
                <div className="v2-info-card">
                  <Icon name="info-circle" />
                  <label>Ville</label>
                  <input type="text" value={f.ville ?? ""} onChange={(e) => set("ville", e.target.value)} placeholder="Ariana" />
                </div>
                <div className="v2-info-card">
                  <Icon name="info-circle" />
                  <label>Code postal</label>
                  <input type="text" value={f.code_postal ?? ""} onChange={(e) => set("code_postal", e.target.value)} placeholder="2080" />
                </div>
                <div className="v2-info-card">
                  <Icon name="info-circle" />
                  <label>Pays</label>
                  <input type="text" value={f.pays ?? ""} onChange={(e) => set("pays", e.target.value)} placeholder="Tunisie" />
                </div>
                <div className="v2-info-card">
                  <Icon name="user" />
                  <label>Téléphone</label>
                  <input type="text" value={f.telephone ?? ""} onChange={(e) => set("telephone", e.target.value)} placeholder="+216 ..." />
                </div>
                <div className="v2-info-card">
                  <Icon name="user" />
                  <label>E-mail</label>
                  <input type="email" value={f.email ?? ""} onChange={(e) => set("email", e.target.value)} placeholder="contact@belvie.tn" />
                </div>
                <div className="v2-info-card">
                  <Icon name="info-circle" />
                  <label>Site web</label>
                  <input type="text" value={f.site_web ?? ""} onChange={(e) => set("site_web", e.target.value)} placeholder="www.belvie.tn" />
                </div>
                <p style={{ gridColumn: "span 2", fontSize: 12, fontWeight: 600, color: "var(--v2-text-3)", textTransform: "uppercase", letterSpacing: ".02em", margin: "6px 0 -4px" }}>
                  Coordonnées bancaires
                </p>
                <div className="v2-info-card">
                  <Icon name="building-factory" />
                  <label>Banque</label>
                  <input type="text" value={f.banque ?? ""} onChange={(e) => set("banque", e.target.value)} placeholder="BIAT" />
                </div>
                <div className="v2-info-card">
                  <Icon name="info-circle" />
                  <label>Agence</label>
                  <input type="text" value={f.agence_bancaire ?? ""} onChange={(e) => set("agence_bancaire", e.target.value)} placeholder="Ariana Centre" />
                </div>
                <div className="v2-info-card" style={{ gridColumn: "span 2" }}>
                  <Icon name="note" />
                  <label>RIB</label>
                  <input type="text" value={f.rib ?? ""} onChange={(e) => set("rib", e.target.value)} placeholder="00 000 00000000000000 00" />
                </div>
                <div className="v2-info-card" style={{ gridColumn: "span 2" }}>
                  <Icon name="note" />
                  <label>SWIFT / BIC (si applicable)</label>
                  <input type="text" value={f.swift_bic ?? ""} onChange={(e) => set("swift_bic", e.target.value)} placeholder="BIATTNTT" />
                </div>
                <p style={{ gridColumn: "span 2", fontSize: 12, fontWeight: 600, color: "var(--v2-text-3)", textTransform: "uppercase", letterSpacing: ".02em", margin: "6px 0 -4px" }}>
                  Paramètres fiscaux
                </p>
                <div className="v2-info-card">
                  <Icon name="info-circle" />
                  <label>Taux de TVA par défaut</label>
                  <input
                    type="number" min={0} max={100} step="0.5"
                    value={f.taux_tva_defaut ?? ""}
                    onChange={(e) => set("taux_tva_defaut", e.target.value === "" ? null : Number(e.target.value))}
                    placeholder="19"
                  />
                </div>
              </div>
            )}

            {step === 2 && (
              <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
                <div className="v2-photo-frame" style={{ width: 180, height: 180 }}>
                  {logoPath ? (
                    <img src={mediaUrl(logoPath)!} alt="Logo de l'entreprise" style={{ objectFit: "contain", padding: 12 }} />
                  ) : (
                    <div className="v2-photo-frame-empty"><Icon name="photo" size={30} /> Aucun logo</div>
                  )}
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ fontSize: 13, color: "var(--v2-text-2)", marginTop: 0 }}>
                    Le fichier est copié dans le stockage de l'application : il ne disparaîtra pas si le fichier d'origine est déplacé ou supprimé.
                  </p>
                  <div style={{ display: "flex", gap: 10 }}>
                    <button type="button" className="v2-btn primary" onClick={handlePickLogo} disabled={logoUploading}>
                      {logoUploading ? "Traitement..." : logoPath ? "Remplacer le logo" : "Ajouter un logo"}
                    </button>
                    {logoPath && (
                      <button type="button" className="v2-btn ghost" onClick={handleRemoveLogo} disabled={logoUploading}>Retirer</button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {step === 2 && (f.banque || f.agence_bancaire || f.rib || f.swift_bic) && (
              <div className="v2-summary-card" style={{ marginTop: 20, maxWidth: 420 }}>
                <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--v2-text-3)", textTransform: "uppercase", letterSpacing: ".02em", marginBottom: 10 }}>
                  Récapitulatif bancaire
                </div>
                {f.banque && <p style={{ margin: "4px 0", fontSize: 13.5 }}>Banque : <strong>{f.banque}</strong></p>}
                {f.agence_bancaire && <p style={{ margin: "4px 0", fontSize: 13.5 }}>Agence : <strong>{f.agence_bancaire}</strong></p>}
                {f.rib && <p style={{ margin: "4px 0", fontSize: 13.5 }}>RIB : <strong style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{f.rib}</strong></p>}
                {f.swift_bic && <p style={{ margin: "4px 0", fontSize: 13.5 }}>SWIFT/BIC : <strong style={{ fontFamily: "'IBM Plex Mono', monospace" }}>{f.swift_bic}</strong></p>}
              </div>
            )}

            {step === 2 && !profil.ok && (
              <p style={{ background: "var(--v2-warning-bg)", color: "var(--v2-warning)", padding: "10px 14px", borderRadius: 8, fontSize: 12.5, marginTop: 20 }}>
                Informations encore incomplètes : {profil.missingLabels.join(", ")}. Vous pouvez tout de même enregistrer et compléter plus tard.
              </p>
            )}

            {error && <p style={{ background: "var(--v2-danger-bg)", color: "var(--v2-danger)", padding: "10px 14px", borderRadius: 8, fontSize: 13, marginTop: 20 }}>{error}</p>}
          </>
        )}

        <div className="modal-actions" style={{ justifyContent: "space-between", marginTop: 24 }}>
          <div>
            {firstLaunch && step === 0 && (
              <button className="v2-btn ghost" onClick={handleConfigurerPlusTard} disabled={saving}>Configurer plus tard</button>
            )}
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {step > 0 && <button className="v2-btn ghost" onClick={() => setStep((s) => s - 1)} disabled={saving}>Précédent</button>}
            {step < STEPS.length - 1 ? (
              <button className="v2-btn primary" onClick={() => setStep((s) => s + 1)} disabled={saving}>Suivant</button>
            ) : (
              <>
                <button className="v2-btn secondary" onClick={handleSaveAsDraft} disabled={saving}>Enregistrer comme brouillon</button>
                <button className="v2-btn primary" onClick={handleFinish} disabled={saving}>Terminer</button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
