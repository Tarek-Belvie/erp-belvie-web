import { useEffect, useState } from "react";
import { ListeValeur, PlanningArticle, PLANNING_STATUT_LABELS, PlanningStatut } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";
import { MOIS_ABREGES as NOMS_MOIS } from "../../shared/dateLabels";

const STATUTS: PlanningStatut[] = [
  "idee", "a_etudier", "prototype", "echantillon", "a_modifier", "valide",
  "a_produire", "en_production", "production_terminee", "shooting_a_preparer", "pret_au_lancement", "lance", "annule",
];
const AUJOURDHUI = new Date();
const ANNEE_COURANTE = AUJOURDHUI.getFullYear();
const MOIS_COURANT = AUJOURDHUI.getMonth() + 1;
function moisLancementDesactive(mois: number, annee: number): boolean {
  if (annee < ANNEE_COURANTE) return true;
  if (annee === ANNEE_COURANTE && mois < MOIS_COURANT) return true;
  return false;
}
function moisReceptionDesactive(mois: number, annee: number, moisLancement: number, anneeLancement: number): boolean {
  if (annee < anneeLancement) return true;
  if (annee === anneeLancement && mois < moisLancement) return true;
  return false;
}

// Même logique que côté backend (electron/ipc/planning.js) — le backend reste la source de
// vérité ; cette copie ne sert qu'à adapter l'interface sans attendre un aller-retour raté.
const STATUTS_AVANT_VALIDATION: PlanningStatut[] = ["idee", "a_etudier", "prototype", "echantillon", "a_modifier"];
function estProtege(statut: PlanningStatut): boolean {
  return statut !== "annule" && !STATUTS_AVANT_VALIDATION.includes(statut);
}
// Le ✓ (et la photo en couleurs, voir PlanningCard) représentent la validation obtenue — jamais
// la simple liaison au catalogue produit, qui est une information totalement indépendante.
const ORDRE_CYCLE: PlanningStatut[] = STATUTS;
const INDEX_VALIDE = ORDRE_CYCLE.indexOf("valide");
function validationAtteinte(statut: PlanningStatut): boolean {
  return ORDRE_CYCLE.indexOf(statut) >= INDEX_VALIDE;
}

interface Props {
  item: PlanningArticle;
  onClose: () => void;
  onChanged: () => void;
  onOpenConvertir: () => void;
  onOpenProduit: (articleId: number) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export default function PlanningDetailPanel({ item, onClose, onChanged, onOpenConvertir, onDirtyChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [confirmRetrait, setConfirmRetrait] = useState<"retirer" | "supprimer" | null>(null);
  const [confirmDeverrouillage, setConfirmDeverrouillage] = useState(false);
  const [confirmFermeture, setConfirmFermeture] = useState(false);
  const [deverrouille, setDeverrouille] = useState(false);
  const [juisteEnregistre, setJusteEnregistre] = useState(false);
  const url = mediaUrl(item.photo_affichee);

  const protege = estProtege(item.statut) && !deverrouille;
  const valide = validationAtteinte(item.statut);

  // Champs sensibles éditables — verrouillés dès "Validé" tant que non déverrouillé explicitement.
  const [categorieId, setCategorieId] = useState<number | "">(item.categorie_id ?? "");
  const [saisonId, setSaisonId] = useState<number | "">(item.saison_id ?? "");
  const [moisProduction, setMoisProduction] = useState(Number(item.mois_prevu_production.split("-")[1]));
  const [anneeProduction, setAnneeProduction] = useState(Number(item.mois_prevu_production.split("-")[0]));
  const [moisReception, setMoisReception] = useState<number | "">(item.mois_prevu_reception ? Number(item.mois_prevu_reception.split("-")[1]) : "");
  const [anneeReception, setAnneeReception] = useState<number | "">(item.mois_prevu_reception ? Number(item.mois_prevu_reception.split("-")[0]) : "");
  const [quantite, setQuantite] = useState<number | "">(item.quantite_previsionnelle ?? "");
  const [coloris, setColoris] = useState(item.coloris.join(", "));
  const [atelierId, setAtelierId] = useState<number | "">(item.atelier_id ?? "");
  const [receptionOuverte, setReceptionOuverte] = useState(!!item.mois_prevu_reception);
  const [notes, setNotes] = useState(item.notes ?? "");

  // Référence locale explicite des DERNIÈRES VALEURS RÉELLEMENT ENREGISTRÉES — jamais recalculée
  // depuis la prop "item" (qui dépend du rafraîchissement asynchrone du parent, et peut différer
  // légèrement après un aller-retour serveur : espaces normalisés sur les coloris, etc.). C'est
  // cette référence, mise à jour uniquement après un "Enregistrer" réussi, qui définit ce qu'est
  // un panneau "propre" — jamais le simple fait qu'un champ ait été touché depuis l'ouverture.
  function construireInstantane() {
    return {
      categorieId, saisonId, moisProduction, anneeProduction, moisReception, anneeReception,
      quantite, coloris, atelierId, notes,
    };
  }
  const [dernierEnregistrement, setDernierEnregistrement] = useState(construireInstantane);

  const modifie =
    categorieId !== dernierEnregistrement.categorieId ||
    saisonId !== dernierEnregistrement.saisonId ||
    moisProduction !== dernierEnregistrement.moisProduction ||
    anneeProduction !== dernierEnregistrement.anneeProduction ||
    moisReception !== dernierEnregistrement.moisReception ||
    anneeReception !== dernierEnregistrement.anneeReception ||
    quantite !== dernierEnregistrement.quantite ||
    coloris !== dernierEnregistrement.coloris ||
    atelierId !== dernierEnregistrement.atelierId ||
    notes !== dernierEnregistrement.notes;

  const [categories, setCategories] = useState<ListeValeur[]>([]);
  const [saisons, setSaisons] = useState<ListeValeur[]>([]);
  const [ateliers, setAteliers] = useState<ListeValeur[]>([]);
  useEffect(() => {
    onDirtyChange?.(modifie);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifie]);

  useEffect(() => {
    window.api.listes.list("categorie", { includeInactive: true }).then(setCategories);
    window.api.listes.list("saison", { includeInactive: true }).then(setSaisons);
    window.api.listes.list("atelier", { includeInactive: true }).then(setAteliers);
  }, []);

  async function handleStatutChange(statut: PlanningStatut) {
    // Le statut lui-même n'est jamais verrouillé — sinon la planification resterait bloquée dès
    // "Validé", incapable de progresser vers les étapes suivantes.
    setBusy(true);
    try {
      await window.api.planning.mettreAJour(item.id, { statut });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  function handleChangerMoisProduction(nouveauMois: number) {
    setMoisProduction(nouveauMois);
    if (receptionOuverte && moisReception !== "" && anneeReception !== "" && moisReceptionDesactive(moisReception, anneeReception, nouveauMois, anneeProduction)) {
      setReceptionOuverte(false); setMoisReception(""); setAnneeReception("");
    }
  }
  function handleChangerAnneeProduction(nouvelleAnnee: number) {
    setAnneeProduction(nouvelleAnnee);
    if (receptionOuverte && moisReception !== "" && anneeReception !== "" && moisReceptionDesactive(moisReception, anneeReception, moisProduction, nouvelleAnnee)) {
      setReceptionOuverte(false); setMoisReception(""); setAnneeReception("");
    }
  }

  async function handleEnregistrer() {
    setBusy(true);
    try {
      const production = `${anneeProduction}-${String(moisProduction).padStart(2, "0")}`;
      const reception = moisReception !== "" && anneeReception !== "" ? `${anneeReception}-${String(moisReception).padStart(2, "0")}` : null;
      if (production !== item.mois_prevu_production) {
        await window.api.planning.deplacer(item.id, "mois_prevu_production", production, undefined, deverrouille);
      }
      if (reception !== item.mois_prevu_reception) {
        await window.api.planning.mettreAJour(item.id, { mois_prevu_reception: reception, forcer: deverrouille });
      }
      await window.api.planning.mettreAJour(item.id, {
        categorie_id: categorieId || null,
        saison_id: saisonId || null,
        quantite_previsionnelle: quantite === "" ? null : Number(quantite),
        coloris_previsionnels: coloris.trim() || null,
        atelier_id: atelierId || null,
        notes: notes || undefined,
        forcer: deverrouille,
      });
      onChanged();
      setDernierEnregistrement(construireInstantane());
      setJusteEnregistre(true);
      setTimeout(() => setJusteEnregistre(false), 2500);
    } finally {
      setBusy(false);
    }
  }

  function handleFermer() {
    if (modifie) setConfirmFermeture(true);
    else onClose();
  }

  // Touche Échap : même logique de protection que × et le clic en dehors du panneau — jamais de
  // fermeture silencieuse s'il reste des modifications non enregistrées.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") handleFermer();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modifie]);

  async function handleRetrait() {
    setBusy(true);
    try {
      if (confirmRetrait === "supprimer") await window.api.planning.supprimerProvisoire(item.id);
      else await window.api.planning.retirerDuPlanning(item.id);
      onChanged();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  const styleChamp = { display: "block", width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "7px 9px", fontSize: 12.5, marginTop: 4, fontFamily: "inherit" };
  const champProtege = protege ? { opacity: 0.6, cursor: "not-allowed" } : {};

  return (
    <div className="planning-panel-veil" onClick={handleFermer}>
      <div className="planning-panel" onClick={(e) => e.stopPropagation()}>
        <div className="planning-panel-photo">
          {url ? <img src={url} alt={item.nom_affiche} /> : <div className="planning-card-photo-empty" style={{ height: "100%" }}><span>Aucune photo</span></div>}
        </div>

        <div className="planning-panel-body">
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, marginBottom: 4 }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 19, lineHeight: 1.25 }}>{item.nom_affiche}</h2>
              {item.reference_affichee && <div style={{ fontSize: 12.5, color: "var(--v2-text-3)", fontFamily: "var(--v2-font)", marginTop: 2 }}>{item.reference_affichee}</div>}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <button
                className="icon-btn planning-panel-save"
                disabled={!modifie || busy}
                onClick={handleEnregistrer}
                title={modifie ? "Enregistrer les modifications" : "Aucune modification"}
                aria-label="Enregistrer"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
                  <path d="M17 21v-8H7v8" />
                  <path d="M7 3v5h8" />
                </svg>
              </button>
              <button className="icon-btn" onClick={handleFermer} aria-label="Fermer">✕</button>
            </div>
          </div>

          {juisteEnregistre && <div className="planning-panel-confirmation">✓ Enregistré</div>}

          {!item.est_provisoire && (
            <div className="planning-panel-produit-lie">Produit lié au catalogue</div>
          )}

          <label className="planning-panel-field" style={{ marginTop: 12 }}>
            Statut
            <select value={item.statut} onChange={(e) => handleStatutChange(e.target.value as PlanningStatut)} disabled={busy}>
              {STATUTS.map((s) => <option key={s} value={s}>{PLANNING_STATUT_LABELS[s]}</option>)}
            </select>
          </label>

          {protege && (
            <div style={{ background: "#FFFBEB", border: "1px solid #FDE68A", borderRadius: 8, padding: "8px 10px", marginBottom: 14, fontSize: 11.5, color: "#92400E" }}>
              Planification validée — les données ci-dessous sont protégées contre une modification accidentelle.{" "}
              <button className="btn ghost tiny" style={{ marginLeft: 4 }} onClick={() => setConfirmDeverrouillage(true)}>Modifier malgré validation</button>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14, minWidth: 0 }}>
            <div style={{ background: "#F6F7F2", borderRadius: 8, padding: 10, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v2-text)", marginBottom: 6 }}>Lancement prévu</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 68px", gap: 6, minWidth: 0 }}>
                <select value={moisProduction} disabled={protege} onChange={(e) => handleChangerMoisProduction(Number(e.target.value))} style={{ ...styleChamp, marginTop: 0, minWidth: 0, ...champProtege }}>
                  {NOMS_MOIS.map((n, i) => <option key={i} value={i + 1} disabled={moisLancementDesactive(i + 1, anneeProduction)}>{n}</option>)}
                </select>
                <input type="number" disabled={protege} value={anneeProduction} onChange={(e) => handleChangerAnneeProduction(Number(e.target.value))} min={ANNEE_COURANTE} style={{ ...styleChamp, marginTop: 0, minWidth: 0, ...champProtege }} />
              </div>
            </div>
            <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, minWidth: 0 }}>
              <div style={{ fontSize: 10.5, fontWeight: 700, color: "var(--v2-text)", marginBottom: 6 }}>Réception prévue</div>
              {receptionOuverte ? (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 68px", gap: 6, minWidth: 0 }}>
                  <select
                    disabled={protege} value={moisReception}
                    onChange={(e) => setMoisReception(Number(e.target.value))}
                    style={{ ...styleChamp, marginTop: 0, minWidth: 0, ...champProtege }}
                  >
                    {NOMS_MOIS.map((n, i) => (
                      <option key={i} value={i + 1} disabled={moisReceptionDesactive(i + 1, anneeReception === "" ? anneeProduction : anneeReception, moisProduction, anneeProduction)}>{n}</option>
                    ))}
                  </select>
                  <input
                    disabled={protege} type="number" value={anneeReception === "" ? anneeProduction : anneeReception}
                    onChange={(e) => setAnneeReception(e.target.value === "" ? "" : Number(e.target.value))}
                    min={anneeProduction}
                    style={{ ...styleChamp, marginTop: 0, minWidth: 0, ...champProtege }}
                  />
                </div>
              ) : (
                <button
                  className="planning-panel-reception-vide"
                  disabled={protege}
                  onClick={() => { setMoisReception(moisProduction); setAnneeReception(anneeProduction); setReceptionOuverte(true); }}
                >
                  Non renseignée
                </button>
              )}
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, minWidth: 0 }}>
            <label style={{ fontSize: 11, color: "var(--v2-text-3)" }}>Catégorie
              <select value={categorieId} disabled={protege} onChange={(e) => setCategorieId(e.target.value ? Number(e.target.value) : "")} style={{ ...styleChamp, ...champProtege }}>
                <option value="">—</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "var(--v2-text-3)" }}>Saison
              <select value={saisonId} disabled={protege} onChange={(e) => setSaisonId(e.target.value ? Number(e.target.value) : "")} style={{ ...styleChamp, ...champProtege }}>
                <option value="">—</option>
                {saisons.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 11, color: "var(--v2-text-3)" }}>Quantité prévisionnelle
              <input type="number" min={0} disabled={protege} value={quantite} onChange={(e) => setQuantite(e.target.value === "" ? "" : Number(e.target.value))} style={{ ...styleChamp, ...champProtege }} />
            </label>
            <label style={{ fontSize: 11, color: "var(--v2-text-3)" }}>Atelier / fournisseur
              <select value={atelierId} disabled={protege} onChange={(e) => setAtelierId(e.target.value ? Number(e.target.value) : "")} style={{ ...styleChamp, ...champProtege }}>
                <option value="">—</option>
                {ateliers.map((a) => <option key={a.id} value={a.id}>{a.nom}{!a.actif ? " (inactif)" : ""}</option>)}
              </select>
            </label>
          </div>

          <label style={{ fontSize: 11, color: "var(--v2-text-3)", display: "block", marginBottom: 14 }}>Coloris envisagés (séparés par une virgule)
            <input type="text" disabled={protege} value={coloris} onChange={(e) => setColoris(e.target.value)} style={{ ...styleChamp, ...champProtege }} />
          </label>

          <div style={{ marginBottom: 4 }}>
            <div className="planning-panel-label">Notes</div>
            <textarea
              rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Aucune note — toujours modifiable, même après validation"
              style={{ width: "100%", border: "1px solid #E5E7EB", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, marginTop: 6, fontFamily: "inherit" }}
            />
          </div>

          {!!item.est_provisoire && (
            <button className="btn primary" style={{ width: "100%", marginTop: 16 }} onClick={onOpenConvertir}>Convertir en produit</button>
          )}

          <div className="planning-panel-actions" style={{ marginTop: item.est_provisoire ? 10 : 20 }}>
            <button className="planning-panel-retrait" onClick={() => setConfirmRetrait(item.est_provisoire ? "supprimer" : "retirer")}>
              {item.est_provisoire ? "Supprimer l'article prévisionnel" : "Retirer du planning"}
            </button>
          </div>
        </div>

        {confirmDeverrouillage && (
          <div className="modal-veil" onClick={() => setConfirmDeverrouillage(false)}>
            <div className="modal small" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>Modifier malgré validation ?</h3></div>
              <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
                Cet article est déjà validé. La modification de ces données peut affecter les étapes suivantes. Continuer ?
              </p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setConfirmDeverrouillage(false)}>Annuler</button>
                <button className="btn primary" onClick={() => { setDeverrouille(true); setConfirmDeverrouillage(false); }}>Continuer</button>
              </div>
            </div>
          </div>
        )}

        {confirmFermeture && (
          <div className="modal-veil" onClick={() => setConfirmFermeture(false)}>
            <div className="modal small" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>Fermer sans enregistrer ?</h3></div>
              <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>Des modifications n'ont pas été enregistrées. Fermer quand même ?</p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setConfirmFermeture(false)}>Annuler</button>
                <button className="btn danger" onClick={() => { setConfirmFermeture(false); onClose(); }}>Fermer sans enregistrer</button>
              </div>
            </div>
          </div>
        )}

        {confirmRetrait && (
          <div className="modal-veil" onClick={() => setConfirmRetrait(null)}>
            <div className="modal small" onClick={(e) => e.stopPropagation()}>
              <div className="modal-head"><h3>{confirmRetrait === "supprimer" ? "Supprimer cet article prévisionnel ?" : "Retirer du planning ?"}</h3></div>
              <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>
                {confirmRetrait === "supprimer"
                  ? "Cet article n'existe que dans la planification — cette action est définitive."
                  : "Le produit reste intact dans le catalogue ERP ; seule son apparition dans ce planning est retirée."}
              </p>
              <div className="modal-actions">
                <button className="btn ghost" onClick={() => setConfirmRetrait(null)}>Annuler</button>
                <button className="btn danger" onClick={handleRetrait} disabled={busy}>Confirmer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
