import { useEffect, useState } from "react";
import { BcPf, Commande, Etape, ListeValeur, PRIORITE_LABELS, STATUT_BADGE_CLASS, STATUT_LABELS } from "../../shared/types";
import Icon from "../../shared/Icon";
import { fmtDateTime, mediaUrl } from "./uiHelpers";
import RepartitionTable from "./RepartitionTable";
import CommandeBesoinsMatieres from "./CommandeBesoinsMatieres";
import { STATUTS_ELIGIBLES } from "../approvisionnement/approvisionnementTypes";
import HistoriqueList from "./HistoriqueList";
import CollapsibleSection from "./CollapsibleSection";
import DetailField from "./DetailField";
import TransitionDialog from "./TransitionDialog";
import BcPfDetailModal from "../bcpf/BcPfDetailModal";
import LancerProductionScreen from "./LancerProductionScreen";

interface Props {
  commandeId: number;
  operateurActif: ListeValeur | null;
  etapes: Etape[];
  onClose: () => void;
  onChanged: () => void;
  onEditBrouillon: (commande: Commande) => void;
  /** Quitte cette fenêtre et ouvre la préparation d'un bon de commande matières pour cette
   *  production. Le module Approvisionnement fait le reste : c'est lui qui sait regrouper les
   *  besoins — rien n'est recalculé ici. */
  onPreparerBcMp: (commandeIds: number[]) => void;
}

type DialogType = "valider" | "supprimer" | "annuler" | "bloquer" | "debloquer" | "entrerCQ" | "terminer" | "archiver" | "desarchiver";

export default function CommandeDetailModal({ commandeId, operateurActif, etapes, onClose, onChanged, onEditBrouillon, onPreparerBcMp }: Props) {
  const [commande, setCommande] = useState<Commande | null>(null);
  const [operateurs, setOperateurs] = useState<ListeValeur[]>([]);
  const [loading, setLoading] = useState(true);
  const [showBcPf, setShowBcPf] = useState(false);
  const [bcPfId, setBcPfId] = useState<number | null>(null);
  const [autoPrintBcPf, setAutoPrintBcPf] = useState(false);
  const [autoDownloadBcPf, setAutoDownloadBcPf] = useState(false);
  const [bcPfList, setBcPfList] = useState<BcPf[]>([]);
  const [creatingBcPf, setCreatingBcPf] = useState(false);
  const [bcPfError, setBcPfError] = useState<string | null>(null);

  const [showLaunch, setShowLaunch] = useState(false);
  const [activeDialog, setActiveDialog] = useState<DialogType | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    const [c, ops] = await Promise.all([
      window.api.commandes.get(commandeId),
      window.api.listes.list("operateur", { includeInactive: true }),
    ]);
    setCommande(c);
    setOperateurs(ops);
    setLoading(false);

    if (c && c.statut !== "brouillon") {
      setBcPfList(await window.api.bcPf.listForCommande(commandeId));
    } else {
      setBcPfList([]);
    }
  }
  useEffect(() => { refresh(); }, [commandeId]);

  async function handleCreerBcPf() {
    setCreatingBcPf(true);
    setBcPfError(null);
    try {
      const bc = await window.api.bcPf.creer(commandeId);
      setBcPfList(await window.api.bcPf.listForCommande(commandeId));
      setBcPfId(bc.id);
      setShowBcPf(true);
    } catch (err: any) {
      setBcPfError(err?.message || "Erreur lors de la création du bon de commande.");
    } finally {
      setCreatingBcPf(false);
    }
  }

  function handleConsulterBcPf(id: number) {
    setBcPfId(id);
    setShowBcPf(true);
  }

  function handleImprimerBcPf(id: number) {
    setBcPfId(id);
    setAutoPrintBcPf(true);
    setShowBcPf(true);
  }

  function handleTelechargerPdfBcPf(id: number) {
    setBcPfId(id);
    setAutoDownloadBcPf(true);
    setShowBcPf(true);
  }

  function notify(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 2800);
  }

  async function afterSuccess(msg: string) {
    await refresh();
    onChanged();
    notify(msg);
    setActiveDialog(null);
  }

  if (loading || !commande) return <div className="modal-veil"><div className="modal empty-state">Chargement...</div></div>;

  const c = commande;

  function handleImprimer() { window.print(); }
  async function handleExporter() {
    const res = await window.api.system.exportFile("xlsx");
    if (!res.canceled) notify("Export généré (ensemble des commandes).");
  }

  return (
    <div className="modal-veil">
      <div className="modal wide fiche-modal">
        <div className="modal-head">
          <div>
            <p className="eyebrow">Fiche commande</p>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <h3 className="commande-fiche-numero">{c.numero ?? "Brouillon"}</h3>
              <span className={`v2-badge ${STATUT_BADGE_CLASS[c.statut]}`}>{STATUT_LABELS[c.statut]}</span>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        <div className="fiche-split">
          <div className="detail-block">
            <h4>Identité de la commande</h4>
            <div className="detail-fields">
              <DetailField label="Numéro de commande">{c.numero ?? "Brouillon"}</DetailField>
              <DetailField label="Référence">{c.reference_production ?? c.article_reference_principale ?? "—"}</DetailField>
              <DetailField label="Type de production">{c.type_production === "reassort" ? "Réassort" : "Nouvel article"}</DetailField>
            </div>
          </div>

          <div className="fiche-split-side">
            <div className="detail-block detail-block-compact">
              <h4>État de la commande</h4>
              <span className={`v2-badge ${STATUT_BADGE_CLASS[c.statut]}`}>{STATUT_LABELS[c.statut]}</span>
              <p className="fiche-compact-line">
                {c.annulee_le ? `Annulée le ${fmtDateTime(c.annulee_le).split(" ")[0]}`
                  : c.terminee_le ? `Terminée le ${fmtDateTime(c.terminee_le).split(" ")[0]}`
                  : c.controle_qualite_le ? `En contrôle qualité depuis le ${fmtDateTime(c.controle_qualite_le).split(" ")[0]}`
                  : c.lance_le ? `Lancée le ${fmtDateTime(c.lance_le).split(" ")[0]}`
                  : c.valide_le ? `Validée le ${fmtDateTime(c.valide_le).split(" ")[0]}`
                  : "Pas encore validée"}
              </p>
              {!!c.bloquee && <p className="fiche-compact-line" style={{ color: "var(--v2-danger, #DC2626)" }}>Bloquée{c.blocage_motif ? ` — ${c.blocage_motif}` : ""}</p>}
              {!!c.archived && <p className="fiche-compact-line">Archivée</p>}
              {c.statut !== "brouillon" && c.statut !== "annulee" && (() => {
                const bcActif = bcPfList.find((bc) => !bc.remplace_par);
                return bcActif && bcActif.statut === "brouillon" ? (
                  <p className="fiche-compact-line" style={{ color: "var(--v2-warning, #B45309)", display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    <Icon name="alert-triangle" /> BC PF encore en brouillon
                  </p>
                ) : null;
              })()}
            </div>

            <CollapsibleSection title="Historique" summary={`${(c.historique ?? []).length} événement${(c.historique ?? []).length > 1 ? "s" : ""}`} compact>
              <HistoriqueList historique={c.historique ?? []} operateurs={operateurs} />
            </CollapsibleSection>
          </div>
        </div>

        <div className="detail-block">
          <h4>Article</h4>
          <div style={{ display: "flex", gap: 14 }}>
            <div className="photo-preview-box" style={{ width: 76, height: 76 }}>
              {c.photo_thumb_path ? <img src={mediaUrl(c.photo_thumb_path)!} alt={c.produit} /> : <span className="photo-preview-empty">Aucune photo</span>}
            </div>
            <div className="detail-fields">
              <DetailField label="Produit">{c.produit}</DetailField>
              <DetailField label="Saison">{c.saison ?? "—"}</DetailField>
              <DetailField label="Année de collection">{c.annee_collection ?? "—"}</DetailField>
              <DetailField label="Rayon">{c.rayon ?? "—"}</DetailField>
            </div>
          </div>
        </div>

        <div className="detail-block">
          <h4>Organisation</h4>
          <div className="detail-fields detail-fields-2col">
            <DetailField label="Responsable">{c.responsable}</DetailField>
            <DetailField label="Atelier">{c.atelier}</DetailField>
            <DetailField label="Date limite de production">{c.date_fin_prevue}</DetailField>
            <DetailField label="Date de lancement prévue">{c.date_lancement}</DetailField>
            <DetailField label="Priorité">{PRIORITE_LABELS[c.priorite]}</DetailField>
          </div>
        </div>

        <div className="detail-block">
          <h4>Répartition couleurs × tailles</h4>
          <RepartitionTable lignes={c.lignes ?? []} />
          <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, color: "var(--v2-text-3, #6B6B62)" }}>
            <span>
              {new Set((c.lignes ?? []).map((l) => l.couleur)).size} couleur{new Set((c.lignes ?? []).map((l) => l.couleur)).size > 1 ? "s" : ""}
              {" · "}
              {new Set((c.lignes ?? []).filter((l) => l.taille).map((l) => l.taille)).size} taille{new Set((c.lignes ?? []).filter((l) => l.taille).map((l) => l.taille)).size > 1 ? "s" : ""}
              {" · "}
              {(c.lignes ?? []).length} variante{(c.lignes ?? []).length > 1 ? "s" : ""}
            </span>
            <span style={{ fontSize: 13.5, color: "var(--v2-text, #17181A)" }}>Quantité totale : <strong>{c.quantite_totale}</strong> pièces</span>
          </div>

          {/* Besoin théorique calculé à la volée depuis la fiche technique de l'article et les
              quantités ci-dessus — aucune valeur n'est stockée. Placé DANS ce bloc, juste sous la
              répartition qui l'alimente. Le composant ne rend rien si l'article n'a pas de fiche
              ou si sa fiche n'a pas de matières : aucun espace occupé pour rien.
              refreshKey = c.updated_at : le trigger trg_commandes_updated_at met à jour cette
              colonne à chaque modification de la répartition (update() recalcule quantite_totale
              et écrit donc sur la ligne commandes), ce qui suffit à déclencher le recalcul. */}
          <CommandeBesoinsMatieres commandeId={c.id} refreshKey={c.updated_at} />
        </div>

        {c.commentaires && (
          <div className="detail-block">
            <h4>Commentaires</h4>
            <p style={{ fontSize: 13.5, color: "#4B4B43" }}>{c.commentaires}</p>
          </div>
        )}

        <div className="detail-block detail-actions-block">
          <h4>Actions disponibles</h4>
          <div className="detail-actions">
            {/* Les mêmes statuts que ceux retenus par le module Approvisionnement : un brouillon
                ou une commande terminée ne s'approvisionne pas. La liste vient de là-bas, pour
                qu'il n'y ait pas deux définitions de « production approvisionnable ». */}
            {STATUTS_ELIGIBLES.indexOf(c.statut) !== -1 && (
              <button
                className="btn ghost"
                onClick={() => { onClose(); onPreparerBcMp([c.id]); }}
                title="Regrouper les besoins de cette production et préparer les bons de commande matières"
              >
                Préparer un bon de commande MP
              </button>
            )}
            {(() => {
              const bcActif = bcPfList.find((bc) => !bc.remplace_par);
              const bcEncoreModifiable = c.statut !== "brouillon" && c.statut !== "annulee" && bcActif && bcActif.statut === "brouillon";
              return bcEncoreModifiable ? (
                <button className="btn ghost" onClick={() => onEditBrouillon(c)}>Modifier</button>
              ) : null;
            })()}
            {c.archived ? (
              <button className="btn primary" onClick={() => setActiveDialog("desarchiver")}>Désarchiver</button>
            ) : c.statut === "brouillon" ? (
              <>
                <button className="btn ghost" onClick={() => onEditBrouillon(c)}>Modifier</button>
                <button className="btn primary" onClick={() => setActiveDialog("valider")}>Valider la commande</button>
                <button className="btn danger" onClick={() => setActiveDialog("supprimer")}>Supprimer définitivement</button>
              </>
            ) : c.statut === "validee" ? (
              <>
                <button className="btn primary" onClick={() => setShowLaunch(true)}><Icon name="play-circle" size={15} /> Lancer la production</button>
                <button className="btn ghost" onClick={() => setActiveDialog("annuler")}>Annuler</button>
                {c.bloquee
                  ? <button className="btn ghost" onClick={() => setActiveDialog("debloquer")}>Débloquer</button>
                  : <button className="btn ghost" onClick={() => setActiveDialog("bloquer")}>Bloquer</button>}
              </>
            ) : c.statut === "en_production" ? (
              <>
                <button className="btn primary" onClick={() => setActiveDialog("entrerCQ")}>Entrer en contrôle qualité</button>
                <button className="btn ghost" onClick={() => setActiveDialog("annuler")}>Annuler</button>
                {c.bloquee
                  ? <button className="btn ghost" onClick={() => setActiveDialog("debloquer")}>Débloquer</button>
                  : <button className="btn ghost" onClick={() => setActiveDialog("bloquer")}>Bloquer</button>}
              </>
            ) : c.statut === "controle_qualite" ? (
              <>
                <button className="btn primary" onClick={() => setActiveDialog("terminer")}>Terminer la production</button>
                <button className="btn ghost" onClick={() => setActiveDialog("annuler")}>Annuler</button>
                {c.bloquee
                  ? <button className="btn ghost" onClick={() => setActiveDialog("debloquer")}>Débloquer</button>
                  : <button className="btn ghost" onClick={() => setActiveDialog("bloquer")}>Bloquer</button>}
              </>
            ) : c.statut === "terminee" ? (
              <>
                <button className="btn ghost" onClick={handleImprimer}>Imprimer</button>
                <button className="btn ghost" onClick={handleExporter}>Exporter</button>
                <button className="btn primary" onClick={() => setActiveDialog("archiver")}>Archiver</button>
              </>
            ) : c.statut === "annulee" ? (
              <button className="btn primary" onClick={() => setActiveDialog("archiver")}>Archiver</button>
            ) : null}
          </div>
        </div>

        {c.statut !== "brouillon" && (
          <div className="detail-block">
            <h4>Bons de commande</h4>
            {bcPfList.length === 0 ? (
              <>
                <p style={{ fontSize: 13, color: "var(--v2-text-3)", marginTop: 0 }}>Aucun bon de commande n'existe encore pour cette commande.</p>
                <button className="btn ghost" onClick={handleCreerBcPf} disabled={creatingBcPf}>
                  {creatingBcPf ? "Création..." : "Créer un bon de commande"}
                </button>
              </>
            ) : (
              <div className="grid-table-wrap">
                <table className="grid-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Numéro</th>
                      <th style={{ textAlign: "left" }}>Nature</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bcPfList.map((bc) => (
                      <tr key={bc.id}>
                        <td className="grid-row-label">
                          <span style={{ fontWeight: 700 }}>{bc.numero}</span>
                          {(bc.remplace_numero || bc.remplace_par) && (
                            <div style={{ fontSize: 11.5, color: "var(--v2-text-3)", fontWeight: 400, marginTop: 2 }}>
                              {bc.remplace_numero && <>↱ Remplace {bc.remplace_numero}</>}
                              {bc.remplace_par && <>↱ Remplacé par {bc.remplace_par.numero}</>}
                            </div>
                          )}
                        </td>
                        <td style={{ textAlign: "left" }}>
                          <span className={`v2-badge ${bc.remplace_bc_pf_id ? "v2-badge-brouillon" : "v2-badge-terminee"}`}>
                            {bc.remplace_bc_pf_id ? "Remplacement" : "Original"}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button className="btn ghost tiny" onClick={() => handleConsulterBcPf(bc.id)}><Icon name="eye" size={13} /> Consulter</button>{" "}
                          <button className="btn ghost tiny" onClick={() => handleImprimerBcPf(bc.id)}><Icon name="print" size={13} /> Imprimer</button>{" "}
                          <button className="btn ghost tiny" onClick={() => handleTelechargerPdfBcPf(bc.id)}><Icon name="download" size={13} /> PDF</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {bcPfError && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginTop: 8 }}>{bcPfError}</p>}
          </div>
        )}

        {toast && <div className="toast">{toast}</div>}
      </div>


      {showLaunch && (
        <LancerProductionScreen
          commande={c}
          operateurActif={operateurActif}
          onCancel={() => setShowLaunch(false)}
          onLaunched={async () => {
            setShowLaunch(false);
            await afterSuccess("Production lancée.");
          }}
        />
      )}

      {activeDialog === "valider" && (
        <TransitionDialog
          title="Valider la commande ?"
          message={
            `Référence : ${c.article_reference_principale} — ${c.produit}\nQuantité totale : ${c.quantite_totale} pièces\n\n` +
            "Après validation, la commande recevra un numéro officiel et ses informations structurantes seront verrouillées. Elle ne pourra plus être supprimée."
          }
          confirmLabel="Valider la commande"
          onConfirm={async () => { await window.api.commandes.valider(c.id); await afterSuccess("Commande validée — numéro officiel attribué."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "supprimer" && (
        <TransitionDialog
          title="Supprimer ce brouillon ?"
          message="Cette commande brouillon sera supprimée définitivement. Cette opération est irréversible et aucune récupération ne sera possible."
          confirmLabel="Supprimer définitivement"
          danger
          onConfirm={async () => { await window.api.commandes.remove(c.id); onChanged(); notify("Brouillon supprimé."); onClose(); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "annuler" && (
        <TransitionDialog
          title="Annuler cette commande ?"
          message={
            c.statut === "validee"
              ? "Cette commande officielle sera annulée et restera dans l'historique."
              : "⚠️ Cette commande est déjà en production ou en contrôle qualité : du travail ou des matières ont peut-être déjà été engagés. Elle restera dans l'historique, mais ne pourra plus jamais être remise en production."
          }
          confirmLabel="Confirmer l'annulation"
          danger
          requiresMotif
          motifLabel="Motif d'annulation"
          onConfirm={async (motif) => { await window.api.commandes.annuler(c.id, motif!); await afterSuccess("Commande annulée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "bloquer" && (
        <TransitionDialog
          title="Bloquer cette commande ?"
          message="La commande restera visible dans son statut actuel, mais sera signalée comme bloquée jusqu'à son déblocage."
          confirmLabel="Bloquer"
          requiresMotif
          motifLabel="Motif du blocage"
          onConfirm={async (motif) => { await window.api.commandes.bloquer(c.id, motif!); await afterSuccess("Commande bloquée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "debloquer" && (
        <TransitionDialog
          title="Débloquer cette commande ?"
          message="La commande reprendra son cours normal dans son statut actuel."
          confirmLabel="Débloquer"
          existingMotif={c.blocage_motif}
          onConfirm={async () => { await window.api.commandes.debloquer(c.id); await afterSuccess("Commande débloquée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "entrerCQ" && (
        <TransitionDialog
          title="Faire entrer en contrôle qualité ?"
          message={`Référence : ${c.reference_production}\nQuantité totale : ${c.quantite_totale} pièces\n\nLa commande passera au statut "Contrôle qualité".`}
          confirmLabel="Confirmer"
          onConfirm={async () => { await window.api.commandes.entrerEnControleQualite(c.id); await afterSuccess("Entrée en contrôle qualité enregistrée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "terminer" && (
        <TransitionDialog
          title="Terminer la production ?"
          message={`Référence : ${c.reference_production}\nQuantité totale : ${c.quantite_totale} pièces\n\nLa commande sera marquée "Terminée".`}
          confirmLabel="Terminer la production"
          onConfirm={async () => { await window.api.commandes.terminerProduction(c.id); await afterSuccess("Production terminée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "archiver" && (
        <TransitionDialog
          title="Archiver cette commande ?"
          message="L'archivage ne supprime aucune donnée : la commande reste consultable, imprimable et exportable, mais disparaît de la liste principale."
          confirmLabel="Archiver"
          onConfirm={async () => { await window.api.commandes.archiver(c.id); await afterSuccess("Commande archivée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {activeDialog === "desarchiver" && (
        <TransitionDialog
          title="Désarchiver cette commande ?"
          message="Aucune donnée n'a été supprimée pendant l'archivage : la commande réapparaîtra immédiatement dans la liste principale."
          confirmLabel="Désarchiver"
          onConfirm={async () => { await window.api.commandes.desarchiver(c.id); await afterSuccess("Commande désarchivée."); }}
          onCancel={() => setActiveDialog(null)}
        />
      )}

      {showBcPf && bcPfId != null && (
        <BcPfDetailModal
          bcPfId={bcPfId}
          autoPrint={autoPrintBcPf}
          autoDownloadPdf={autoDownloadBcPf}
          onClose={() => { setShowBcPf(false); setBcPfId(null); setAutoPrintBcPf(false); setAutoDownloadBcPf(false); }}
          onChanged={refresh}
        />
      )}
    </div>
  );
}
