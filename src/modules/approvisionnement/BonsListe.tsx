import { useEffect, useMemo, useState } from "react";
import {
  BonMpResume, LIBELLES_STATUT_BON, dateFr, euros, normaliserRecherche,
} from "./approvisionnementTypes";

// Suivi des bons de commande matières et fournitures.
//
// À ce stade (MP2) tous les bons sont des brouillons : la validation, les écritures et le PDF
// appartiennent à MP3. Le filtre par statut existe pourtant déjà, et c'est volontaire — il sera
// la première chose dont on aura besoin le jour où les bons validés coexisteront avec les
// brouillons, et l'ajouter maintenant coûte trois lignes.

function pont(): any { return (window as any).api; }

interface Props {
  onOuvrir: (bonId: number, numero: string) => void;
  onPreparer: () => void;
  /** Change à chaque enregistrement ailleurs dans le module : la liste se relit. */
  rafraichir: number;
}

type Etat = "chargement" | "ok" | "erreur";

const STATUTS_FILTRE = ["brouillon", "valide", "envoye", "solde", "annule"];

export default function BonsListe({ onOuvrir, onPreparer, rafraichir }: Props) {
  const [bons, setBons] = useState<BonMpResume[]>([]);
  const [etat, setEtat] = useState<Etat>("chargement");
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [statut, setStatut] = useState("");

  useEffect(() => {
    (async () => {
      setEtat("chargement");
      try {
        const api = pont();
        if (!api?.bcMp?.list) {
          throw new Error(
            "electron/preload.js n'expose pas encore « bcMp.list ». Copiez le fichier fourni, puis " +
            "arrêtez complètement npm run dev (Ctrl+C) et relancez-le : une modification de " +
            "preload.js n'est jamais rechargée à chaud.",
          );
        }
        const liste = await api.bcMp.list(statut ? { statut } : undefined);
        setBons(Array.isArray(liste) ? liste : []);
        setEtat("ok");
      } catch (err: any) {
        setEtat("erreur");
        setErreur(err?.message || "Impossible de lire les bons de commande.");
      }
    })();
  }, [statut, rafraichir]);

  const visibles = useMemo(() => {
    const q = normaliserRecherche(recherche);
    if (!q) return bons;
    return bons.filter((b) => normaliserRecherche([b.numero, b.fournisseur].join(" ")).includes(q));
  }, [bons, recherche]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
        <input
          type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)}
          placeholder="Rechercher un numéro ou un fournisseur…"
          style={{ flex: "1 1 240px", maxWidth: 360, height: 30, border: "1px solid #C9CAC0", borderRadius: 6, padding: "0 9px", fontSize: 13 }}
        />
        <select className="bcmp-select" value={statut} onChange={(e) => setStatut(e.target.value)}>
          <option value="">Tous les statuts</option>
          {STATUTS_FILTRE.map((s) => <option key={s} value={s}>{LIBELLES_STATUT_BON[s]}</option>)}
        </select>
        <button className="btn" onClick={onPreparer} style={{ marginLeft: "auto" }}>
          Préparer des bons
        </button>
      </div>

      {etat === "erreur" && <div className="appro-bloc-alerte">{erreur}</div>}
      {etat === "chargement" && <p style={{ fontSize: 13 }}>Lecture des bons…</p>}

      {etat === "ok" && visibles.length === 0 && (
        <p className="bcmp-vide">
          {bons.length === 0
            ? "Aucun bon de commande pour l'instant. Partez des besoins : « Préparer des bons »."
            : "Aucun bon ne correspond à cette recherche."}
        </p>
      )}

      {etat === "ok" && visibles.length > 0 && (
        <table className="appro-grille">
          <thead>
            <tr>
              <th className="g">Numéro</th>
              <th className="g">Fournisseur</th>
              <th>Statut</th>
              <th>Date</th>
              <th>Livraison souhaitée</th>
              <th className="n">Lignes</th>
              <th className="n">Productions</th>
              <th className="n">Total HT</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {visibles.map((b) => (
              <tr key={b.id}>
                <td className="g">
                  <span className="appro-article-ref" style={{ margin: 0, fontSize: 13, fontWeight: 700 }}>{b.numero}</span>
                </td>
                <td className="g">{b.fournisseur || "—"}</td>
                <td>
                  <span className={"bcmp-statut bcmp-statut-" + b.statut}>
                    {LIBELLES_STATUT_BON[b.statut] || b.statut}
                  </span>
                </td>
                <td>{dateFr(b.date_commande)}</td>
                <td>{dateFr(b.date_livraison_souhaitee)}</td>
                <td className="n">{b.nb_lignes}</td>
                <td className="n">{b.nb_productions}</td>
                <td className="n">
                  {b.total_ht > 0 ? euros(b.total_ht) : "—"}
                  {b.lignes_sans_prix > 0 && (
                    <span className="appro-incomplet-note">
                      {b.lignes_sans_prix} ligne{b.lignes_sans_prix > 1 ? "s" : ""} sans prix
                    </span>
                  )}
                </td>
                <td>
                  <button className="btn ghost tiny" onClick={() => onOuvrir(b.id, b.numero)}>
                    {b.statut === "brouillon" ? "Modifier" : "Voir"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
