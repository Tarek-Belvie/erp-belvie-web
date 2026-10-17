import { Fragment, useEffect, useMemo, useState } from "react";
import {
  BonMpResume, CommandeAppro, LigneRegroupee, Regroupement, UNITES_ACHAT,
  adapterCommande, dateFr, euros, nombre, normaliserRecherche, proposerArrondi,
  STATUTS_ELIGIBLES,
} from "./approvisionnementTypes";

// Préparation des bons de commande matières et fournitures.
//
// Trois temps, dans cet ordre, et c'est l'ordre du métier :
//   1. choisir les productions à servir ;
//   2. relire les besoins REGROUPÉS — une ligne par composant et par coloris, toutes productions
//      confondues — et ajuster quantités, conditionnements, fournisseurs et prix ;
//   3. enregistrer : un brouillon par fournisseur.
//
// Ce que cet écran ne fait PAS, volontairement :
//
//   - il ne calcule aucun besoin. `bcMp.regrouper` appelle le moteur, le même que l'écran des
//     besoins. Recalculer ici une perte ou une consommation serait la garantie que les deux
//     écrans finissent par annoncer des chiffres différents ;
//   - il ne répartit pas les quantités entre les productions. Il envoie les POIDS (le reste à
//     préparer de chaque production) et c'est bcMp.js qui divise. Une règle de répartition écrite
//     des deux côtés finit toujours par diverger, et l'écart se verrait au coût de revient, trop
//     tard ;
//   - il n'écrit rien dans les tables financières. Un brouillon n'engage pas.

function pont(): any { return (window as any).api; }

interface Props {
  /** Pré-sélection venue de la liste des besoins, quand on arrive par « Préparer un bon ». */
  commandesInitiales?: number[];
  onOuvrirBon: (bonId: number, numero: string) => void;
  onVoirLesBons: () => void;
}

type Etat = "chargement" | "ok" | "erreur";

/** Ce que l'utilisateur a modifié sur une ligne. Vide tant qu'il n'a rien touché : la valeur
 *  proposée reste alors celle du calcul, et se met à jour si le regroupement est relancé. */
type Saisie = {
  retenue?: boolean;
  quantite?: string;
  unite?: string;
  conditionnement_libelle?: string;
  conditionnement_quantite?: string;
  fournisseur_id?: string;
  prix?: string;
};

export default function PreparationBons({ commandesInitiales, onOuvrirBon, onVoirLesBons }: Props) {
  const [commandes, setCommandes] = useState<CommandeAppro[]>([]);
  const [etat, setEtat] = useState<Etat>("chargement");
  const [erreur, setErreur] = useState<string | null>(null);
  const [recherche, setRecherche] = useState("");
  const [choisies, setChoisies] = useState<number[]>(commandesInitiales || []);

  const [regroupement, setRegroupement] = useState<Regroupement | null>(null);
  const [calcul, setCalcul] = useState(false);
  const [saisies, setSaisies] = useState<Record<string, Saisie>>({});
  const [detail, setDetail] = useState<string | null>(null);

  const [brouillons, setBrouillons] = useState<BonMpResume[]>([]);
  const [destinations, setDestinations] = useState<Record<number, string>>({});
  const [enregistrement, setEnregistrement] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const api = pont();
        if (!api?.commandes?.list) throw new Error("L'API des commandes de production n'est pas disponible.");
        const brutes = await api.commandes.list();
        setCommandes((Array.isArray(brutes) ? brutes : [])
          .map(adapterCommande)
          .filter((c): c is CommandeAppro => c !== null && STATUTS_ELIGIBLES.indexOf(c.statut) !== -1));
        setEtat("ok");
      } catch (err: any) {
        setEtat("erreur");
        setErreur(err?.message || "Impossible de lire les commandes de fabrication.");
      }
    })();
  }, []);

  async function rechargerBrouillons() {
    try {
      const api = pont();
      if (!api?.bcMp?.list) return;
      const liste = await api.bcMp.list({ statut: "brouillon" });
      setBrouillons(Array.isArray(liste) ? liste : []);
    } catch (_) { /* la liste des brouillons est un confort, pas une condition */ }
  }
  useEffect(() => { rechargerBrouillons(); }, []);

  const visibles = useMemo(() => {
    const q = normaliserRecherche(recherche);
    if (!q) return commandes;
    return commandes.filter((c) => normaliserRecherche(
      [c.numero, c.produit, c.reference, c.reference_production].join(" ")).includes(q));
  }, [commandes, recherche]);

  function basculer(id: number) {
    setChoisies((actuelles) => actuelles.indexOf(id) === -1
      ? actuelles.concat(id)
      : actuelles.filter((x) => x !== id));
    setRegroupement(null);
  }

  async function regrouper() {
    if (choisies.length === 0) return;
    setCalcul(true);
    setErreur(null);
    setMessage(null);
    try {
      const api = pont();
      if (!api?.bcMp?.regrouper) {
        throw new Error(
          "electron/preload.js n'expose pas encore « bcMp.regrouper ». Copiez le fichier fourni, " +
          "puis arrêtez complètement npm run dev (Ctrl+C) et relancez-le : une modification de " +
          "preload.js n'est jamais rechargée à chaud.",
        );
      }
      const r: Regroupement = await api.bcMp.regrouper(choisies);
      setRegroupement(r);
      setSaisies({});
      setDestinations({});
      await rechargerBrouillons();
    } catch (err: any) {
      setErreur(err?.message || "Le regroupement des besoins a échoué.");
    } finally {
      setCalcul(false);
    }
  }

  // --- Valeurs effectives d'une ligne : la saisie si elle existe, sinon la proposition ---------
  function retenue(l: LigneRegroupee) {
    const s = saisies[l.cle];
    // Par défaut, on retient ce qui a quelque chose à préparer ET dont la quantité est connue.
    // Une quantité incalculable cochée d'office ferait commander un chiffre que personne n'a vu.
    return s?.retenue !== undefined ? s.retenue : (l.a_preparer && !l.quantite_inconnue);
  }
  function quantite(l: LigneRegroupee): number {
    const s = saisies[l.cle];
    if (s?.quantite !== undefined) return Number(String(s.quantite).replace(",", ".")) || 0;
    return l.reste_a_preparer;
  }
  function tailleCond(l: LigneRegroupee): number {
    const s = saisies[l.cle];
    return s?.conditionnement_quantite !== undefined
      ? Number(String(s.conditionnement_quantite).replace(",", ".")) || 0 : 0;
  }
  function unite(l: LigneRegroupee): string {
    const s = saisies[l.cle];
    return s?.unite !== undefined ? s.unite : (l.unite || "");
  }
  function fournisseur(l: LigneRegroupee): string {
    const s = saisies[l.cle];
    if (s?.fournisseur_id !== undefined) return s.fournisseur_id;
    return l.fournisseur_propose_id != null ? String(l.fournisseur_propose_id) : "";
  }
  function prix(l: LigneRegroupee): string {
    const s = saisies[l.cle];
    if (s?.prix !== undefined) return s.prix;
    return l.prix_propose != null ? String(l.prix_propose) : "";
  }
  function modifier(cle: string, patch: Saisie) {
    setSaisies((s) => Object.assign({}, s, { [cle]: Object.assign({}, s[cle], patch) }));
  }

  const lignes = regroupement ? regroupement.lignes : [];
  const retenues = lignes.filter(retenue);

  // --- Ce qui empêche d'enregistrer, et ce qui mérite seulement un avertissement ---------------
  const sansFournisseur = retenues.filter((l) => !fournisseur(l));
  const sansUnite = retenues.filter((l) => !unite(l));
  const sansQuantite = retenues.filter((l) => !(quantite(l) > 0));
  const colorisManquants = retenues.filter((l) => l.coloris_manquant);
  const sansPrix = retenues.filter((l) => !(Number(String(prix(l)).replace(",", ".")) > 0));
  const pretAEnregistrer = retenues.length > 0 && sansFournisseur.length === 0
    && sansUnite.length === 0 && sansQuantite.length === 0 && !enregistrement;

  // --- Regroupement par fournisseur : c'est là que « un bon = un fournisseur » prend corps ------
  const parFournisseur = useMemo(() => {
    const index = new Map<number, { nom: string; lignes: LigneRegroupee[]; total: number }>();
    retenues.forEach((l) => {
      const id = Number(fournisseur(l));
      if (!Number.isFinite(id) || id === 0) return;
      const nom = (l.fournisseurs_proposes.find((f) => f.fournisseur_id === id)?.fournisseur_nom)
        || (brouillons.find((b) => b.fournisseur_id === id)?.fournisseur)
        || ("Fournisseur " + id);
      if (!index.has(id)) index.set(id, { nom, lignes: [], total: 0 });
      const g = index.get(id)!;
      g.lignes.push(l);
      const pu = Number(String(prix(l)).replace(",", "."));
      if (pu > 0) g.total += pu * quantite(l);
    });
    return Array.from(index.entries()).map(([id, g]) => ({ fournisseur_id: id, ...g }));
  }, [retenues, saisies, brouillons]);

  function construireLigne(l: LigneRegroupee) {
    const pu = Number(String(prix(l)).replace(",", "."));
    const taille = tailleCond(l);
    const s = saisies[l.cle];
    return {
      type: l.type,
      designation: l.designation,
      matiere_catalogue_id: l.type === "matiere" ? l.catalogue_id : null,
      accessoire_catalogue_id: l.type === "fourniture" ? l.catalogue_id : null,
      reference: l.reference,
      couleur: l.cible_cle === "*" ? null : l.cible_libelle,
      unite: unite(l),
      unite_fiche: l.unite_fiche,
      conditionnement_libelle: s?.conditionnement_libelle || null,
      conditionnement_quantite: taille > 0 ? taille : 1,
      quantite: quantite(l),
      prix_unitaire_ht: pu > 0 ? pu : null,
      // Les POIDS, pas des quantités : la répartition est calculée par bcMp.js, à un seul endroit.
      // Une production dont le poids est nul reste servie si elle est la seule, sinon elle sort.
      productions: l.productions
        .filter((p) => p.poids > 0 || l.productions.every((x) => x.poids <= 0))
        .map((p) => ({ commande_id: p.commande_id, poids: p.poids > 0 ? p.poids : 1 })),
    };
  }

  async function enregistrer() {
    setEnregistrement(true);
    setErreur(null);
    setMessage(null);
    try {
      const api = pont();
      if (!api?.bcMp?.enregistrerPreparation) {
        throw new Error("electron/preload.js n'expose pas encore « bcMp.enregistrerPreparation ». "
          + "Arrêtez complètement npm run dev (Ctrl+C) et relancez-le.");
      }
      const nouveaux: any[] = [];
      const ajouts: any[] = [];
      parFournisseur.forEach((g) => {
        const destination = destinations[g.fournisseur_id] || "";
        const lignesBon = g.lignes.map(construireLigne);
        if (destination) ajouts.push({ bon_id: Number(destination), lignes: lignesBon });
        else nouveaux.push({ fournisseur_id: g.fournisseur_id, lignes: lignesBon });
      });

      const r = await api.bcMp.enregistrerPreparation({ nouveaux, ajouts });
      const crees = (r.crees || []).map((b: any) => b.numero);
      const completes = (r.completes || []).map((b: any) => b.numero);
      setMessage(
        [crees.length ? (crees.length === 1 ? "Brouillon créé : " : "Brouillons créés : ") + crees.join(", ") : "",
         completes.length ? (completes.length === 1 ? "Brouillon complété : " : "Brouillons complétés : ") + completes.join(", ") : ""]
          .filter(Boolean).join(" — "),
      );
      // Le regroupement est refait : ce qui vient de passer en brouillon ne doit plus être proposé.
      await regrouper();
    } catch (err: any) {
      setErreur(err?.message || "L'enregistrement a échoué. Rien n'a été écrit.");
    } finally {
      setEnregistrement(false);
    }
  }

  // ----------------------------------------------------------------------------------------------
  return (
    <div>
      <div className="bcmp-etapes">
        <span className={"bcmp-etape" + (!regroupement ? " active" : "")}>
          <b>1</b> Choisir les productions
        </span>
        <span className="bcmp-etape-sep">›</span>
        <span className={"bcmp-etape" + (regroupement ? " active" : "")}>
          <b>2</b> Ajuster les lignes
        </span>
        <span className="bcmp-etape-sep">›</span>
        <span className="bcmp-etape"><b>3</b> Enregistrer en brouillon</span>
      </div>

      {erreur && <div className="appro-bloc-alerte" style={{ marginBottom: 12 }}>{erreur}</div>}
      {message && (
        <div className="appro-bloc-alerte" style={{ marginBottom: 12, background: "#E7F4EC", borderColor: "#BFE3CE", color: "#116B43" }}>
          {message} — <button className="bcmp-lien-detail" onClick={onVoirLesBons}>voir les bons</button>
        </div>
      )}

      {/* ---------------------------------------------------------------- étape 1 : productions */}
      <section style={{ marginBottom: 18 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 9, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13.5 }}>Productions à servir</strong>
          <input
            type="search"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un numéro, un article, une référence…"
            style={{ flex: "1 1 260px", maxWidth: 420, height: 30, border: "1px solid #C9CAC0", borderRadius: 6, padding: "0 9px", fontSize: 13 }}
          />
          <span style={{ fontSize: 12.5, color: "var(--v2-text-3, #8A8A82)" }}>
            {choisies.length === 0 ? "aucune sélectionnée" : choisies.length + " sélectionnée" + (choisies.length > 1 ? "s" : "")}
          </span>
          <button className="btn" disabled={choisies.length === 0 || calcul} onClick={regrouper}>
            {calcul ? "Regroupement…" : "Regrouper les besoins"}
          </button>
        </div>

        {etat === "chargement" && <p style={{ fontSize: 13 }}>Lecture des productions…</p>}
        {etat === "ok" && visibles.length === 0 && (
          <p className="bcmp-vide">Aucune production ne correspond.</p>
        )}
        {etat === "ok" && visibles.length > 0 && (
          <div className="bcmp-productions">
            {visibles.map((c) => {
              const prise = choisies.indexOf(c.id) !== -1;
              return (
                <label key={c.id} className={"bcmp-prod" + (prise ? " choisie" : "")}>
                  <input type="checkbox" checked={prise} onChange={() => basculer(c.id)} />
                  <span style={{ minWidth: 0 }}>
                    <span className="bcmp-prod-nom">{c.produit || "Article"}</span>
                    <span className="bcmp-prod-meta">
                      {c.numero || "—"} · {c.quantite_totale} pcs · livraison {dateFr(c.date_fin_prevue)}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------------- étape 2 : les lignes */}
      {regroupement && (
        <section>
          <Bandeau regroupement={regroupement} />

          {lignes.length === 0 ? (
            <p className="bcmp-vide">
              Aucun besoin sur ces productions. Vérifiez que leurs fiches techniques comportent des
              matières ou des fournitures.
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table className="appro-grille bcmp-grille">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}></th>
                    <th className="g">Composant</th>
                    <th>Prod.</th>
                    <th className="n">Nécessaire</th>
                    <th className="n">Commandé</th>
                    <th className="n">En prépa.</th>
                    <th className="n">Reste à préparer</th>
                    <th className="n">À commander</th>
                    <th>Unité</th>
                    <th>Conditionnement</th>
                    <th className="g">Fournisseur</th>
                    <th className="n">Prix HT</th>
                    <th className="n">Total HT</th>
                  </tr>
                </thead>
                <tbody>
                  {lignes.map((l) => {
                    const prise = retenue(l);
                    const q = quantite(l);
                    const taille = tailleCond(l);
                    const arrondi = taille > 0 ? proposerArrondi(q, taille) : null;
                    const pu = Number(String(prix(l)).replace(",", "."));
                    const ouvert = detail === l.cle;
                    return (
                      <Fragment key={l.cle}>
                        <tr className={!prise ? "exclue" : (l.coloris_manquant || l.quantite_inconnue ? "anomalie" : "")}>
                          <td>
                            <input type="checkbox" checked={prise}
                              onChange={(e) => modifier(l.cle, { retenue: e.target.checked })} />
                          </td>
                          <td className="g">
                            <span className="appro-article-nom">{l.designation}</span>
                            <span className="sous">
                              {l.cible_cle === "*" ? "Toutes couleurs" : l.cible_libelle}
                              {l.reference ? " · " + l.reference : ""}
                              {l.unite_fiche && l.unite_fiche !== unite(l) ? " · fiche : " + l.unite_fiche : ""}
                            </span>
                            {l.coloris_manquant && <span className="appro-puce alerte">coloris à préciser</span>}
                            {l.quantite_inconnue && <span className="appro-puce incomplet">quantité incomplète</span>}
                            {l.catalogue_non_relie && <span className="appro-puce alerte">hors catalogue</span>}
                          </td>
                          <td>
                            <button className="bcmp-lien-detail" onClick={() => setDetail(ouvert ? null : l.cle)}>
                              {l.nb_productions}
                            </button>
                          </td>
                          <td className="n">{l.quantite_inconnue ? "—" : nombre(l.quantite_necessaire, l.unite)}</td>
                          <td className="n">{nombre(l.quantite_commandee, l.unite)}</td>
                          <td className="n">{l.quantite_en_preparation > 0 ? nombre(l.quantite_en_preparation, l.unite) : "—"}</td>
                          <td className="n appro-reste-fort">{nombre(l.reste_a_preparer, l.unite)}</td>
                          <td className="n">
                            <input
                              className="bcmp-saisie" type="text" inputMode="decimal"
                              value={saisies[l.cle]?.quantite ?? String(l.reste_a_preparer)}
                              onChange={(e) => modifier(l.cle, { quantite: e.target.value })}
                            />
                          </td>
                          <td>
                            <select
                              className={"bcmp-select" + (!unite(l) ? " manquant" : "")}
                              value={unite(l)}
                              onChange={(e) => modifier(l.cle, { unite: e.target.value })}
                            >
                              <option value="">à choisir…</option>
                              {UNITES_ACHAT.map((u) => <option key={u.cle} value={u.cle}>{u.label}</option>)}
                            </select>
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 5, alignItems: "center", justifyContent: "center" }}>
                              <input
                                className="bcmp-saisie etroite" type="text" inputMode="decimal"
                                placeholder="taille"
                                value={saisies[l.cle]?.conditionnement_quantite ?? ""}
                                onChange={(e) => modifier(l.cle, { conditionnement_quantite: e.target.value })}
                              />
                              {/* L'arrondi est PROPOSÉ : le bouton n'apparaît que s'il change
                                  quelque chose, et c'est un clic volontaire qui l'applique. */}
                              {arrondi && !arrondi.deja_juste && (
                                <button
                                  className="bcmp-arrondi"
                                  title={"Arrondir à " + arrondi.nombre_arrondi + " conditionnements, soit "
                                    + nombre(arrondi.quantite_arrondie, unite(l)) + " (+" + nombre(arrondi.supplement, unite(l)) + ")"}
                                  onClick={() => modifier(l.cle, { quantite: String(arrondi.quantite_arrondie) })}
                                >
                                  ⤴ {arrondi.nombre_arrondi}
                                </button>
                              )}
                            </div>
                          </td>
                          <td className="g">
                            <select
                              className={"bcmp-select" + (prise && !fournisseur(l) ? " manquant" : "")}
                              value={fournisseur(l)}
                              onChange={(e) => modifier(l.cle, { fournisseur_id: e.target.value })}
                            >
                              <option value="">à choisir…</option>
                              {l.fournisseurs_proposes.map((f) => (
                                <option key={f.fournisseur_id} value={f.fournisseur_id}>
                                  {f.fournisseur_nom}{f.origine === "tarif" ? " · tarif" : " · déjà acheté"}
                                </option>
                              ))}
                              {/* Les fournisseurs des brouillons en cours restent proposés même
                                  sans tarif ni historique sur ce composant. */}
                              {brouillons
                                .filter((b) => !l.fournisseurs_proposes.some((f) => f.fournisseur_id === b.fournisseur_id))
                                .filter((b, i, t) => t.findIndex((x) => x.fournisseur_id === b.fournisseur_id) === i)
                                .map((b) => (
                                  <option key={"b" + b.fournisseur_id} value={b.fournisseur_id}>{b.fournisseur}</option>
                                ))}
                            </select>
                          </td>
                          <td className="n">
                            <input
                              className="bcmp-saisie etroite" type="text" inputMode="decimal"
                              placeholder="—"
                              value={prix(l)}
                              onChange={(e) => modifier(l.cle, { prix: e.target.value })}
                            />
                          </td>
                          <td className="n">{pu > 0 && q > 0 ? euros(pu * q) : "—"}</td>
                        </tr>
                        {ouvert && (
                          <tr className="bcmp-detail-prod">
                            <td colSpan={13}>
                              <strong>Ce que chaque production attend</strong>
                              <ul>
                                {l.productions.map((p) => (
                                  <li key={p.commande_id}>
                                    {p.numero || "Production " + p.commande_id}
                                    {p.article_designation ? " — " + p.article_designation : ""} :
                                    {" "}nécessaire {nombre(p.quantite_necessaire, l.unite)},
                                    {" "}déjà commandé {nombre(p.quantite_commandee, l.unite)},
                                    {" "}reste à préparer <strong>{nombre(p.poids, l.unite)}</strong>
                                  </li>
                                ))}
                              </ul>
                              {l.bloquant_validation.length > 0 && (
                                <>
                                  <strong style={{ display: "block", marginTop: 8 }}>
                                    À régler avant de valider le bon définitif
                                  </strong>
                                  <ul>
                                    {l.bloquant_validation.map((b) => (
                                      <li key={b.code}>{b.message} <em>({b.ou_corriger})</em></li>
                                    ))}
                                  </ul>
                                </>
                              )}
                              <p style={{ margin: "8px 0 0" }}>
                                La quantité commandée sera répartie entre ces productions au prorata
                                de leur reste à préparer. Ce calcul est fait à l'enregistrement, pas ici.
                              </p>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* ----------------------------------------------------------- étape 3 : récapitulatif */}
          {lignes.length > 0 && (
            <div className="bcmp-recap">
              <h4>Ce qui va être enregistré</h4>

              {retenues.length === 0 && (
                <p style={{ fontSize: 12.5, color: "var(--v2-text-3, #8A8A82)", margin: 0 }}>
                  Aucune ligne retenue. Cochez les lignes à commander.
                </p>
              )}

              {parFournisseur.map((g) => {
                const existants = brouillons.filter((b) => b.fournisseur_id === g.fournisseur_id);
                return (
                  <div key={g.fournisseur_id} className="bcmp-recap-ligne">
                    <span className="bcmp-recap-nom">{g.nom}</span>
                    <span>{g.lignes.length} ligne{g.lignes.length > 1 ? "s" : ""}</span>
                    {existants.length > 0 && (
                      <select
                        className="bcmp-select"
                        value={destinations[g.fournisseur_id] || ""}
                        onChange={(e) => setDestinations((d) => Object.assign({}, d, { [g.fournisseur_id]: e.target.value }))}
                      >
                        <option value="">Nouveau bon</option>
                        {existants.map((b) => (
                          <option key={b.id} value={b.id}>Ajouter au brouillon {b.numero}</option>
                        ))}
                      </select>
                    )}
                    <span className="bcmp-recap-total">{g.total > 0 ? euros(g.total) : "prix à compléter"}</span>
                  </div>
                );
              })}

              {sansFournisseur.length > 0 && (
                <p style={{ fontSize: 12.5, color: "#9A3412", marginTop: 10 }}>
                  {sansFournisseur.length} ligne{sansFournisseur.length > 1 ? "s" : ""} sans fournisseur :
                  un bon de commande ne concerne qu'un fournisseur, il faut donc le désigner pour chacune.
                </p>
              )}
              {sansUnite.length > 0 && (
                <p style={{ fontSize: 12.5, color: "#9A3412", marginTop: 6 }}>
                  {sansUnite.length} ligne{sansUnite.length > 1 ? "s" : ""} sans unité d'achat.
                  Les achats n'acceptent que le mètre, le kilo, la pièce et le lot ;
                  l'unité de la fiche reste affichée à côté.
                </p>
              )}
              {sansQuantite.length > 0 && (
                <p style={{ fontSize: 12.5, color: "#9A3412", marginTop: 6 }}>
                  {sansQuantite.length} ligne{sansQuantite.length > 1 ? "s" : ""} sans quantité.
                </p>
              )}

              {/* Ce qui n'empêche PAS d'enregistrer un brouillon, mais empêchera de le valider. */}
              {colorisManquants.length > 0 && (
                <p style={{ fontSize: 12.5, color: "#8A5A05", marginTop: 10 }}>
                  <strong>{colorisManquants.length} ligne{colorisManquants.length > 1 ? "s" : ""}</strong> dont le
                  coloris n'est pas arrêté. Le brouillon les accepte — c'est justement à quoi il sert —
                  mais le bon définitif sera refusé tant que la couleur à commander n'est pas connue.
                </p>
              )}
              {sansPrix.length > 0 && (
                <p style={{ fontSize: 12.5, color: "var(--v2-text-3, #8A8A82)", marginTop: 6 }}>
                  {sansPrix.length} ligne{sansPrix.length > 1 ? "s" : ""} sans prix. Le brouillon les accepte ;
                  la validation les refusera.
                </p>
              )}

              <div style={{ marginTop: 14, display: "flex", gap: 9, alignItems: "center", flexWrap: "wrap" }}>
                <button className="btn" disabled={!pretAEnregistrer} onClick={enregistrer}>
                  {enregistrement ? "Enregistrement…" : "Enregistrer en brouillon"}
                </button>
                <span style={{ fontSize: 12, color: "var(--v2-text-3, #8A8A82)" }}>
                  Un brouillon n'engage rien : aucune écriture financière, aucun stock modifié.
                </span>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Le bandeau de contexte : ce que le regroupement a trouvé, et ce qu'il n'a pas pu lire. */
function Bandeau({ regroupement }: { regroupement: Regroupement }) {
  const t = regroupement.totaux;
  const enRetard = regroupement.productions.filter((p) => p.recette && p.recette.revision_en_retard);
  return (
    <>
      <div className="appro-bandeau-recette" style={{ marginBottom: 12 }}>
        <span><strong>{t.nb_productions}</strong> production{t.nb_productions > 1 ? "s" : ""}</span>
        <span><strong>{t.nb_lignes}</strong> ligne{t.nb_lignes > 1 ? "s" : ""} regroupée{t.nb_lignes > 1 ? "s" : ""}</span>
        <span><strong>{t.nb_a_preparer}</strong> à préparer</span>
        {t.nb_coloris_manquants > 0 && <span style={{ color: "#9A3412" }}>{t.nb_coloris_manquants} coloris à préciser</span>}
        {t.nb_quantite_inconnue > 0 && <span style={{ color: "#8A5A05" }}>{t.nb_quantite_inconnue} quantité incomplète</span>}
        {t.nb_unite_a_choisir > 0 && <span>{t.nb_unite_a_choisir} unité à choisir</span>}
      </div>

      {regroupement.erreurs.length > 0 && (
        <div className="appro-bloc-alerte" style={{ marginBottom: 12 }}>
          {regroupement.erreurs.map((e) => (
            <div key={e.commande_id}>Production {e.commande_id} : {e.message}</div>
          ))}
        </div>
      )}

      {enRetard.length > 0 && (
        <div className="appro-bandeau-recette retard" style={{ marginBottom: 12 }}>
          {enRetard.map((p) => p.numero).join(", ")} :
          la recette est figée sur une révision antérieure de la fiche technique. Les quantités
          ci-dessous sont celles de la recette figée, et non de la fiche actuelle — c'est voulu,
          une production décidée ne change pas de nomenclature toute seule.
        </div>
      )}
    </>
  );
}
