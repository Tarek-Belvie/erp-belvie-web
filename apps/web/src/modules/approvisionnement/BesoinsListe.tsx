import { useEffect, useMemo, useState } from "react";
import { mediaUrl } from "../commandes/uiHelpers";
import {
  CommandeAppro, EtatAppro, StatutAppro, adapterCommande, dateFr, joursRestants,
  normaliserRecherche, STATUTS_ELIGIBLES, LIBELLES_STATUT_APPRO, EXPLICATIONS_STATUT_APPRO,
  GRAVITE_STATUT_APPRO, LIBELLES_PRIORITE, LIBELLES_STATUT_COMMANDE, PRIORITES_ORDRE,
} from "./approvisionnementTypes";

// Liste des articles à approvisionner — un tableau compact, une ligne par production.
//
// Remplace les cartes de l'étape 1 : une carte par commande tenait trois fois la place et rendait
// la comparaison impossible. Le tableau permet ce que les cartes interdisaient — chercher, filtrer,
// trier, et voir du premier coup d'œil ce qui manque.
//
// Deux lectures distinctes, volontairement :
//   1. `api.commandes.list()` donne les commandes. C'est l'API du module Commandes de production,
//      réutilisée telle quelle : aucune seconde liste n'est créée ici.
//   2. `api.approvisionnement.etatsApprovisionnement()` donne l'état d'approvisionnement de ces
//      commandes — ce que seul le moteur de besoins peut dire.
// La seconde est facultative : si le pont preload est périmé, le tableau s'affiche quand même, la
// colonne « Appro » indique simplement qu'elle n'a pas pu être calculée. Perdre une colonne est
// acceptable ; perdre la liste ne l'est pas.

// Le pont est lu à CHAQUE appel, et non capturé au chargement du module. En Electron, preload.js
// l'installe avant le bundle, donc les deux marchent ; mais une capture au chargement dépend de
// l'ordre d'évaluation des modules — un détail qui n'est écrit nulle part et qu'un import ajouté
// plus tard suffirait à changer. Lire tardivement ne coûte rien et ne peut pas se tromper.
function pont(): any { return (window as any).api; }

interface Props {
  onOuvrir: (commandeId: number, libelle: string) => void;
  /** Ouvre la préparation de bons MP sur les productions cochées.
   *
   *  C'est la porte d'entrée qui manquait : l'écran de préparation acceptait déjà une liste de
   *  productions de départ (`commandesInitiales`), mais personne ne lui en passait jamais. On
   *  part donc d'ici — de la liste des productions — et non d'un onglet voisin. */
  onPreparer: (commandeIds: number[]) => void;
}

type EtatListe = "chargement" | "ok" | "erreur";
type Tri = "livraison" | "priorite" | "saison" | "appro" | "quantite";

const TRIS: { cle: Tri; label: string }[] = [
  { cle: "livraison", label: "Date de livraison (au plus tôt)" },
  { cle: "priorite", label: "Priorité (haute d'abord)" },
  { cle: "appro", label: "État d'approvisionnement (urgent d'abord)" },
  { cle: "saison", label: "Saison" },
  { cle: "quantite", label: "Quantité (décroissante)" },
];

// Vues rapides. « À traiter » regroupe tout ce qui demande une action, parce que c'est la question
// que l'on se pose en arrivant sur cet écran — et non « quels sont les statuts possibles ».
type Vue = "a_traiter" | "tous" | "a_completer" | "a_commander" | "a_recevoir" | "complet";
const STATUTS_A_TRAITER: StatutAppro[] = ["erreur", "sans_fiche", "sans_composant", "a_completer", "a_commander"];

export default function BesoinsListe({ onOuvrir, onPreparer }: Props) {
  // Les productions cochées. Un Set plutôt qu'un tableau : on teste l'appartenance à chaque ligne
  // rendue, et `indexOf` sur chaque ligne de chaque rendu se paie sur une longue liste.
  const [cochees, setCochees] = useState<Set<number>>(new Set());
  const [commandes, setCommandes] = useState<CommandeAppro[]>([]);
  // Trois états distincts, et non un booléen : « aucune commande » et « la lecture a échoué » ne
  // doivent jamais se ressembler à l'écran. Afficher « aucune commande » après un échec ferait
  // croire à un atelier vide.
  const [etatListe, setEtatListe] = useState<EtatListe>("chargement");
  const [erreurListe, setErreurListe] = useState<string | null>(null);

  const [etats, setEtats] = useState<Record<number, EtatAppro>>({});
  const [etatsCharges, setEtatsCharges] = useState(false);
  const [erreurEtats, setErreurEtats] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [vue, setVue] = useState<Vue>("a_traiter");
  const [saison, setSaison] = useState("");
  const [statutCommande, setStatutCommande] = useState("");
  const [tri, setTri] = useState<Tri>("livraison");

  useEffect(() => {
    (async () => {
      setEtatListe("chargement");
      setErreurListe(null);
      try {
        const api = pont();
        if (!api || !api.commandes || typeof api.commandes.list !== "function") {
          throw new Error("L'API des commandes de production n'est pas disponible (electron/preload.js).");
        }
        const brutes = await api.commandes.list();
        const liste = (Array.isArray(brutes) ? brutes : [])
          .map(adapterCommande)
          .filter((c): c is CommandeAppro => c !== null && STATUTS_ELIGIBLES.indexOf(c.statut) !== -1);
        setCommandes(liste);
        setEtatListe("ok");
      } catch (err: any) {
        setEtatListe("erreur");
        setErreurListe(err?.message || "Impossible de lire les commandes de fabrication.");
      }
    })();
  }, []);

  // Les états d'approvisionnement arrivent APRÈS la liste, en un seul appel pour toutes les
  // commandes : le tableau est utilisable immédiatement, et la colonne « Appro » se remplit
  // ensuite. Un calcul par commande depuis l'interface aurait multiplié les allers-retours.
  useEffect(() => {
    if (etatListe !== "ok" || commandes.length === 0) return;
    (async () => {
      try {
        const api = pont();
        if (!api?.approvisionnement || typeof api.approvisionnement.etatsApprovisionnement !== "function") {
          throw new Error(
            "electron/preload.js n'expose pas encore « etatsApprovisionnement ». Copiez le fichier " +
            "fourni, puis arrêtez complètement npm run dev (Ctrl+C) et relancez-le : une " +
            "modification de preload.js n'est jamais rechargée à chaud.",
          );
        }
        const resultats: EtatAppro[] = await api.approvisionnement.etatsApprovisionnement(commandes.map((c) => c.id));
        const index: Record<number, EtatAppro> = {};
        (Array.isArray(resultats) ? resultats : []).forEach((e) => { index[e.commande_id] = e; });
        setEtats(index);
        setEtatsCharges(true);
      } catch (err: any) {
        setErreurEtats(err?.message || "L'état d'approvisionnement n'a pas pu être calculé.");
        setEtatsCharges(true);
      }
    })();
  }, [etatListe, commandes]);

  const saisons = useMemo(
    () => Array.from(new Set(commandes.map((c) => c.saison).filter(Boolean) as string[])).sort((a, b) => a.localeCompare(b, "fr")),
    [commandes],
  );

  function libelleArticle(c: CommandeAppro): string {
    return etats[c.id]?.article_designation || c.produit || "Article";
  }

  const comptes = useMemo(() => {
    const parStatut = (predicat: (s: StatutAppro) => boolean) =>
      commandes.filter((c) => { const e = etats[c.id]; return e ? predicat(e.statut) : false; }).length;
    return {
      tous: commandes.length,
      a_traiter: parStatut((s) => STATUTS_A_TRAITER.indexOf(s) !== -1),
      a_completer: parStatut((s) => s === "a_completer" || s === "sans_fiche" || s === "sans_composant"),
      a_commander: parStatut((s) => s === "a_commander"),
      a_recevoir: parStatut((s) => s === "a_recevoir"),
      complet: parStatut((s) => s === "complet"),
    };
  }, [commandes, etats]);

  const filtrees = useMemo(() => {
    let liste = [...commandes];

    // Tant que les états ne sont pas connus, les vues qui en dépendent n'en filtrent aucune :
    // mieux vaut tout montrer une seconde que de laisser croire que la liste est vide.
    if (etatsCharges && !erreurEtats && vue !== "tous") {
      liste = liste.filter((c) => {
        const s = etats[c.id]?.statut;
        if (!s) return false;
        if (vue === "a_traiter") return STATUTS_A_TRAITER.indexOf(s) !== -1;
        if (vue === "a_completer") return s === "a_completer" || s === "sans_fiche" || s === "sans_composant";
        return s === vue;
      });
    }

    if (saison) liste = liste.filter((c) => (c.saison || "") === saison);
    if (statutCommande) liste = liste.filter((c) => c.statut === statutCommande);

    const q = normaliserRecherche(query);
    if (q) {
      liste = liste.filter((c) => {
        const champs = [
          libelleArticle(c), c.reference, c.numero, c.reference_production, c.produit, c.saison,
        ];
        return champs.some((v) => normaliserRecherche(v).includes(q));
      });
    }

    const parDefaut = (a: CommandeAppro, b: CommandeAppro) => (a.date_fin_prevue || "").localeCompare(b.date_fin_prevue || "");
    liste.sort((a, b) => {
      switch (tri) {
        case "priorite": {
          const d = (PRIORITES_ORDRE[a.priorite] ?? 9) - (PRIORITES_ORDRE[b.priorite] ?? 9);
          return d !== 0 ? d : parDefaut(a, b);
        }
        case "saison": {
          const d = (a.saison || "zzz").localeCompare(b.saison || "zzz", "fr");
          return d !== 0 ? d : parDefaut(a, b);
        }
        case "appro": {
          const ga = GRAVITE_STATUT_APPRO[etats[a.id]?.statut as StatutAppro] ?? 9;
          const gb = GRAVITE_STATUT_APPRO[etats[b.id]?.statut as StatutAppro] ?? 9;
          return ga !== gb ? ga - gb : parDefaut(a, b);
        }
        case "quantite":
          return b.quantite_totale - a.quantite_totale || parDefaut(a, b);
        default:
          return parDefaut(a, b);
      }
    });
    return liste;
  }, [commandes, etats, etatsCharges, erreurEtats, vue, saison, statutCommande, query, tri]);

  // Une production décochée de force parce qu'elle a quitté la vue serait une surprise
  // désagréable. On ne la décoche pas : on l'ignore simplement au moment de préparer, et le
  // compteur n'annonce que ce qui part réellement.
  const selection = useMemo(
    () => filtrees.filter((c) => cochees.has(c.id)).map((c) => c.id),
    [filtrees, cochees],
  );
  const toutesCochees = filtrees.length > 0 && selection.length === filtrees.length;

  function basculer(id: number) {
    setCochees((prec) => {
      const suiv = new Set(prec);
      if (suiv.has(id)) suiv.delete(id); else suiv.add(id);
      return suiv;
    });
  }
  function basculerTout() {
    setCochees((prec) => {
      const suiv = new Set(prec);
      if (toutesCochees) filtrees.forEach((c) => suiv.delete(c.id));
      else filtrees.forEach((c) => suiv.add(c.id));
      return suiv;
    });
  }

  const vues: { cle: Vue; label: string; compte: number }[] = [
    { cle: "a_traiter", label: "À traiter", compte: comptes.a_traiter },
    { cle: "a_completer", label: "Fiche à compléter", compte: comptes.a_completer },
    { cle: "a_commander", label: "À commander", compte: comptes.a_commander },
    { cle: "a_recevoir", label: "En réception", compte: comptes.a_recevoir },
    { cle: "complet", label: "Approvisionné", compte: comptes.complet },
    { cle: "tous", label: "Toutes", compte: comptes.tous },
  ];

  function renduEcheance(c: CommandeAppro) {
    const j = joursRestants(c.date_fin_prevue);
    let classe = "";
    let mention = "";
    if (j != null) {
      if (j < 0) { classe = "appro-echeance-retard"; mention = `en retard de ${Math.abs(j)} j`; }
      else if (j <= 14) { classe = "appro-echeance-proche"; mention = `dans ${j} j`; }
      else mention = `dans ${j} j`;
    }
    return (
      <>
        <span className={classe}>{dateFr(c.date_fin_prevue)}</span>
        {mention && <span className="appro-article-meta">{mention}</span>}
      </>
    );
  }

  function renduEtat(c: CommandeAppro) {
    if (erreurEtats) return <span className="appro-etat appro-etat-chargement" title={erreurEtats}>non calculé</span>;
    const e = etats[c.id];
    if (!e) return <span className="appro-etat appro-etat-chargement">calcul…</span>;
    if (e.erreur) return <span className="appro-etat appro-etat-erreur" title={e.erreur}>Calcul impossible</span>;

    const details: string[] = [];
    if (e.nb_lignes_en_anomalie > 0) details.push(`${e.nb_lignes_en_anomalie} à compléter`);
    if (e.nb_lignes_a_commander > 0) details.push(`${e.nb_lignes_a_commander} à commander`);
    if (e.nb_lignes_a_recevoir > 0) details.push(`${e.nb_lignes_a_recevoir} à recevoir`);

    return (
      <>
        <span className={`appro-etat appro-etat-${e.statut}`} title={EXPLICATIONS_STATUT_APPRO[e.statut]}>
          {LIBELLES_STATUT_APPRO[e.statut]}
        </span>
        {/* Un calcul incomplet doit se voir DANS LA LISTE : sans cela, la couverture ci-dessous
            se lirait comme un pourcentage sûr alors qu'elle porte sur des chiffres partiels. */}
        {e.calcul_incomplet && (
          <span
            className="appro-puce incomplet"
            title={`${e.nb_lignes_incompletes} ligne(s) ne couvrent pas toute la production`}
          >
            calcul incomplet
          </span>
        )}
        {e.revision_en_retard && (
          <span className="appro-puce" title="La fiche technique a été révisée depuis le gel de cette recette">
            révision en retard
          </span>
        )}
        {details.length > 0 && <span className="appro-etat-sous">{details.join(" · ")}</span>}
        {e.couverture_pourcent != null && (
          <span className="appro-barre" title={`${e.couverture_pourcent} % des lignes entièrement commandées`}>
            <span style={{ width: `${e.couverture_pourcent}%` }} />
          </span>
        )}
      </>
    );
  }

  if (etatListe === "chargement") {
    return <div className="empty-state">Chargement des commandes…</div>;
  }

  if (etatListe === "erreur") {
    // Jamais « aucune commande » en cas d'échec de lecture : ce serait affirmer qu'il n'y a rien à
    // produire, alors qu'on n'en sait justement rien.
    return (
      <div className="appro-bloc-alerte">
        <strong>Les commandes de fabrication n'ont pas pu être lues.</strong>
        <p style={{ margin: "5px 0 0" }}>{erreurListe}</p>
        <p style={{ margin: "5px 0 0" }}>Ce n'est pas une absence de commandes : la liste n'a pas pu être obtenue.</p>
      </div>
    );
  }

  return (
    <div>
      {erreurEtats && (
        <div className="appro-bloc-alerte" style={{ marginBottom: 14 }}>
          <strong>L'état d'approvisionnement n'a pas pu être calculé.</strong>
          <p style={{ margin: "5px 0 0" }}>{erreurEtats}</p>
          <p style={{ margin: "5px 0 0" }}>
            La liste et le détail de chaque commande restent utilisables : seule la colonne
            « Appro » et le tri par état sont indisponibles.
          </p>
        </div>
      )}

      <div className="tabs">
        {vues.map((v) => (
          <button key={v.cle} className={`tab ${vue === v.cle ? "active" : ""}`} onClick={() => setVue(v.cle)}>
            {v.label} <span className="tab-count">{etatsCharges || v.cle === "tous" ? v.compte : "…"}</span>
          </button>
        ))}
      </div>

      <div className="toolbar">
        <div className="search">
          🔍
          <input
            placeholder="Rechercher par désignation, référence ou numéro de commande…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="plain" value={saison} onChange={(e) => setSaison(e.target.value)}>
          <option value="">Toutes les saisons</option>
          {saisons.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="plain" value={statutCommande} onChange={(e) => setStatutCommande(e.target.value)}>
          <option value="">Tous les statuts de production</option>
          {STATUTS_ELIGIBLES.map((s) => <option key={s} value={s}>{LIBELLES_STATUT_COMMANDE[s] || s}</option>)}
        </select>
        <select className="sort" value={tri} onChange={(e) => setTri(e.target.value as Tri)}>
          {TRIS.map((t) => <option key={t.cle} value={t.cle}>{t.label}</option>)}
        </select>
      </div>

      {/* La barre n'apparaît QUE lorsqu'une production est cochée : une barre d'action visible en
          permanence et inopérante apprend aux yeux à ne plus la voir. */}
      {selection.length > 0 && (
        <div className="appro-barre-selection">
          <span>
            <strong>{selection.length}</strong> production{selection.length > 1 ? "s" : ""} sélectionnée{selection.length > 1 ? "s" : ""}
          </span>
          <button className="btn ghost tiny" onClick={() => setCochees(new Set())}>
            Tout décocher
          </button>
          <button className="btn" style={{ marginLeft: "auto" }} onClick={() => onPreparer(selection)}>
            Préparer des bons de commande MP
          </button>
        </div>
      )}

      <table className="appro-liste">
        <thead>
          <tr>
            <th style={{ width: 34 }}>
              <input
                type="checkbox"
                checked={toutesCochees}
                onChange={basculerTout}
                title={toutesCochees ? "Décocher les productions affichées" : "Cocher les productions affichées"}
                disabled={filtrees.length === 0}
              />
            </th>
            <th style={{ width: 56 }}>Photo</th>
            <th>Article</th>
            <th style={{ width: 150 }}>Commande</th>
            <th style={{ width: 70 }}>Quantité</th>
            <th style={{ width: 120 }}>Livraison</th>
            <th style={{ width: 210 }}>Approvisionnement</th>
            <th style={{ width: 130 }}></th>
          </tr>
        </thead>
        <tbody>
          {filtrees.map((c) => {
            const url = mediaUrl(c.photo_path);
            return (
              <tr key={c.id} className="row">
                <td>
                  <input type="checkbox" checked={cochees.has(c.id)} onChange={() => basculer(c.id)} />
                </td>
                <td>
                  {url
                    ? <div className="thumb-cell"><img src={url} alt="" /></div>
                    : <div className="thumb-cell empty"><span>pas de photo</span></div>}
                </td>
                <td>
                  <span className="appro-article-nom">{libelleArticle(c)}</span>
                  <span className="appro-article-ref">{c.reference || "référence à compléter"}</span>
                  <span className="appro-article-meta">
                    {[c.produit, c.saison].filter(Boolean).join(" · ") || "—"}
                    {c.priorite === "haute" && <span className="appro-puce alerte">priorité {LIBELLES_PRIORITE.haute.toLowerCase()}</span>}
                  </span>
                </td>
                <td>
                  <span className="num" style={{ borderLeft: "none", paddingLeft: 0 }}>{c.numero || "sans numéro"}</span>
                  <span className="appro-article-meta">{LIBELLES_STATUT_COMMANDE[c.statut] || c.statut}</span>
                </td>
                <td style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
                  <strong>{c.quantite_totale}</strong>
                  <span className="appro-article-meta">pièces</span>
                </td>
                <td>{renduEcheance(c)}</td>
                <td>{renduEtat(c)}</td>
                <td style={{ textAlign: "right" }}>
                  <button className="btn ghost tiny" onClick={() => onOuvrir(c.id, libelleArticle(c))}>
                    Voir les besoins
                  </button>
                </td>
              </tr>
            );
          })}
          {filtrees.length === 0 && (
            <tr>
              <td colSpan={8} className="empty-state">
                {commandes.length === 0
                  ? "Aucune commande de fabrication validée, en production ou en contrôle qualité. Les brouillons et les commandes terminées ne sont pas approvisionnables."
                  : "Aucune commande ne correspond à cette vue ou à cette recherche."}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "10px 0 0", lineHeight: 1.6 }}>
        Cochez une ou plusieurs productions pour en préparer les bons de commande matières :
        les besoins sont alors regroupés par composant et par fournisseur.
        <br />
        La barre verte indique la part des lignes de nomenclature <strong>entièrement commandées</strong>.
        Elle se compte en lignes, jamais en quantités : additionner des mètres, des kilos et des
        pièces donnerait un pourcentage dépourvu de sens.
      </p>
    </div>
  );
}
