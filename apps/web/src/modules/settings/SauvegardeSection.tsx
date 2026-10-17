import { useEffect, useState } from "react";

// Sauvegardes — version web.
//
// La base et les fichiers sont sur le serveur. Cet écran permet à un administrateur de lancer une
// sauvegarde complète immédiate (base + images + manifeste), de la vérifier et de la télécharger.
// La sauvegarde automatique de chaque nuit (vers Cloudflare R2, 5 versions, e-mail de compte
// rendu) tourne sur le serveur, sans intervention.
// La RESTAURATION n'est volontairement pas proposée ici : remplacer la base sous les pieds des
// autres utilisateurs est trop dangereux ; elle suit une procédure d'administration écrite.

function api(): any { return (window as any).api; }

type Controle = { libelle: string; ok: boolean; detail: string | null };
type Sauvegarde = { nom: string; cree_le: string | null; motif: string | null; version: string | null; taille: number };

function octets(n: number | null | undefined) {
  if (n == null) return "—";
  const u = ["o", "Ko", "Mo", "Go"];
  let v = Number(n), i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i += 1; }
  return (i === 0 ? v.toFixed(0) : v.toFixed(v < 10 ? 2 : 1)) + " " + u[i];
}

export default function SauvegardeSection({ notify }: { notify: (m: string) => void }) {
  const [liste, setListe] = useState<Sauvegarde[] | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [controles, setControles] = useState<{ nom: string; ok: boolean; controles: Controle[] } | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  async function charger() {
    try { setListe(await api().system.listerSauvegardes()); setErreur(null); }
    catch (err: any) { setErreur(err?.message || "Liste des sauvegardes indisponible."); }
  }
  useEffect(() => { charger(); }, []);

  async function sauvegarder() {
    setOccupe("sauvegarde"); setErreur(null); setControles(null);
    try {
      const r = await api().system.backup({ motif: "manuelle" });
      setControles({ nom: r.nom, ok: r.rapport.ok, controles: r.rapport.controles });
      notify(r.rapport.ok ? "Sauvegarde terminée et vérifiée." : "Sauvegarde terminée, mais la vérification signale un problème.");
      await charger();
    } catch (err: any) { setErreur(err?.message || "La sauvegarde a échoué."); }
    finally { setOccupe(null); }
  }

  async function verifier(nom: string) {
    setOccupe("verif:" + nom); setErreur(null);
    try {
      const r = await api().system.verifierSauvegarde(nom);
      setControles({ nom, ok: r.rapport.ok, controles: r.rapport.controles });
    } catch (err: any) { setErreur(err?.message || "Vérification impossible."); }
    finally { setOccupe(null); }
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: "#4B4B43", marginTop: 0 }}>
        <strong>Chaque nuit à minuit</strong>, la base est sauvegardée automatiquement hors du serveur (5 versions
        conservées, e-mail de compte rendu). Vous pouvez en plus créer ici une sauvegarde <strong>complète</strong> —
        base de données <strong>et</strong> toutes les images — par exemple avant une opération importante.
      </p>
      <button className="btn primary" disabled={!!occupe} onClick={sauvegarder}>
        {occupe === "sauvegarde" ? "Sauvegarde en cours…" : "Sauvegarder maintenant"}
      </button>
      {erreur && <p style={{ color: "#B42318", fontSize: 13 }}>{erreur}</p>}

      {controles && (
        <div style={{ marginTop: 14, padding: 12, borderRadius: 8, background: controles.ok ? "#E7F4EC" : "#FDE8E8" }}>
          <strong>{controles.ok ? "Sauvegarde exploitable" : "Problème détecté"}</strong> — {controles.nom}
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12.5 }}>
            {controles.controles.map((c) => (
              <li key={c.libelle}>{c.ok ? "✔" : "✖"} {c.libelle}{c.detail ? ` — ${c.detail}` : ""}</li>
            ))}
          </ul>
        </div>
      )}

      <h4 style={{ margin: "18px 0 6px" }}>Sauvegardes complètes sur le serveur</h4>
      {liste === null ? <p style={{ fontSize: 13 }}>Chargement…</p> : liste.length === 0 ? (
        <p style={{ fontSize: 13, color: "#6B6B62" }}>Aucune sauvegarde complète pour l'instant.</p>
      ) : (
        <table className="table" style={{ width: "100%", fontSize: 13 }}>
          <thead><tr><th>Date</th><th>Motif</th><th>Taille</th><th></th></tr></thead>
          <tbody>
            {liste.map((s) => (
              <tr key={s.nom}>
                <td>{s.cree_le ? new Date(s.cree_le).toLocaleString("fr-FR") : s.nom}</td>
                <td>{s.motif || "—"}</td>
                <td>{octets(s.taille)}</td>
                <td style={{ whiteSpace: "nowrap", textAlign: "right" }}>
                  <button className="btn ghost tiny" disabled={!!occupe} onClick={() => verifier(s.nom)}>
                    {occupe === "verif:" + s.nom ? "Vérification…" : "Vérifier"}
                  </button>{" "}
                  <button className="btn ghost tiny" onClick={() => api().system.telechargerSauvegarde(s.nom, "base.dump")}>Base</button>{" "}
                  <button className="btn ghost tiny" onClick={() => api().system.telechargerSauvegarde(s.nom, "fichiers.tar.gz")}>Images</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p style={{ fontSize: 12, color: "#6B6B62", marginTop: 12 }}>
        La restauration d'une sauvegarde se fait sur le serveur par un administrateur (procédure documentée), jamais
        depuis cet écran.
      </p>
    </div>
  );
}
