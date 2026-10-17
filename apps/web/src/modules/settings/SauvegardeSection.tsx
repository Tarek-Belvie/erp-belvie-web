import { useEffect, useState } from "react";
import ConfirmDialog from "../commandes/ConfirmDialog";

// Sauvegarde et restauration — lot 2.
//
// L'écran précédent proposait deux boutons et une phrase. Il disait « base + photos des
// articles », et c'était exact : la sauvegarde ne copiait qu'un dossier d'images sur cinq.
// Sur les données réelles, 93 images — croquis techniques et logo compris — n'y étaient pas.
//
// Cet écran-ci fait trois choses que l'autre ne faisait pas :
//   - il dit CE QUI EST DANS la sauvegarde, et le prouve avec le résultat des contrôles ;
//   - il permet d'ESSAYER une restauration dans un dossier isolé, sans toucher aux données ;
//   - il refuse de restaurer une sauvegarde qui n'a pas passé la vérification.

function pont(): any { return (window as any).api; }

type Controle = { nom: string; etat: "ok" | "echec" | "non-effectue" | "sans-objet"; detail: string | null };
type Rapport = { ok: boolean; dossier: string; type?: string; cree_le?: string; controles: Controle[] };

const PUCE: Record<string, { texte: string; couleur: string; fond: string }> = {
  ok: { texte: "OK", couleur: "#116B43", fond: "#E7F4EC" },
  echec: { texte: "ÉCHEC", couleur: "#B42318", fond: "#FDE8E8" },
  "non-effectue": { texte: "non fait", couleur: "#8A5A05", fond: "#FEF3C7" },
  "sans-objet": { texte: "sans objet", couleur: "#4B4B43", fond: "#EEF0EA" },
};

function octets(n: number | null | undefined) {
  if (n == null) return "—";
  const u = ["o", "Ko", "Mo", "Go"];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)) + " " + u[i];
}

export default function SauvegardeSection({ notify }: { notify: (m: string) => void }) {
  const [externe, setExterne] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [rapport, setRapport] = useState<Rapport | null>(null);
  const [resume, setResume] = useState<string | null>(null);
  const [confirmRestaurer, setConfirmRestaurer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try { setExterne((await pont().system.dossierExterne()).dossier); } catch (_) { /* avant rechargement du preload */ }
    })();
  }, []);

  function echouer(err: any, repli: string) {
    setErreur(err?.message || repli);
    setRapport(null);
  }

  async function choisirExterne() {
    try {
      const r = await pont().system.choisirDossierExterne();
      if (!r.canceled) { setExterne(r.dossier); notify("Emplacement enregistré : " + r.dossier); }
    } catch (err: any) { echouer(err, "Impossible d'enregistrer cet emplacement."); }
  }

  async function sauvegarder() {
    setOccupe("sauvegarde"); setErreur(null); setRapport(null); setResume(null);
    try {
      const r = await pont().system.backup({ memoriser: true });
      if (r.canceled) return;
      const m = r.manifeste;
      setRapport(r.verification);
      setResume(
        "Sauvegarde écrite dans " + r.folderPath + " — "
        + (m.images?.totaux?.fichiers ?? 0) + " image(s) (" + octets(m.images?.totaux?.octets) + "), "
        + "base de " + octets(m.base?.octets_copies) + ", "
        + (m.references_base?.citees ?? 0) + " référence(s) vérifiée(s)."
      );
      setExterne((await pont().system.dossierExterne()).dossier);
      notify(r.verification.ok
        ? "Sauvegarde complète terminée et vérifiée."
        : "Sauvegarde écrite, mais la vérification a signalé un problème — voir le détail.");
    } catch (err: any) { echouer(err, "La sauvegarde a échoué."); }
    finally { setOccupe(null); }
  }

  async function verifier() {
    setOccupe("verification"); setErreur(null); setRapport(null); setResume(null);
    try {
      const r = await pont().system.verifierSauvegarde();
      if (r.canceled) return;
      setRapport(r.rapport);
      setResume("Sauvegarde du " + (r.rapport.cree_le || "?").slice(0, 10)
        + ", type « " + (r.rapport.type || "inconnu") + " » : " + r.rapport.dossier);
      notify(r.rapport.ok ? "Cette sauvegarde est exploitable." : "Cette sauvegarde a un problème.");
    } catch (err: any) { echouer(err, "La vérification a échoué."); }
    finally { setOccupe(null); }
  }

  async function essayer() {
    setOccupe("essai"); setErreur(null); setRapport(null); setResume(null);
    try {
      const r = await pont().system.essaiRestauration();
      if (r.canceled) return;
      setRapport(r.verification_essai);
      setResume(
        (r.ok ? "Essai réussi : " : "Essai en échec : ")
        + r.fichiers_restaures + " fichier(s) restauré(s) dans " + r.dossier_essai
        + ". Votre dossier de données n'a pas été touché."
      );
      notify(r.ok ? "La restauration d'essai a réussi." : "La restauration d'essai a échoué.");
    } catch (err: any) { echouer(err, "L'essai de restauration a échoué."); }
    finally { setOccupe(null); }
  }

  async function restaurer() {
    setConfirmRestaurer(false);
    setOccupe("restauration"); setErreur(null); setRapport(null); setResume(null);
    try {
      const r = await pont().system.restore();
      if (r.canceled) return;
      setRapport(r.verification);
      setResume(
        "Restauré depuis " + r.restoredFrom + ". Vos données précédentes ont été DÉPLACÉES "
        + "(et non supprimées) dans : " + r.donnees_precedentes
      );
      notify("Restauration terminée. Redémarrez l'application pour tout rafraîchir.");
    } catch (err: any) { echouer(err, "La restauration a échoué. Rien n'a été modifié."); }
    finally { setOccupe(null); }
  }

  return (
    <>
      <div className="settings-section">
        <h3>Sauvegarde complète</h3>
        <p className="desc">
          Une sauvegarde complète contient <strong>la base de données, la totalité des images</strong>
          {" "}— photos d'articles, croquis techniques, photos de fournitures, logo, images figées des
          bons de commande —, <strong>vos documents et vos paramètres</strong>. Elle est accompagnée
          d'un manifeste qui note l'empreinte de chaque fichier, et elle est vérifiée
          immédiatement après avoir été écrite.
        </p>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", margin: "10px 0 12px" }}>
          <span style={{ fontSize: 12.5, color: "var(--v2-text-3, #6B6B62)" }}>Emplacement habituel :</span>
          <code style={{ fontSize: 12, background: "#F2F3EE", padding: "3px 8px", borderRadius: 5 }}>
            {externe || "aucun — choisissez une clé USB ou un disque externe"}
          </code>
          <button className="btn ghost tiny" onClick={choisirExterne}>
            {externe ? "Changer" : "Choisir"}
          </button>
        </div>
        <p className="desc" style={{ marginTop: 0 }}>
          Cet emplacement sert aussi aux sauvegardes faites automatiquement <strong>avant une
          migration</strong>. S'il n'est pas renseigné — ou s'il n'est pas branché le jour venu —
          la sauvegarde se fait dans le dossier de données, et l'application vous prévient qu'elle
          est sur le même disque que l'original : elle protège alors d'une migration ratée, pas
          d'une panne de disque.
        </p>

        <div className="settings-actions">
          <button className="btn primary" disabled={!!occupe} onClick={sauvegarder}>
            {occupe === "sauvegarde" ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
          </button>
          <button className="btn ghost" disabled={!!occupe} onClick={verifier}>
            {occupe === "verification" ? "Vérification…" : "Vérifier une sauvegarde"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Essayer une restauration, sans risque</h3>
        <p className="desc">
          Restaure une sauvegarde dans un <strong>dossier vide de votre choix</strong>, puis vérifie
          le résultat. C'est la seule façon de savoir si une sauvegarde est réellement exploitable —
          y compris ses croquis et son logo — <strong>sans toucher à vos données</strong>. L'essai
          refuse catégoriquement d'écrire dans votre dossier de données.
        </p>
        <div className="settings-actions">
          <button className="btn ghost" disabled={!!occupe} onClick={essayer}>
            {occupe === "essai" ? "Essai en cours…" : "Essayer une restauration"}
          </button>
        </div>
      </div>

      <div className="settings-section">
        <h3>Restaurer pour de bon</h3>
        <p className="desc">
          Remplace vos données actuelles par celles d'une sauvegarde. La sauvegarde est
          <strong> vérifiée d'abord</strong> : si elle échoue, rien n'est modifié. Vos données
          actuelles sont <strong>déplacées, jamais supprimées</strong>, dans un dossier horodaté, et
          vos sauvegardes existantes ne sont pas touchées.
        </p>
        <div className="settings-actions">
          <button className="btn ghost" disabled={!!occupe} onClick={() => setConfirmRestaurer(true)}>
            {occupe === "restauration" ? "Restauration…" : "Restaurer depuis une sauvegarde"}
          </button>
        </div>
      </div>

      {erreur && (
        <div className="settings-section" style={{ borderColor: "#F4C8C8", background: "#FDF4F4" }}>
          <h3 style={{ color: "#B42318" }}>Échec</h3>
          <p className="desc" style={{ color: "#B42318", whiteSpace: "pre-wrap" }}>{erreur}</p>
        </div>
      )}

      {rapport && (
        <div className="settings-section">
          <h3>
            {rapport.ok ? "Cette sauvegarde est exploitable" : "Cette sauvegarde a un problème"}
          </h3>
          {resume && <p className="desc" style={{ wordBreak: "break-all" }}>{resume}</p>}
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {rapport.controles.map((c, i) => {
                const p = PUCE[c.etat] || PUCE["non-effectue"];
                return (
                  <tr key={i} style={{ borderTop: i === 0 ? "none" : "1px solid #F0F1EC" }}>
                    <td style={{ padding: "6px 8px 6px 0", width: 92, verticalAlign: "top" }}>
                      <span style={{
                        display: "inline-block", fontSize: 10.5, fontWeight: 700, padding: "2px 7px",
                        borderRadius: 999, background: p.fond, color: p.couleur, whiteSpace: "nowrap",
                      }}>{p.texte}</span>
                    </td>
                    <td style={{ padding: "6px 0", fontSize: 12.5 }}>
                      {c.nom}
                      {c.detail && (
                        <span style={{ display: "block", fontSize: 11.5, color: "var(--v2-text-3, #8A8A82)", marginTop: 2 }}>
                          {c.detail}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {confirmRestaurer && (
        <ConfirmDialog
          title="Restaurer une sauvegarde ?"
          message={
            "Vos données actuelles seront DÉPLACÉES dans un dossier horodaté — elles ne seront pas "
            + "supprimées, et vous pourrez revenir en arrière. La sauvegarde sera vérifiée avant "
            + "tout remplacement : si elle échoue, rien ne sera modifié. Une sauvegarde automatique "
            + "sera refusée, car elle ne contient pas les images."
          }
          confirmLabel="Choisir une sauvegarde et restaurer"
          danger
          onConfirm={restaurer}
          onCancel={() => setConfirmRestaurer(false)}
        />
      )}
    </>
  );
}
