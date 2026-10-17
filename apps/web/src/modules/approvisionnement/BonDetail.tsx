import { useEffect, useState } from "react";
import {
  BonMp, LigneBon, LIBELLES_STATUT_BON, UNITES_ACHAT,
  dateFr, euros, nombre, proposerArrondi,
} from "./approvisionnementTypes";

// Un bon de commande matières, ouvert pour être modifié.
//
// Tant qu'il est en BROUILLON, tout est modifiable : quantités, conditionnements, prix, unités,
// et l'en-tête. Dès qu'il ne l'est plus — à partir de MP3 — l'écran passe en lecture seule sans
// changer de forme : c'est le même document, on ne le réapprend pas.
//
// Chaque modification part immédiatement en base, ligne par ligne. Il n'y a pas de bouton
// « Enregistrer » : un écran qui attend un enregistrement global laisse perdre le travail dès
// qu'on change d'onglet, et c'est exactement ce que fait un atelier.
//
// Le fournisseur ne se change pas ici : un bon ne concerne qu'un fournisseur, et le changer
// reviendrait à faire un autre bon. Il faut alors supprimer celui-ci et repréparer.

function pont(): any { return (window as any).api; }

interface Props {
  bonId: number;
  onRetour: () => void;
  /** Prévient le module qu'un bon a changé, pour que la liste se relise. */
  onModifie: () => void;
}

export default function BonDetail({ bonId, onRetour, onModifie }: Props) {
  const [bon, setBon] = useState<BonMp | null>(null);
  const [etat, setEtat] = useState<"chargement" | "ok" | "erreur">("chargement");
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [confirmation, setConfirmation] = useState(false);

  async function charger() {
    setEtat("chargement");
    try {
      const api = pont();
      if (!api?.bcMp?.get) throw new Error("electron/preload.js n'expose pas encore « bcMp.get ».");
      const r = await api.bcMp.get(bonId);
      if (!r) throw new Error("Ce bon de commande n'existe plus.");
      setBon(r);
      setEtat("ok");
    } catch (err: any) {
      setEtat("erreur");
      setErreur(err?.message || "Impossible de lire ce bon de commande.");
    }
  }
  useEffect(() => { charger(); }, [bonId]);

  function signaler(err: any, repli: string) {
    setErreur(err?.message || repli);
    setTimeout(() => setErreur(null), 6000);
  }

  /** Rend vrai si la base a accepté. Les champs s'en servent pour revenir à la valeur enregistrée
   *  en cas de refus : une quantité refusée ne doit pas rester à l'écran comme si elle était
   *  passée. */
  async function majLigne(ligneId: number, patch: Record<string, unknown>) {
    setOccupe(true);
    try {
      const r = await pont().bcMp.mettreAJourLigne(ligneId, patch);
      setBon(r);
      onModifie();
      return true;
    } catch (err: any) {
      signaler(err, "Modification impossible.");
      return false;
    } finally {
      setOccupe(false);
    }
  }

  async function majEntete(patch: Record<string, unknown>) {
    try {
      const r = await pont().bcMp.mettreAJour(bonId, patch);
      setBon(r);
      onModifie();
      return true;
    } catch (err: any) {
      signaler(err, "Modification impossible.");
      return false;
    }
  }

  async function supprimerLigne(ligneId: number) {
    setOccupe(true);
    try {
      setBon(await pont().bcMp.supprimerLigne(ligneId));
      onModifie();
    } catch (err: any) {
      signaler(err, "Suppression impossible.");
    } finally {
      setOccupe(false);
    }
  }

  async function supprimerBon() {
    try {
      await pont().bcMp.supprimer(bonId);
      onModifie();
      onRetour();
    } catch (err: any) {
      signaler(err, "Suppression impossible.");
      setConfirmation(false);
    }
  }

  if (etat === "chargement") return <p style={{ fontSize: 13 }}>Lecture du bon…</p>;
  if (etat === "erreur" || !bon) return <div className="appro-bloc-alerte">{erreur}</div>;

  const modifiable = bon.statut === "brouillon";

  return (
    <div>
      {erreur && <div className="appro-bloc-alerte" style={{ marginBottom: 12 }}>{erreur}</div>}

      {/* --- En-tête ------------------------------------------------------------------------- */}
      <div className="appro-bandeau-recette" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: "var(--v2-text, #23241F)" }}>{bon.numero}</span>
        <span className={"bcmp-statut bcmp-statut-" + bon.statut}>
          {LIBELLES_STATUT_BON[bon.statut] || bon.statut}
        </span>
        <span><strong>{bon.fournisseur_nom_actuel || "Fournisseur inconnu"}</strong></span>
        <span>émis le {dateFr(bon.date_commande)}</span>
        <span><strong>{euros(bon.total_ht)}</strong> HT</span>
        {bon.lignes_sans_prix > 0 && (
          <span style={{ color: "#8A5A05" }}>
            {bon.lignes_sans_prix} ligne{bon.lignes_sans_prix > 1 ? "s" : ""} sans prix
          </span>
        )}
      </div>

      {modifiable && (
        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 16, alignItems: "flex-end" }}>
          <label style={{ fontSize: 12 }}>
            <span style={{ display: "block", marginBottom: 3, color: "var(--v2-text-3, #6B6B62)" }}>
              Livraison souhaitée
            </span>
            <input
              type="date"
              defaultValue={bon.date_livraison_souhaitee || ""}
              onBlur={(e) => majEntete({ date_livraison_souhaitee: e.target.value || null })}
              style={{ height: 29, border: "1px solid #C9CAC0", borderRadius: 5, padding: "0 7px", fontSize: 12.5 }}
            />
          </label>
          <label style={{ fontSize: 12, flex: "1 1 260px", maxWidth: 420 }}>
            <span style={{ display: "block", marginBottom: 3, color: "var(--v2-text-3, #6B6B62)" }}>
              Notes pour le fournisseur
            </span>
            <input
              type="text"
              defaultValue={bon.notes || ""}
              placeholder="Livraison en deux fois, contact sur place…"
              onBlur={(e) => majEntete({ notes: e.target.value })}
              style={{ width: "100%", height: 29, border: "1px solid #C9CAC0", borderRadius: 5, padding: "0 7px", fontSize: 12.5 }}
            />
          </label>
          <button className="btn ghost tiny" onClick={() => setConfirmation(true)} style={{ marginLeft: "auto" }}>
            Supprimer ce brouillon
          </button>
        </div>
      )}

      {confirmation && (
        <div className="appro-bloc-alerte" style={{ marginBottom: 14 }}>
          <strong>Supprimer le brouillon {bon.numero} ?</strong>
          <p style={{ margin: "6px 0 10px" }}>
            Ses {bon.lignes.length} ligne{bon.lignes.length > 1 ? "s" : ""} repasseront en « reste à
            préparer » sur les productions concernées. Le numéro {bon.numero}, lui, ne sera pas
            réattribué : un numéro utilisé une fois ne revient jamais, sinon l'historique devient
            illisible.
          </p>
          <button className="btn ghost tiny" onClick={() => setConfirmation(false)}>Annuler</button>{" "}
          <button className="btn tiny" onClick={supprimerBon}>Supprimer</button>
        </div>
      )}

      {/* --- Productions servies --------------------------------------------------------------- */}
      {bon.commandes_servies.length > 0 && (
        <p style={{ fontSize: 12.5, color: "var(--v2-text-3, #6B6B62)", marginBottom: 10 }}>
          Ce bon sert {bon.commandes_servies.length} production{bon.commandes_servies.length > 1 ? "s" : ""} :
          {" "}{bon.commandes_servies.map((c) => c.numero || "n°" + c.commande_id).join(", ")}.
        </p>
      )}

      {/* --- Lignes ---------------------------------------------------------------------------- */}
      {bon.lignes.length === 0 ? (
        <p className="bcmp-vide">
          Ce bon n'a aucune ligne. Repassez par « Préparer des bons » pour en ajouter depuis les besoins.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="appro-grille">
            <thead>
              <tr>
                <th className="g">Composant</th>
                <th className="n">Quantité</th>
                <th>Unité</th>
                <th>Conditionnement</th>
                <th className="n">Prix HT</th>
                <th className="n">Montant HT</th>
                <th className="g">Réparti sur</th>
                {modifiable && <th></th>}
              </tr>
            </thead>
            <tbody>
              {bon.lignes.map((l) => (
                <LigneDuBon
                  key={l.id}
                  ligne={l}
                  modifiable={modifiable && !occupe}
                  onMaj={(patch) => majLigne(l.id, patch)}
                  onSupprimer={() => supprimerLigne(l.id)}
                />
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="g" colSpan={5} style={{ textAlign: "right", fontWeight: 700 }}>Total HT</td>
                <td className="n" style={{ fontWeight: 700 }}>{euros(bon.total_ht)}</td>
                <td colSpan={modifiable ? 2 : 1}></td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--v2-text-3, #8A8A82)", marginTop: 14 }}>
        Un brouillon n'engage rien : il n'apparaît ni dans la dette fournisseur, ni dans le coût des
        productions, ni dans les stocks. Ses quantités sont comptées « en préparation » sur l'écran
        des besoins, pour ne pas les recommander deux fois.
      </p>
      {modifiable && (
        <p style={{ fontSize: 12, color: "var(--v2-text-3, #8A8A82)", marginTop: 6 }}>
          La validation, elle, exigera un prix sur chaque ligne et un coloris arrêté partout où la
          couleur compte. Cet écran ne refait pas ce contrôle : c'est « Préparer des bons », qui
          part des besoins, qui nomme les lignes concernées.
        </p>
      )}

      <div style={{ marginTop: 16 }}>
        <button className="btn ghost tiny" onClick={onRetour}>Retour aux bons</button>
      </div>
    </div>
  );
}

function LigneDuBon({ ligne, modifiable, onMaj, onSupprimer }: {
  ligne: LigneBon;
  modifiable: boolean;
  onMaj: (patch: Record<string, unknown>) => Promise<boolean>;
  onSupprimer: () => void;
}) {
  const arrondi = ligne.conditionnement_quantite > 1
    ? proposerArrondi(ligne.quantite, ligne.conditionnement_quantite) : null;

  return (
    <tr>
      <td className="g">
        <span className="appro-article-nom">{ligne.designation}</span>
        <span className="sous">
          {ligne.couleur || "Toutes couleurs"}
          {ligne.reference ? " · " + ligne.reference : ""}
          {ligne.unite_fiche && ligne.unite_fiche !== ligne.unite ? " · fiche : " + ligne.unite_fiche : ""}
        </span>
        {!ligne.matiere_catalogue_id && !ligne.accessoire_catalogue_id && (
          <span className="appro-puce alerte">hors catalogue</span>
        )}
      </td>
      <td className="n">
        <ChampNombre
          valeur={ligne.quantite}
          modifiable={modifiable}
          onEnregistrer={(v) => onMaj({ quantite: v })}
        />
      </td>
      <td>
        {modifiable ? (
          <select
            className="bcmp-select" value={ligne.unite || ""}
            onChange={(e) => onMaj({ unite: e.target.value })}
          >
            <option value="">à choisir…</option>
            {UNITES_ACHAT.map((u) => <option key={u.cle} value={u.cle}>{u.label}</option>)}
          </select>
        ) : (ligne.unite || "—")}
      </td>
      <td>
        {modifiable ? (
          <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "center" }}>
            <ChampNombre
              valeur={ligne.conditionnement_quantite}
              modifiable={modifiable}
              etroit
              onEnregistrer={(v) => onMaj({ conditionnement_quantite: v })}
            />
            {arrondi && !arrondi.deja_juste && (
              <button
                className="bcmp-arrondi"
                title={"Arrondir à " + arrondi.nombre_arrondi + " conditionnements, soit "
                  + nombre(arrondi.quantite_arrondie, ligne.unite) + " (+" + nombre(arrondi.supplement, ligne.unite) + ")"}
                onClick={() => onMaj({ nombre_conditionnements: arrondi.nombre_arrondi })}
              >
                ⤴ {arrondi.nombre_arrondi}
              </button>
            )}
          </div>
        ) : (
          ligne.conditionnement_quantite > 1
            ? nombre(ligne.nombre_conditionnements) + " × " + nombre(ligne.conditionnement_quantite, ligne.unite)
            : "—"
        )}
      </td>
      <td className="n">
        <ChampNombre
          valeur={ligne.prix_unitaire_ht}
          modifiable={modifiable}
          etroit
          autoriseVide
          onEnregistrer={(v) => onMaj({ prix_unitaire_ht: v })}
        />
      </td>
      <td className="n">{ligne.montant_ht != null ? euros(ligne.montant_ht) : "—"}</td>
      <td className="g" style={{ fontSize: 11.5, color: "var(--v2-text-3, #6B6B62)" }}>
        {ligne.productions.map((p) => (
          <div key={p.commande_id}>
            {p.commande_numero || "n°" + p.commande_id} : {nombre(p.quantite_affectee, ligne.unite)}
          </div>
        ))}
      </td>
      {modifiable && (
        <td>
          <button className="btn ghost tiny" onClick={onSupprimer}>✕</button>
        </td>
      )}
    </tr>
  );
}

/** Champ numérique enregistré à la sortie du champ, qui REVIENT à la valeur enregistrée si la
 *  base refuse. Sans ce retour, une quantité refusée resterait affichée comme si elle avait été
 *  acceptée — et le total affiché ne correspondrait plus à rien. */
function ChampNombre({ valeur, modifiable, etroit, autoriseVide, onEnregistrer }: {
  valeur: number | null;
  modifiable: boolean;
  etroit?: boolean;
  autoriseVide?: boolean;
  onEnregistrer: (v: string) => Promise<boolean>;
}) {
  const affichee = valeur != null ? String(valeur) : "";
  const [texte, setTexte] = useState(affichee);
  useEffect(() => { setTexte(affichee); }, [affichee]);

  if (!modifiable) return <>{valeur != null ? nombre(valeur) : "—"}</>;

  async function enregistrer() {
    const propre = texte.trim().replace(",", ".");
    if (propre === affichee) return;
    if (!propre && !autoriseVide) { setTexte(affichee); return; }
    if (!(await onEnregistrer(propre))) setTexte(affichee);
  }

  return (
    <input
      className={"bcmp-saisie" + (etroit ? " etroite" : "")}
      type="text" inputMode="decimal"
      value={texte}
      placeholder={autoriseVide ? "—" : ""}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={enregistrer}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}
