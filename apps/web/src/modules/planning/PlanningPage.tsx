import { useEffect, useMemo, useState } from "react";
import { ListeValeur, PlanningArticle, PlanningKpis, PLANNING_STATUT_LABELS, PlanningStatut } from "../../shared/types";
import PlanningCard, { NiveauDensite } from "./PlanningCard";
import PlanningCreateModal from "./PlanningCreateModal";
import PlanningDetailPanel from "./PlanningDetailPanel";
import { mediaUrl } from "../commandes/uiHelpers";
import { MOIS_ABREGES, labelMoisAnnee } from "../../shared/dateLabels";

type VueMode = "visuel" | "grille" | "tableau";
type Regroupement = "mois" | "categorie" | "statut";
type AxeAffichage = "mois_prevu_production" | "mois_prevu_reception";
const SANS_RECEPTION = "__sans_reception__";

const ORDRE_STATUTS: PlanningStatut[] = [
  "idee", "a_etudier", "prototype", "echantillon", "a_modifier", "valide",
  "a_produire", "en_production", "production_terminee", "shooting_a_preparer", "pret_au_lancement", "lance", "annule",
];

// Génère "n" mois consécutifs à partir d'un mois de départ (format 'AAAA-MM'). Aucune limite codée
// en dur : l'arithmétique année/mois fonctionne indéfiniment, dans les deux sens.
function moisDeLaPeriode(depart: string, n: number): string[] {
  const [anneeDepart, moisDepart] = depart.split("-").map(Number);
  const resultat: string[] = [];
  for (let i = 0; i < n; i++) {
    const total = (moisDepart - 1) + i;
    const annee = anneeDepart + Math.floor(total / 12);
    const mois = (total % 12) + 1;
    resultat.push(`${annee}-${String(mois).padStart(2, "0")}`);
  }
  return resultat;
}

function decalerPeriode(depart: string, nbMois: number): string {
  const [annee, mois] = depart.split("-").map(Number);
  const total = (mois - 1) + nbMois;
  const nouvelleAnnee = annee + Math.floor(total / 12);
  const nouveauMois = ((total % 12) + 12) % 12 + 1;
  return `${nouvelleAnnee}-${String(nouveauMois).padStart(2, "0")}`;
}

function moisCourant(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Nombre de mois entre deux clés 'AAAA-MM' (peut être négatif).
function diffEnMois(a: string, b: string): number {
  const [aa, am] = a.split("-").map(Number);
  const [ba, bm] = b.split("-").map(Number);
  return (ba - aa) * 12 + (bm - am);
}

function cleDeGroupe(item: PlanningArticle, regroupement: Regroupement, axe: AxeAffichage): string {
  if (regroupement === "categorie") return item.categorie_nom || "Sans catégorie";
  if (regroupement === "statut") return item.statut;
  return item[axe] || SANS_RECEPTION;
}

function labelDeGroupe(cle: string, regroupement: Regroupement): string {
  if (cle === SANS_RECEPTION) return "Réception non définie";
  if (regroupement === "statut") return PLANNING_STATUT_LABELS[cle as PlanningStatut] || cle;
  if (regroupement === "mois") return labelMoisAnnee(cle);
  return cle;
}

// Le nombre de mois affichés fait office de niveau de zoom : moins de mois = plus de détail par
// carte, plus de mois = vision globale compacte. Un seul système plutôt que deux réglages qui se
// recoupaient (l'ancien curseur de taille a été retiré).
function densiteDepuisNbMois(n: number): NiveauDensite {
  if (n <= 3) return "detail";
  if (n === 4) return "confortable";
  if (n === 5) return "compact";
  return "global";
}

export default function PlanningPage() {
  const [items, setItems] = useState<PlanningArticle[]>([]);
  const [kpis, setKpis] = useState<PlanningKpis | null>(null);
  const [categories, setCategories] = useState<ListeValeur[]>([]);
  const [saisons, setSaisons] = useState<ListeValeur[]>([]);
  const [ateliers, setAteliers] = useState<ListeValeur[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [recherche, setRecherche] = useState("");
  const [filtreCategorie, setFiltreCategorie] = useState<number | "">("");
  const [filtreStatut, setFiltreStatut] = useState<string>("");
  const [filtreSaison, setFiltreSaison] = useState<number | "">("");

  const [createModalMois, setCreateModalMois] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<PlanningArticle | null>(null);
  const [panelModifie, setPanelModifie] = useState(false);

  // Empêche de perdre silencieusement une modification en cours en cliquant sur une autre carte
  // pendant que le panneau est ouvert — mêmes garanties que le bouton × / Échap / clic extérieur.
  function handleOuvrirDetail(it: PlanningArticle) {
    if (selectedItem && selectedItem.id !== it.id && panelModifie) {
      notify("Enregistrez ou fermez d'abord vos modifications en cours avant d'ouvrir un autre article.");
      return;
    }
    setSelectedItem(it);
  }
  const [confirmationConversion, setConfirmationConversion] = useState<number | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [draggedId, setDraggedId] = useState<number | null>(null);

  const [vueMode, setVueMode] = useState<VueMode>("visuel");
  const [regroupement, setRegroupement] = useState<Regroupement>("mois");
  const [vueCollection, setVueCollection] = useState(false);
  const [axeAffichage, setAxeAffichage] = useState<AxeAffichage>("mois_prevu_production");

  // Navigation temporelle : mois de départ libre + nombre de mois affichés (3 à 6). Aucun
  // défilement horizontal — la grille se répartit toujours sur 100 % de la largeur disponible.
  const [periodeDepart, setPeriodeDepart] = useState(moisCourant());
  const [nbMoisAffiches, setNbMoisAffiches] = useState(4);
  const [moisDepartChoisi, setMoisDepartChoisi] = useState(Number(periodeDepart.split("-")[1]));
  const [anneeDepartChoisie, setAnneeDepartChoisie] = useState(Number(periodeDepart.split("-")[0]));

  const mois = useMemo(() => moisDeLaPeriode(periodeDepart, nbMoisAffiches), [periodeDepart, nbMoisAffiches]);
  const niveauDensite = densiteDepuisNbMois(nbMoisAffiches);

  // Bornes réelles de navigation : premier et dernier article réellement planifié sur l'axe actif
  // (lancement ou réception). Le mois actuel sert de repli si aucune donnée n'existe encore — ces
  // bornes ne limitent jamais les dates saisissables à la création, uniquement le déplacement du
  // dashboard. Elles s'élargissent naturellement avec les données, puisque recalculées à chaque
  // rafraîchissement.
  const [borneMin, borneMax] = useMemo(() => {
    const valeurs = items.map((it) => it[axeAffichage]).filter((v): v is string => !!v);
    if (valeurs.length === 0) return [moisCourant(), moisCourant()];
    return [valeurs.reduce((a, b) => (a < b ? a : b)), valeurs.reduce((a, b) => (a > b ? a : b))];
  }, [items, axeAffichage]);

  // Repositionne automatiquement dès que la période affichée sort des bornes disponibles — que ce
  // soit après un changement d'axe (Lancement ↔ Réception) ou après un rafraîchissement des données.
  useEffect(() => {
    if (!loaded) return;
    const fenetre = moisDeLaPeriode(periodeDepart, nbMoisAffiches);
    const horsBornes = borneMax < fenetre[0] || borneMin > fenetre[fenetre.length - 1];
    if (horsBornes) {
      setPeriodeDepart(borneMin);
      setMoisDepartChoisi(Number(borneMin.split("-")[1]));
      setAnneeDepartChoisie(Number(borneMin.split("-")[0]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axeAffichage, borneMin, borneMax, loaded]);

  function notify(msg: string) { setToast(msg); setTimeout(() => setToast(null), 2500); }

  async function refresh() {
    const [list, k] = await Promise.all([
      window.api.planning.list({
        categorieId: filtreCategorie || undefined,
        statut: filtreStatut || undefined,
        saisonId: filtreSaison || undefined,
        recherche: recherche.trim() || undefined,
      }),
      window.api.planning.kpis(),
    ]);
    setItems(list);
    setKpis(k);
  }

  useEffect(() => {
    async function load() {
      const [cat, sai, ate] = await Promise.all([
        window.api.listes.list("categorie", { includeInactive: true }),
        window.api.listes.list("saison", { includeInactive: true }),
        window.api.listes.list("atelier", { includeInactive: true }),
      ]);
      setCategories(cat);
      setSaisons(sai);
      setAteliers(ate);
      setLoaded(true);
    }
    load();
  }, []);

  useEffect(() => { if (loaded) refresh(); }, [loaded, filtreCategorie, filtreStatut, filtreSaison, recherche]);

  // Groupes affichés : pour "mois", la période choisie (mois vides inclus, pour pouvoir y
  // planifier). Pour catégorie/statut, seuls les groupes réellement présents s'affichent.
  const groupes = useMemo(() => {
    if (regroupement === "mois") {
      if (axeAffichage === "mois_prevu_reception" && items.some((it) => !it.mois_prevu_reception)) {
        return [...mois, SANS_RECEPTION];
      }
      return mois;
    }
    if (regroupement === "statut") return ORDRE_STATUTS.filter((s) => items.some((it) => it.statut === s));
    const set = new Set(items.map((it) => it.categorie_nom || "Sans catégorie"));
    return Array.from(set).sort();
  }, [regroupement, mois, items, axeAffichage]);

  const parGroupe = useMemo(() => {
    const map: Record<string, PlanningArticle[]> = {};
    groupes.forEach((g) => { map[g] = []; });
    items.forEach((it) => { const cle = cleDeGroupe(it, regroupement, axeAffichage); (map[cle] ||= []).push(it); });
    return map;
  }, [groupes, items, regroupement, axeAffichage]);

  function handleReinitialiser() {
    setFiltreCategorie(""); setFiltreStatut(""); setFiltreSaison(""); setRecherche("");
  }

  function allerA(mois: number, annee: number) {
    const cible = `${annee}-${String(mois).padStart(2, "0")}`;
    setPeriodeDepart(cible);
    setMoisDepartChoisi(mois);
    setAnneeDepartChoisie(annee);
  }

  function decaler(sens: 1 | -1) {
    const nouveau = decalerPeriode(periodeDepart, sens * nbMoisAffiches);
    setPeriodeDepart(nouveau);
    setMoisDepartChoisi(Number(nouveau.split("-")[1]));
    setAnneeDepartChoisie(Number(nouveau.split("-")[0]));
  }

  // --- Drag & drop natif : uniquement actif en regroupement "Mois" (déplace la date active,
  // production OU réception selon axeAffichage — jamais les deux). Pour les autres regroupements,
  // le drag & drop entre groupes n'a pas de sens univoque — désactivé.
  function handleDragStart(id: number) { if (regroupement === "mois") setDraggedId(id); }

  async function handleDropSur(groupeCible: string, avantId: number | null) {
    if (draggedId == null || regroupement !== "mois") return;
    if (groupeCible === SANS_RECEPTION) return; // on ne peut pas déposer "sans date" par glisser-déposer
    const dragged = items.find((it) => it.id === draggedId);
    if (!dragged) return;

    const destinationActuelle = parGroupe[groupeCible] ?? [];
    const sansDragged = destinationActuelle.filter((it) => it.id !== draggedId);
    const indexInsertion = avantId != null ? sansDragged.findIndex((it) => it.id === avantId) : sansDragged.length;
    const nouvelOrdre = [...sansDragged];
    nouvelOrdre.splice(indexInsertion < 0 ? nouvelOrdre.length : indexInsertion, 0, dragged);
    const orderedIds = nouvelOrdre.map((it) => it.id);

    setItems((prev) => prev.map((it) => (it.id === draggedId ? { ...it, [axeAffichage]: groupeCible } : it)));
    setDraggedId(null);

    try {
      if (dragged[axeAffichage] === groupeCible) {
        await window.api.planning.reordonner(groupeCible, orderedIds);
      } else {
        await window.api.planning.deplacer(draggedId, axeAffichage, groupeCible, orderedIds);
      }
      refresh();
    } catch {
      refresh();
    }
  }

  function handleOpenProduit(articleId: number) {
    notify("Fiche produit liée — ouvrez le module Articles pour la consulter en détail.");
  }

  return (
    <div className="planning-page">
      <div className="planning-header">
        <div>
          <div className="page-title">Planification</div>
          <div className="page-sub">Préparez visuellement vos futures collections — un article peut apparaître ici avant même d'exister dans le catalogue</div>
        </div>
        <div className="planning-header-actions">
          <div className="planning-search">
            <span>🔍</span>
            <input type="text" placeholder="Rechercher un article, une référence..." value={recherche} onChange={(e) => setRecherche(e.target.value)} />
          </div>
          <div className="planning-vue-switch">
            <button className={vueMode === "visuel" ? "active" : ""} onClick={() => setVueMode("visuel")}>Visuel</button>
            <button className={vueMode === "grille" ? "active" : ""} onClick={() => setVueMode("grille")}>Grille</button>
            <button className={vueMode === "tableau" ? "active" : ""} onClick={() => setVueMode("tableau")}>Tableau</button>
          </div>
          <button className="btn primary" onClick={() => setCreateModalMois(mois[0])}>+ Ajouter un article</button>
        </div>
      </div>

      {kpis && (
        <div className="planning-kpis">
          <div className="planning-kpi" onClick={() => setFiltreStatut("")}>
            <div className="planning-kpi-value">{kpis.total}</div>
            <div className="planning-kpi-label">Articles planifiés</div>
          </div>
          <div className="planning-kpi" onClick={() => setFiltreStatut("prototype")}>
            <div className="planning-kpi-value">{kpis.en_developpement}</div>
            <div className="planning-kpi-label">En développement</div>
          </div>
          <div className="planning-kpi" onClick={() => setFiltreStatut("en_production")}>
            <div className="planning-kpi-value">{kpis.en_production}</div>
            <div className="planning-kpi-label">En production</div>
          </div>
          <div className="planning-kpi" onClick={() => setFiltreStatut("shooting_a_preparer")}>
            <div className="planning-kpi-value">{kpis.shooting_a_preparer}</div>
            <div className="planning-kpi-label">Shooting à préparer</div>
          </div>
          <div className="planning-kpi" onClick={() => setFiltreStatut("pret_au_lancement")}>
            <div className="planning-kpi-value">{kpis.pret_au_lancement}</div>
            <div className="planning-kpi-label">Prêts au lancement</div>
          </div>
        </div>
      )}

      {/* Navigation temporelle — volontairement séparée des filtres et de Vue Collection. */}
      {regroupement === "mois" && vueMode !== "tableau" && (
        <div className="planning-nav-temps">
          <button className="planning-nav-fleche" onClick={() => decaler(-1)} disabled={mois[0] <= borneMin} aria-label="Période précédente">‹</button>
          <div className="planning-nav-controle">
            <span>À partir de</span>
            <select value={moisDepartChoisi} onChange={(e) => allerA(Number(e.target.value), anneeDepartChoisie)}>
              {MOIS_ABREGES.map((n, i) => <option key={i} value={i + 1}>{n}</option>)}
            </select>
            <input type="number" value={anneeDepartChoisie} onChange={(e) => allerA(moisDepartChoisi, Number(e.target.value))} />
          </div>
          <div className="planning-nav-controle">
            <span>Afficher</span>
            {[3, 4, 5, 6].map((n) => (
              <button key={n} className={`planning-nb-mois-btn ${nbMoisAffiches === n ? "active" : ""}`} onClick={() => setNbMoisAffiches(n)}>{n}</button>
            ))}
            <span>mois</span>
          </div>
          <span className="planning-nav-separateur" />
          <div className="planning-nav-controle">
            <span>Afficher selon</span>
            <div className="planning-axe-switch">
              <button className={axeAffichage === "mois_prevu_production" ? "active" : ""} onClick={() => setAxeAffichage("mois_prevu_production")}>Lancement</button>
              <button className={axeAffichage === "mois_prevu_reception" ? "active" : ""} onClick={() => setAxeAffichage("mois_prevu_reception")}>Réception</button>
            </div>
          </div>
          <button className="planning-nav-fleche" onClick={() => decaler(1)} disabled={mois[mois.length - 1] >= borneMax} aria-label="Période suivante">›</button>
        </div>
      )}

      <div className="planning-filtres">
        <select value={filtreCategorie} onChange={(e) => setFiltreCategorie(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Catégorie : Toutes</option>
          {categories.length === 0 && loaded && <option value="" disabled>— Aucune catégorie enregistrée dans Paramètres —</option>}
          {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
        </select>
        <select value={filtreSaison} onChange={(e) => setFiltreSaison(e.target.value ? Number(e.target.value) : "")}>
          <option value="">Saison : Toutes</option>
          {saisons.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
        </select>
        <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)}>
          <option value="">Statut : Tous</option>
          {Object.keys(kpis?.parStatut || {}).map((s) => <option key={s} value={s}>{PLANNING_STATUT_LABELS[s as PlanningStatut] || s}</option>)}
        </select>
        {(filtreCategorie || filtreSaison || filtreStatut || recherche) && (
          <button className="btn ghost tiny" onClick={handleReinitialiser}>↺ Réinitialiser</button>
        )}

        <span className="planning-filtres-separateur" />

        <label className="planning-regroupement">
          Regrouper par
          <select value={regroupement} onChange={(e) => setRegroupement(e.target.value as Regroupement)}>
            <option value="mois">Mois</option>
            <option value="categorie">Catégorie</option>
            <option value="statut">Statut</option>
          </select>
        </label>

        {vueMode !== "tableau" && (
          <button className={`btn ghost tiny ${vueCollection ? "planning-collection-active" : ""}`} onClick={() => setVueCollection((v) => !v)}>
            {vueCollection ? "✓ Vue Collection" : "Vue Collection"}
          </button>
        )}
      </div>

      {vueMode === "tableau" ? (
        <div className="planning-tableau">
          <table className="grid-table">
            <thead>
              <tr><th></th><th style={{ textAlign: "left" }}>Article</th><th>Statut</th><th>Lancement</th><th>Réception</th><th>Catégorie</th><th>Coloris</th><th>Quantité</th></tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} onClick={() => handleOuvrirDetail(it)} style={{ cursor: "pointer" }}>
                  <td>
                    <div className="planning-tableau-thumb">
                      {it.photo_affichee_thumb ? <img src={mediaUrl(it.photo_affichee_thumb) ?? undefined} alt="" /> : <span>—</span>}
                    </div>
                  </td>
                  <td className="grid-row-label">{it.nom_affiche}</td>
                  <td>{PLANNING_STATUT_LABELS[it.statut]}</td>
                  <td>{labelMoisAnnee(it.mois_prevu_production)}</td>
                  <td>{it.mois_prevu_reception ? labelMoisAnnee(it.mois_prevu_reception) : "—"}</td>
                  <td>{it.categorie_nom || "—"}</td>
                  <td>{it.coloris.join(", ") || "—"}</td>
                  <td>{it.quantite_previsionnelle != null ? `${it.quantite_previsionnelle} pcs` : "—"}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={8} className="empty-state">Aucun article ne correspond à cette vue.</td></tr>}
            </tbody>
          </table>
        </div>
      ) : vueMode === "grille" ? (
        <div className="planning-grille">
          {groupes.map((g) => {
            const itemsDuGroupe = parGroupe[g] ?? [];
            if (itemsDuGroupe.length === 0) return null;
            return (
              <div key={g} className="planning-grille-section">
                <div className="planning-mois-titre" style={{ marginBottom: 14 }}>
                  {labelDeGroupe(g, regroupement).toUpperCase()}
                  <span>{itemsDuGroupe.length} article{itemsDuGroupe.length > 1 ? "s" : ""}</span>
                </div>
                <div className="planning-grille-cartes">
                  {itemsDuGroupe.map((it) => (
                    <PlanningCard key={it.id} item={it} onClick={() => handleOuvrirDetail(it)} vueCollection={vueCollection} niveau="confortable" />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        // Grille CSS à répartition égale — jamais de défilement horizontal, quel que soit le
        // nombre de mois choisi (3 à 6) : la largeur disponible se divise toujours à 100 %.
        <div className="planning-mois-grid" style={{ gridTemplateColumns: `repeat(${regroupement === "mois" ? mois.length : groupes.length}, 1fr)` }}>
          {groupes.map((g) => {
            const itemsDuGroupe = parGroupe[g] ?? [];
            return (
              <div
                key={g}
                className="planning-mois-colonne"
                onDragOver={(e) => regroupement === "mois" && g !== SANS_RECEPTION && e.preventDefault()}
                onDrop={(e) => { e.preventDefault(); handleDropSur(g, null); }}
              >
                <div className="planning-mois-titre">
                  {labelDeGroupe(g, regroupement).toUpperCase()}
                  <span>{itemsDuGroupe.length} article{itemsDuGroupe.length > 1 ? "s" : ""}</span>
                </div>

                {itemsDuGroupe.map((it) => (
                  <div
                    key={it.id}
                    draggable={regroupement === "mois"}
                    onDragStart={() => handleDragStart(it.id)}
                    onDragOver={(e) => { if (regroupement === "mois") { e.preventDefault(); e.stopPropagation(); } }}
                    onDrop={(e) => { if (regroupement === "mois") { e.preventDefault(); e.stopPropagation(); handleDropSur(g, it.id); } }}
                    style={{ opacity: draggedId === it.id ? 0.4 : 1 }}
                  >
                    <PlanningCard item={it} onClick={() => handleOuvrirDetail(it)} vueCollection={vueCollection} niveau={regroupement === "mois" ? niveauDensite : "confortable"} />
                  </div>
                ))}

                {regroupement === "mois" && g !== SANS_RECEPTION && (
                  <button className="planning-ajouter-btn" onClick={() => setCreateModalMois(g)}>+ Ajouter un article</button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {createModalMois && (
        <PlanningCreateModal
          mois={createModalMois}
          onClose={() => setCreateModalMois(null)}
          onCreated={(moisPrevuProduction) => {
            setCreateModalMois(null);
            refresh();
            if (regroupement === "mois" && !mois.includes(moisPrevuProduction) && axeAffichage === "mois_prevu_production") {
              const decalage = Math.floor(diffEnMois(periodeDepart, moisPrevuProduction) / nbMoisAffiches) * nbMoisAffiches;
              const nouveauDepart = decalerPeriode(periodeDepart, decalage);
              setPeriodeDepart(nouveauDepart);
              setMoisDepartChoisi(Number(nouveauDepart.split("-")[1]));
              setAnneeDepartChoisie(Number(nouveauDepart.split("-")[0]));
              notify(`Article ajouté pour ${labelMoisAnnee(moisPrevuProduction)} — période affichée automatiquement.`);
            } else {
              notify("Article ajouté au planning.");
            }
          }}
        />
      )}

      {selectedItem && (
        <PlanningDetailPanel
          item={items.find((it) => it.id === selectedItem.id) || selectedItem}
          onClose={() => { setSelectedItem(null); setPanelModifie(false); }}
          onChanged={refresh}
          onDirtyChange={setPanelModifie}
          onOpenConvertir={async () => {
            // Toujours direct : aucune information n'est plus bloquante pour créer l'article
            // (produit_id est désormais facultatif) — tout ce qui est déjà connu est repris tel
            // quel, sans jamais redemander une information déjà présente dans la planification.
            try {
              const res = await window.api.planning.convertirEnProduit(selectedItem.id, {});
              setSelectedItem(null);
              setPanelModifie(false);
              refresh();
              setConfirmationConversion(res.articleId);
            } catch (err: any) {
              notify(err?.message || "Impossible de créer le produit.");
            }
          }}
          onOpenProduit={handleOpenProduit}
        />
      )}

      {confirmationConversion != null && (
        <div className="modal-veil" onClick={() => setConfirmationConversion(null)}>
          <div className="modal small" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>✓ Produit créé avec succès</h3></div>
            <p style={{ fontSize: 13, color: "var(--v2-text-2)" }}>La fiche article a été créée à partir des informations déjà renseignées dans la planification, sans ressaisie.</p>
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setConfirmationConversion(null)}>Fermer</button>
              <button className="btn primary" onClick={() => { handleOpenProduit(confirmationConversion); setConfirmationConversion(null); }}>Ouvrir la fiche produit</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
