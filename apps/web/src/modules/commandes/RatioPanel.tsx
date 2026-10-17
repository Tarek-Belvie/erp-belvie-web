import { useEffect, useMemo, useState } from "react";
import { ListeValeur } from "../../shared/types";
import { repartirParRatio, PoidsTaille } from "./repartitionRatio";
import ConfirmDialog from "./ConfirmDialog";

// Types décrits ici plutôt que dans shared/types.ts : ils ne servent qu'à ce panneau, et
// cela évite de modifier un fichier partagé pour une fonctionnalité isolée.
interface RatioLigne {
  id: number;
  taille_id: number;
  poids: number;
  taille_nom: string;
  ordre: number;
}
interface RepartitionRatio {
  id: number;
  nom: string;
  grille_id: number;
  lignes: RatioLigne[];
}

// window.api n'est pas typé dans ce projet au niveau de shared/types : on passe par un
// accès non typé plutôt que de modifier la déclaration globale, qu'aucun autre module
// n'a besoin de connaître pour cette fonctionnalité.
const api: any = (window as any).api;

// Panneau de répartition automatique par ratio de tailles.
//
// Il ne modifie jamais la base : il calcule des quantités et les remet à CommandeWizard
// via onApply, exactement comme si elles avaient été tapées à la main dans le tableau.
// Toutes les cases restent donc modifiables après application, et la validation de la
// commande reste strictement la même.
//
// Deux modes, un seul moteur de calcul :
//   - "individuelle" : une couleur, un ratio, une quantité totale ;
//   - "lot"          : plusieurs couleurs, le MÊME ratio, une quantité totale par couleur.

interface Props {
  grilleId: number | null;
  grilleNom: string | null;
  /** Tailles sélectionnées (colonnes du tableau), déjà dans l'ordre de la grille. */
  tailles: ListeValeur[];
  /** Couleurs sélectionnées (lignes du tableau). */
  couleurs: ListeValeur[];
  quantities: Record<string, number>;
  onApply: (cells: { couleur_id: number; taille_id: number; quantite: number }[]) => void;
  onClose: () => void;
}

type Mode = "individuelle" | "lot";

function cellKey(couleurId: number, tailleId: number) {
  return `${couleurId}:${tailleId}`;
}

// Accepte indifféremment la virgule et le point : 0,5 et 0.5 sont la même chose pour un
// utilisateur francophone, et refuser l'une des deux formes serait une friction inutile.
function lirePoids(saisie: string | undefined): number {
  const texte = String(saisie ?? "").trim().replace(",", ".");
  if (texte === "") return 0;
  const valeur = Number(texte);
  return Number.isFinite(valeur) ? valeur : NaN;
}

function lireTotal(saisie: string | undefined): number {
  const texte = String(saisie ?? "").trim();
  if (texte === "") return NaN;
  const valeur = Number(texte);
  return Number.isFinite(valeur) ? valeur : NaN;
}

export default function RatioPanel({ grilleId, grilleNom, tailles, couleurs, quantities, onApply, onClose }: Props) {
  const [mode, setMode] = useState<Mode>("individuelle");
  const [poids, setPoids] = useState<Record<number, string>>({});
  const [cibles, setCibles] = useState<number[]>(() => (couleurs.length === 1 ? [couleurs[0].id] : []));
  const [totaux, setTotaux] = useState<Record<number, string>>({});
  const [apercu, setApercu] = useState<{ couleur_id: number; total: number; lignes: { taille_id: number; quantite: number }[] }[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const [ratios, setRatios] = useState<RepartitionRatio[]>([]);
  const [ratioNom, setRatioNom] = useState("");
  const [infoRatio, setInfoRatio] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRemplacement, setConfirmRemplacement] = useState<number | null>(null);

  // Ratios déjà enregistrés pour CETTE grille uniquement : un ratio "Vêtements" n'a aucun
  // sens sur une grille numérique, il ne doit donc même pas être proposé.
  useEffect(() => {
    let annule = false;
    if (grilleId == null) { setRatios([]); return; }
    api.ratiosRepartition
      .listPourGrille(grilleId)
      .then((list: RepartitionRatio[]) => { if (!annule) setRatios(list || []); })
      .catch(() => { if (!annule) setRatios([]); });
    return () => { annule = true; };
  }, [grilleId]);

  // Toute modification du ratio, des couleurs ciblées ou des totaux invalide l'aperçu :
  // on ne doit jamais pouvoir appliquer des chiffres qui ne correspondent plus à l'écran.
  useEffect(() => { setApercu(null); }, [mode, poids, cibles, totaux]);

  function toggleCible(couleurId: number) {
    if (mode === "individuelle") { setCibles([couleurId]); return; }
    setCibles((prev) => (prev.includes(couleurId) ? prev.filter((x) => x !== couleurId) : [...prev, couleurId]));
  }

  function changerMode(nouveau: Mode) {
    setMode(nouveau);
    // En passant en mode individuel, on ne garde qu'une seule couleur : afficher plusieurs
    // couleurs ciblées dans un mode qui n'en traite qu'une serait trompeur.
    if (nouveau === "individuelle") setCibles((prev) => (prev.length > 0 ? [prev[0]] : []));
  }

  const poidsListe: PoidsTaille[] = useMemo(
    () => tailles.map((t) => ({ taille_id: t.id, poids: lirePoids(poids[t.id]) })),
    [tailles, poids]
  );
  const sommeRatio = poidsListe.reduce((s, p) => s + (Number.isFinite(p.poids) && p.poids > 0 ? p.poids : 0), 0);

  function calculerApercu() {
    setErreur(null);
    if (cibles.length === 0) { setErreur("Sélectionnez au moins une couleur à répartir."); return; }
    if (poidsListe.some((p) => Number.isNaN(p.poids))) { setErreur("Un poids de ratio n'est pas un nombre valide."); return; }
    try {
      const resultat = cibles.map((couleurId) => {
        const total = lireTotal(totaux[couleurId]);
        if (Number.isNaN(total)) {
          const nom = couleurs.find((c) => c.id === couleurId)?.nom ?? "cette couleur";
          throw new Error(`Saisissez la quantité totale pour « ${nom} ».`);
        }
        if (!Number.isInteger(total)) throw new Error("Les quantités totales doivent être des nombres entiers.");
        return { couleur_id: couleurId, total, lignes: repartirParRatio(total, poidsListe) };
      });
      setApercu(resultat);
    } catch (err: any) {
      setApercu(null);
      setErreur(err?.message || "Calcul impossible.");
    }
  }

  // Cellules déjà renseignées qui seraient écrasées par l'application du ratio.
  const conflits = useMemo(() => {
    if (!apercu) return [];
    const liste: { couleur: string; taille: string; ancienne: number; nouvelle: number }[] = [];
    apercu.forEach((a) => {
      a.lignes.forEach((l) => {
        const ancienne = quantities[cellKey(a.couleur_id, l.taille_id)];
        if (ancienne != null && ancienne > 0 && ancienne !== l.quantite) {
          liste.push({
            couleur: couleurs.find((c) => c.id === a.couleur_id)?.nom ?? "?",
            taille: tailles.find((t) => t.id === l.taille_id)?.nom ?? "?",
            ancienne,
            nouvelle: l.quantite,
          });
        }
      });
    });
    return liste;
  }, [apercu, quantities, couleurs, tailles]);

  function appliquer() {
    if (!apercu) return;
    const cells = apercu.flatMap((a) => a.lignes.map((l) => ({ couleur_id: a.couleur_id, taille_id: l.taille_id, quantite: l.quantite })));
    onApply(cells);
    onClose();
  }

  function demanderApplication() {
    if (!apercu) return;
    if (conflits.length > 0) { setConfirmRemplacement(conflits.length); return; }
    appliquer();
  }

  function chargerRatio(ratioId: number) {
    const ratio = ratios.find((r) => r.id === ratioId);
    if (!ratio) return;
    const prochain: Record<number, string> = {};
    ratio.lignes.forEach((l) => { prochain[l.taille_id] = String(l.poids).replace(".", ","); });
    setPoids(prochain);
    setRatioNom(ratio.nom);
    // Un ratio peut contenir des tailles qui ne sont pas sélectionnées sur cette commande :
    // on le dit, plutôt que de laisser croire que le ratio est appliqué en entier.
    const absentes = ratio.lignes
      .filter((l) => l.poids > 0 && !tailles.some((t) => t.id === l.taille_id))
      .map((l) => l.taille_nom);
    setInfoRatio(
      absentes.length > 0
        ? `Ce ratio contient aussi ${absentes.join(", ")} — non sélectionnée(s) sur cette commande, donc ignorée(s).`
        : null
    );
  }

  async function enregistrerRatio() {
    const nom = ratioNom.trim();
    if (!nom) { setErreur("Donnez un nom à ce ratio avant de l'enregistrer."); return; }
    if (grilleId == null) { setErreur("Aucune grille de tailles n'est connue : impossible d'enregistrer un ratio."); return; }
    if (!(sommeRatio > 0)) { setErreur("Renseignez au moins un poids supérieur à 0 avant d'enregistrer ce ratio."); return; }
    setBusy(true);
    setErreur(null);
    try {
      const lignes = poidsListe.filter((p) => Number.isFinite(p.poids) && p.poids > 0).map((p) => ({ taille_id: p.taille_id, poids: p.poids }));
      await api.ratiosRepartition.enregistrer({ nom, grille_id: grilleId, lignes });
      const list = await api.ratiosRepartition.listPourGrille(grilleId);
      setRatios(list || []);
      setInfoRatio(`Ratio « ${nom} » enregistré.`);
    } catch (err: any) {
      setErreur(err?.message || "Enregistrement impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function supprimerRatio(ratioId: number) {
    setBusy(true);
    try {
      await api.ratiosRepartition.supprimer(ratioId);
      const list = await api.ratiosRepartition.listPourGrille(grilleId as number);
      setRatios(list || []);
    } catch (err: any) {
      setErreur(err?.message || "Suppression impossible.");
    } finally {
      setBusy(false);
    }
  }

  const champ: React.CSSProperties = {
    border: "1px solid var(--v2-border, #D8D9D0)", borderRadius: 6, padding: "5px 7px", fontSize: 13,
  };
  const label: React.CSSProperties = {
    fontSize: 10.5, textTransform: "uppercase", letterSpacing: ".04em", color: "#5B5B54", fontWeight: 600, marginBottom: 4,
  };

  if (tailles.length === 0) {
    return (
      <div style={{ border: "1px solid #E7E9E0", borderRadius: 10, background: "#FBFBF8", padding: 14, marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <strong style={{ fontSize: 14 }}>Répartir par ratio</strong>
          <button className="btn ghost tiny" onClick={onClose}>Fermer</button>
        </div>
        <p style={{ fontSize: 12.5, color: "var(--v2-text-2)", margin: "8px 0 0" }}>
          Sélectionnez d'abord les tailles concernées : le ratio se définit taille par taille.
        </p>
      </div>
    );
  }

  return (
    <div style={{ border: "1px solid #D8D9D0", borderRadius: 10, background: "#FBFBF8", padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <strong style={{ fontSize: 15 }}>Répartir par ratio</strong>
          <div style={{ fontSize: 12, color: "var(--v2-text-3)", marginTop: 2 }}>
            Les quantités calculées restent entièrement modifiables à la main
            {grilleNom ? ` — grille ${grilleNom}` : ""}
          </div>
        </div>
        <button className="btn ghost tiny" onClick={onClose}>Fermer</button>
      </div>

      {/* --- Mode --- */}
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <button
          className={`btn ghost tiny ${mode === "individuelle" ? "ft-vue-active" : ""}`}
          style={mode === "individuelle" ? { borderColor: "#0E9F6E", color: "#047857", fontWeight: 600 } : undefined}
          onClick={() => changerMode("individuelle")}
        >
          Une couleur
        </button>
        <button
          className={`btn ghost tiny ${mode === "lot" ? "ft-vue-active" : ""}`}
          style={mode === "lot" ? { borderColor: "#0E9F6E", color: "#047857", fontWeight: 600 } : undefined}
          onClick={() => changerMode("lot")}
        >
          Lot de couleurs
        </button>
        <span style={{ fontSize: 11.5, color: "var(--v2-text-3)", alignSelf: "center" }}>
          {mode === "individuelle"
            ? "Un ratio, une couleur, une quantité totale."
            : "Le même ratio appliqué à plusieurs couleurs, avec une quantité totale propre à chacune."}
        </span>
      </div>

      {/* --- Ratios enregistrés --- */}
      <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <div style={label}>Réutiliser un ratio</div>
          <select
            value=""
            onChange={(e) => { const id = Number(e.target.value); if (id) chargerRatio(id); }}
            style={{ ...champ, minWidth: 200 }}
            disabled={ratios.length === 0}
          >
            <option value="">{ratios.length === 0 ? "— aucun ratio enregistré —" : "— choisir —"}</option>
            {ratios.map((r) => (
              <option key={r.id} value={r.id}>
                {r.nom} ({r.lignes.map((l) => `${l.taille_nom}:${String(l.poids).replace(".", ",")}`).join(" / ")})
              </option>
            ))}
          </select>
        </div>
        <div>
          <div style={label}>Nom du ratio</div>
          <input type="text" value={ratioNom} onChange={(e) => setRatioNom(e.target.value)} placeholder="Ex : Courbe standard" style={{ ...champ, width: 180 }} />
        </div>
        <button className="btn ghost tiny" onClick={enregistrerRatio} disabled={busy}>Enregistrer ce ratio</button>
        {ratios.some((r) => r.nom.trim().toLowerCase() === ratioNom.trim().toLowerCase()) && ratioNom.trim() !== "" && (
          <button
            className="btn ghost tiny"
            style={{ color: "#C0392B" }}
            disabled={busy}
            onClick={() => {
              const r = ratios.find((x) => x.nom.trim().toLowerCase() === ratioNom.trim().toLowerCase());
              if (r) supprimerRatio(r.id);
            }}
          >
            Supprimer
          </button>
        )}
      </div>

      {infoRatio && <p style={{ fontSize: 12, color: "var(--v2-text-2)", margin: "0 0 12px" }}>{infoRatio}</p>}

      {/* --- Le ratio lui-même --- */}
      <div style={{ marginBottom: 14 }}>
        <div style={label}>Ratio des tailles</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          {tailles.map((t) => (
            <div key={t.id} style={{ textAlign: "center" }}>
              <div style={{ fontSize: 11.5, color: "var(--v2-text-2)", marginBottom: 3, fontWeight: 600 }}>{t.nom}</div>
              <input
                type="text"
                inputMode="decimal"
                value={poids[t.id] ?? ""}
                onChange={(e) => setPoids((prev) => ({ ...prev, [t.id]: e.target.value }))}
                placeholder="0"
                style={{ ...champ, width: 52, textAlign: "center" }}
              />
            </div>
          ))}
          <div style={{ fontSize: 11.5, color: "var(--v2-text-3)", paddingBottom: 6, marginLeft: 6 }}>
            somme : {sommeRatio > 0 ? String(Number(sommeRatio.toFixed(4))).replace(".", ",") : "—"}
          </div>
        </div>
        <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "6px 0 0" }}>
          Des proportions, pas des quantités : 1 / 2 / 3 / 2 / 1 donne la même répartition que 10 / 20 / 30 / 20 / 10.
          Les décimales sont acceptées. Une taille laissée vide reçoit 0 pièce.
        </p>
      </div>

      {/* --- Couleurs et quantités totales --- */}
      <div style={{ marginBottom: 14 }}>
        <div style={label}>{mode === "individuelle" ? "Couleur à répartir" : "Couleurs du lot"}</div>
        {couleurs.length === 0 ? (
          <p style={{ fontSize: 12.5, color: "var(--v2-text-2)", margin: 0 }}>
            Sélectionnez au moins une couleur dans le tableau pour pouvoir répartir.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {couleurs.map((c) => {
              const actif = cibles.includes(c.id);
              return (
                <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    className="btn ghost tiny"
                    onClick={() => toggleCible(c.id)}
                    style={{
                      minWidth: 150, textAlign: "left",
                      borderColor: actif ? "#0E9F6E" : undefined,
                      color: actif ? "#047857" : undefined,
                      fontWeight: actif ? 600 : 400,
                    }}
                  >
                    {actif ? "✓ " : ""}{c.nom}
                  </button>
                  <input
                    type="number" min={0} step={1} inputMode="numeric"
                    value={totaux[c.id] ?? ""}
                    onChange={(e) => setTotaux((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder="Quantité totale"
                    disabled={!actif}
                    style={{ ...champ, width: 130, opacity: actif ? 1 : 0.45 }}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>pièces</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {erreur && (
        <p style={{ background: "var(--v2-danger-bg, #FBEAE6)", color: "var(--v2-danger, #9A3412)", padding: "8px 11px", borderRadius: 6, fontSize: 12.5, margin: "0 0 12px" }}>
          {erreur}
        </p>
      )}

      {/* --- Aperçu --- */}
      {apercu && (
        <div style={{ border: "1px solid #E7E9E0", borderRadius: 8, background: "#fff", padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 8 }}>Aperçu — rien n'est encore appliqué</div>
          <div className="grid-table-wrap">
            <table className="grid-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Couleur</th>
                  {tailles.map((t) => <th key={t.id}>{t.nom}</th>)}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {apercu.map((a) => {
                  const calcule = a.lignes.reduce((s, l) => s + l.quantite, 0);
                  return (
                    <tr key={a.couleur_id}>
                      <td className="grid-row-label">{couleurs.find((c) => c.id === a.couleur_id)?.nom ?? "?"}</td>
                      {tailles.map((t) => {
                        const q = a.lignes.find((l) => l.taille_id === t.id)?.quantite ?? 0;
                        return <td key={t.id}>{q}</td>;
                      })}
                      <td style={{ fontWeight: 600, color: calcule === a.total ? "#047857" : "#C0392B" }}>
                        {calcule} / {a.total}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "8px 0 0" }}>
            Le total calculé est toujours strictement égal à la quantité demandée : les pièces qui ne tombent pas juste
            sont attribuées aux tailles dont le reste est le plus fort.
          </p>
          {conflits.length > 0 && (
            <p style={{ fontSize: 12, color: "#9A3412", background: "#FEF3EC", padding: "8px 10px", borderRadius: 6, margin: "10px 0 0" }}>
              {conflits.length} cellule{conflits.length > 1 ? "s" : ""} déjà renseignée{conflits.length > 1 ? "s" : ""} sera{conflits.length > 1 ? "ont" : ""} remplacée{conflits.length > 1 ? "s" : ""} :{" "}
              {conflits.slice(0, 6).map((c) => `${c.couleur}/${c.taille} ${c.ancienne}→${c.nouvelle}`).join(", ")}
              {conflits.length > 6 ? `, et ${conflits.length - 6} autre(s).` : "."}
            </p>
          )}
        </div>
      )}

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn ghost" onClick={calculerApercu} disabled={busy}>Aperçu</button>
        <button className="btn primary" onClick={demanderApplication} disabled={!apercu || busy}>
          {conflits.length > 0 ? `Remplacer ${conflits.length} valeur${conflits.length > 1 ? "s" : ""} et appliquer` : "Appliquer au tableau"}
        </button>
      </div>

      {confirmRemplacement != null && (
        <ConfirmDialog
          title="Remplacer des quantités déjà saisies ?"
          message={
            `${confirmRemplacement} cellule${confirmRemplacement > 1 ? "s" : ""} contien${confirmRemplacement > 1 ? "nent" : "t"} déjà une quantité différente. ` +
            "Appliquer le ratio remplacera ces valeurs. Les cellules vides, elles, seront simplement remplies."
          }
          confirmLabel="Remplacer et appliquer"
          cancelLabel="Annuler"
          danger
          onConfirm={() => { setConfirmRemplacement(null); appliquer(); }}
          onCancel={() => setConfirmRemplacement(null)}
        />
      )}
    </div>
  );
}
