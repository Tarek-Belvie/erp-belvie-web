import { useEffect, useState } from "react";
import { Article, ListeValeur, PlanningStatut, PLANNING_STATUT_LABELS } from "../../shared/types";
import { mediaUrl } from "../commandes/uiHelpers";

interface Props {
  mois: string;
  onClose: () => void;
  onCreated: (moisPrevuProduction: string) => void;
}

import { MOIS_ABREGES as NOMS_MOIS } from "../../shared/dateLabels";

const AUJOURDHUI = new Date();
const ANNEE_COURANTE = AUJOURDHUI.getFullYear();
const MOIS_COURANT = AUJOURDHUI.getMonth() + 1;

// Un mois de lancement est désactivé s'il tombe avant le mois actuel.
function moisLancementDesactive(mois: number, annee: number): boolean {
  if (annee < ANNEE_COURANTE) return true;
  if (annee === ANNEE_COURANTE && mois < MOIS_COURANT) return true;
  return false;
}

// Un mois de réception est désactivé s'il tombe avant le lancement choisi.
function moisReceptionDesactive(mois: number, annee: number, moisLancement: number, anneeLancement: number): boolean {
  if (annee < anneeLancement) return true;
  if (annee === anneeLancement && mois < moisLancement) return true;
  return false;
}

const STATUTS: PlanningStatut[] = ["idee", "a_etudier", "prototype", "echantillon", "a_modifier", "valide"];

// Flux unifié : qu'il s'agisse d'un produit déjà existant ou d'une idée qui n'existe encore nulle
// part, les DEUX passent ensuite par le même formulaire de planification — seule l'origine des
// informations produit diffère. Un même produit peut être planifié plusieurs fois : article_id
// n'est qu'un lien, jamais une clé unique. Production et réception sont deux dates indépendantes.
export default function PlanningCreateModal({ mois, onClose, onCreated }: Props) {
  const [etape, setEtape] = useState<"choix" | "recherche" | "planification">("choix");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Référentiels — chargés à chaque ouverture du formulaire, jamais transmis par le parent : la
  // liste reflète toujours l'état actuel de Paramètres, sans redémarrage ni mise en cache.
  const [categories, setCategories] = useState<ListeValeur[]>([]);
  const [saisons, setSaisons] = useState<ListeValeur[]>([]);
  const [ateliers, setAteliers] = useState<ListeValeur[]>([]);
  const [rayons, setRayons] = useState<ListeValeur[]>([]);
  useEffect(() => {
    window.api.listes.list("categorie", { includeInactive: true }).then(setCategories);
    window.api.listes.list("saison", { includeInactive: true }).then(setSaisons);
    window.api.listes.list("atelier", { includeInactive: true }).then(setAteliers);
    window.api.listes.list("rayon").then((list) => {
      setRayons(list);
      const homme = list.find((r) => r.nom.toLowerCase() === "homme");
      if (homme) setRayonId(homme.id);
    });
  }, []);

  // --- Étape "recherche" (produit déjà existant dans l'ERP) ---
  const [recherche, setRecherche] = useState("");
  const [resultats, setResultats] = useState<Article[]>([]);
  useEffect(() => {
    if (etape !== "recherche") return;
    window.api.articles.list({ includeIncomplete: true }).then((all: Article[]) => {
      const q = recherche.trim().toLowerCase();
      setResultats(q ? all.filter((a) => a.reference_principale?.toLowerCase().includes(q) || a.produit.toLowerCase().includes(q)) : all.slice(0, 30));
    });
  }, [etape, recherche]);

  // --- Article sélectionné (produit existant) OU saisi à la main (prévisionnel) ---
  const [articleExistant, setArticleExistant] = useState<Article | null>(null);
  const [nom, setNom] = useState("");
  const [categorieId, setCategorieId] = useState<number | "">("");
  const [rayonId, setRayonId] = useState<number | "">("");
  const [abreviation, setAbreviation] = useState("");
  const [erreurAbreviation, setErreurAbreviation] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoNomFichier, setPhotoNomFichier] = useState<string | null>(null);

  // --- Étape "planification" — communs aux deux origines ---
  // Production et réception : deux dates véritablement indépendantes, jamais limitées aux mois
  // actuellement affichés à l'écran. La colonne cliquée pré-remplit uniquement la production.
  const [moisProduction, setMoisProduction] = useState<number>(Number(mois.split("-")[1]));
  const [anneeProduction, setAnneeProduction] = useState<number>(Number(mois.split("-")[0]));
  const [moisReception, setMoisReception] = useState<number | "">("");
  const [anneeReception, setAnneeReception] = useState<number | "">("");
  const [saisonId, setSaisonId] = useState<number | "">("");
  const [anneeCollection, setAnneeCollection] = useState<number | "">(new Date().getFullYear());
  const [quantite, setQuantite] = useState<number | "">("");
  const [coloris, setColoris] = useState("");
  const [statut, setStatut] = useState<PlanningStatut>("idee");
  const [atelierId, setAtelierId] = useState<number | "">("");
  const [notes, setNotes] = useState("");

  function choisirProduitExistant(article: Article) {
    setArticleExistant(article);
    setCategorieId(article.categorie_id ?? "");
    setSaisonId(article.saison_id ?? "");
    setAnneeCollection(article.annee_collection ?? new Date().getFullYear());
    setStatut("a_produire"); // un produit déjà réel part rarement d'une simple "idée"
    setEtape("planification");
  }

  function commencerProvisoire() {
    setArticleExistant(null);
    setEtape("planification");
  }

  async function handlePickPhoto() {
    const res = await window.api.photos.pick();
    if (res.canceled || ("error" in res && res.error)) return;
    if ("filePath" in res) {
      setPhotoPath(res.filePath);
      setPhotoNomFichier(res.filePath.split(/[\\/]/).pop() || "photo sélectionnée");
    }
  }

  function handleChangerMoisProduction(nouveauMois: number) {
    setMoisProduction(nouveauMois);
    if (moisReception !== "" && anneeReception !== "" && moisReceptionDesactive(moisReception, anneeReception, nouveauMois, anneeProduction)) {
      setMoisReception(""); setAnneeReception("");
    }
  }
  function handleChangerAnneeProduction(nouvelleAnnee: number) {
    setAnneeProduction(nouvelleAnnee);
    if (moisReception !== "" && anneeReception !== "" && moisReceptionDesactive(moisReception, anneeReception, moisProduction, nouvelleAnnee)) {
      setMoisReception(""); setAnneeReception("");
    }
  }

  async function handleValiderPlanification() {
    if (!articleExistant && !nom.trim()) { setError("Le nom provisoire est obligatoire pour un article qui n'existe pas encore."); return; }
    if (!articleExistant && abreviation.trim() && !/^[A-Z]{2,5}$/.test(abreviation.trim().toUpperCase())) {
      setErreurAbreviation("2 à 5 lettres, sans espace ni accent (ex : PUL, TSHR).");
      return;
    }
    setErreurAbreviation(null);
    const production = `${anneeProduction}-${String(moisProduction).padStart(2, "0")}`;
    const reception = moisReception !== "" && anneeReception !== "" ? `${anneeReception}-${String(moisReception).padStart(2, "0")}` : null;
    setBusy(true);
    setError(null);
    try {
      const created = await window.api.planning.creer({
        article_id: articleExistant?.id ?? undefined,
        nom_provisoire: articleExistant ? undefined : nom.trim(),
        reference_provisoire: articleExistant ? undefined : (abreviation.trim().toUpperCase() || undefined),
        rayon_id: articleExistant ? undefined : (rayonId || null),
        categorie_id: categorieId || null,
        saison_id: saisonId || null,
        annee_collection: anneeCollection || null,
        mois_prevu_production: production,
        mois_prevu_reception: reception,
        quantite_previsionnelle: quantite === "" ? null : Number(quantite),
        coloris_previsionnels: coloris.trim() || null,
        statut,
        atelier_id: atelierId || null,
        notes: notes.trim() || null,
      });
      if (photoPath && !articleExistant) {
        await window.api.planning.ajouterPhoto(created.id, photoPath);
      }
      onCreated(production);
    } catch (err: any) {
      setError(err?.message || "Erreur lors de la création.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="modal-veil" onClick={onClose}>
      <div className="modal" style={{ maxWidth: etape === "recherche" ? 520 : 640 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3 style={{ fontFamily: "inherit" }}>
            {etape === "choix" && "Ajouter un article au planning"}
            {etape === "recherche" && "Choisir un produit existant"}
            {etape === "planification" && "Données de planification"}
          </h3>
          <button className="icon-btn" onClick={onClose} aria-label="Fermer">✕</button>
        </div>

        {etape === "choix" && (
          <div style={{ display: "flex", gap: 12 }}>
            <button className="v2-choice-card" style={{ flex: 1 }} onClick={() => setEtape("recherche")}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Produit existant</div>
              <div style={{ fontSize: 12.5, color: "var(--v2-text-2)" }}>Rechercher un article déjà présent dans l'ERP — photo, référence et catégorie récupérées automatiquement, vous complétez ensuite la planification.</div>
            </button>
            <button className="v2-choice-card" style={{ flex: 1 }} onClick={commencerProvisoire}>
              <div style={{ fontWeight: 600, marginBottom: 6 }}>Article prévisionnel</div>
              <div style={{ fontSize: 12.5, color: "var(--v2-text-2)" }}>Idée qui n'existe pas encore dans le catalogue — juste une photo et un nom pour démarrer.</div>
            </button>
          </div>
        )}

        {etape === "recherche" && (
          <>
            <input
              type="text" value={recherche} onChange={(e) => setRecherche(e.target.value)}
              placeholder="Rechercher par nom ou référence..."
              style={{ width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "8px 12px", fontSize: 13, marginBottom: 12 }}
            />
            <div style={{ maxHeight: 360, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
              {resultats.map((a) => {
                const principale = a.photos?.find((p) => p.est_principale);
                const url = mediaUrl(principale?.photo_thumb_path);
                return (
                  <div
                    key={a.id}
                    onClick={() => choisirProduitExistant(a)}
                    style={{ display: "flex", gap: 10, alignItems: "center", padding: 8, borderRadius: 8, cursor: "pointer", border: "1px solid #EEF0EA" }}
                  >
                    <div style={{ width: 40, height: 40, borderRadius: 6, overflow: "hidden", background: "#F5F6F1", flexShrink: 0 }}>
                      {url && <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.produit}</div>
                      <div style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>{a.reference_principale || "Référence à compléter"}</div>
                    </div>
                  </div>
                );
              })}
              {resultats.length === 0 && <p style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>Aucun article trouvé.</p>}
            </div>
            <button className="btn ghost tiny" style={{ marginTop: 10 }} onClick={() => setEtape("choix")}>← Retour</button>
          </>
        )}

        {etape === "planification" && (
          <>
            {articleExistant ? (
              <div style={{ display: "flex", gap: 12, alignItems: "center", background: "#F5F6F1", borderRadius: 10, padding: 10, marginBottom: 16 }}>
                <div style={{ width: 52, height: 52, borderRadius: 8, overflow: "hidden", background: "#fff", flexShrink: 0 }}>
                  {(() => {
                    const url = mediaUrl(articleExistant.photos?.find((p) => p.est_principale)?.photo_thumb_path);
                    return url ? <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : null;
                  })()}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>{articleExistant.produit}</div>
                  <div style={{ fontSize: 11.5, color: "var(--v2-text-3)", fontFamily: "var(--v2-font)" }}>{articleExistant.reference_principale || "Référence à compléter"}</div>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--v2-green-dark)", background: "var(--v2-green-bg)", borderRadius: 999, padding: "3px 9px", whiteSpace: "nowrap" }}>Produit ERP</span>
              </div>
            ) : (
              <div style={{ display: "flex", gap: 14, marginBottom: 16 }}>
                <div
                  onClick={handlePickPhoto}
                  style={{ width: 80, height: 80, borderRadius: 10, background: "#F5F6F1", border: "1px dashed #D8D9D0", flexShrink: 0, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden" }}
                >
                  {photoNomFichier ? (
                    <span style={{ fontSize: 10, color: "var(--v2-green-dark)", textAlign: "center", padding: "0 4px" }}>✓ {photoNomFichier}</span>
                  ) : (
                    <span style={{ fontSize: 11, color: "#ABAC9F", textAlign: "center" }}>+ Photo</span>
                  )}
                </div>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
                  <input type="text" placeholder="Nom provisoire (ex: Veste matelassée)" value={nom} onChange={(e) => setNom(e.target.value)} style={{ border: "1px solid #D8D9D0", borderRadius: 8, padding: "8px 10px", fontSize: 13.5, fontWeight: 600 }} />
                  <div style={{ display: "flex", gap: 8 }}>
                    <select value={categorieId} onChange={(e) => setCategorieId(e.target.value ? Number(e.target.value) : "")} style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 8px", fontSize: 12.5 }}>
                      <option value="">Catégorie...</option>
                      {categories.length === 0 && <option value="" disabled>— Aucune catégorie enregistrée dans Paramètres —</option>}
                      {categories.map((c) => <option key={c.id} value={c.id}>{c.nom}</option>)}
                    </select>
                    <select value={rayonId} onChange={(e) => setRayonId(e.target.value ? Number(e.target.value) : "")} style={{ flex: 1, border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 8px", fontSize: 12.5 }}>
                      <option value="">Rayon...</option>
                      {rayons.map((r) => <option key={r.id} value={r.id}>{r.nom}</option>)}
                    </select>
                  </div>
                  <input
                    type="text" placeholder="Abréviation pour la référence (ex: PUL)" maxLength={5} value={abreviation}
                    onChange={(e) => setAbreviation(e.target.value.toUpperCase())}
                    style={{ border: `1px solid ${erreurAbreviation ? "var(--v2-danger)" : "#D8D9D0"}`, borderRadius: 8, padding: "7px 8px", fontSize: 12.5, textTransform: "uppercase" }}
                  />
                  <p style={{ fontSize: 10.5, color: "var(--v2-text-3)", margin: 0 }}>
                    Rayon et abréviation sont facultatifs ici, mais s'ils sont renseignés, « Convertir en produit » créera la fiche article et sa référence en un clic, sans ressaisie.
                  </p>
                  {erreurAbreviation && <p style={{ fontSize: 10.5, color: "var(--v2-danger)", margin: 0 }}>{erreurAbreviation}</p>}
                </div>
              </div>
            )}

            <div className="planning-panel-label" style={{ marginBottom: 8 }}>Dates de planification</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 14, minWidth: 0 }}>
              <div style={{ background: "#F6F7F2", borderRadius: 8, padding: 10, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--v2-text)", marginBottom: 8 }}>Lancement prévu</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 62px", gap: 6, minWidth: 0 }}>
                  <select value={moisProduction} onChange={(e) => handleChangerMoisProduction(Number(e.target.value))} style={{ minWidth: 0, border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 6px", fontSize: 12.5, fontWeight: 600 }}>
                    {NOMS_MOIS.map((n, i) => (
                      <option key={i} value={i + 1} disabled={moisLancementDesactive(i + 1, anneeProduction)}>{n}</option>
                    ))}
                  </select>
                  <input type="number" value={anneeProduction} onChange={(e) => handleChangerAnneeProduction(Number(e.target.value))} min={ANNEE_COURANTE} style={{ minWidth: 0, width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 4px", fontSize: 12.5, fontWeight: 600 }} />
                </div>
              </div>
              <div style={{ background: "#FAFAF8", borderRadius: 8, padding: 10, minWidth: 0 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--v2-text)", marginBottom: 8 }}>Réception prévue</div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 62px", gap: 6, minWidth: 0 }}>
                  <select
                    value={moisReception}
                    onChange={(e) => {
                      const v = e.target.value;
                      setMoisReception(v === "" ? "" : Number(v));
                      if (v !== "" && anneeReception === "") setAnneeReception(anneeProduction);
                    }}
                    style={{ minWidth: 0, border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 6px", fontSize: 12.5, fontWeight: 600 }}
                  >
                    <option value="">Non renseigné</option>
                    {NOMS_MOIS.map((n, i) => (
                      <option key={i} value={i + 1} disabled={moisReceptionDesactive(i + 1, anneeReception === "" ? anneeProduction : anneeReception, moisProduction, anneeProduction)}>{n}</option>
                    ))}
                  </select>
                  <input
                    type="number" value={anneeReception} disabled={moisReception === ""}
                    onChange={(e) => setAnneeReception(e.target.value === "" ? "" : Number(e.target.value))}
                    min={anneeProduction}
                    style={{ minWidth: 0, width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 4px", fontSize: 12.5, fontWeight: 600, opacity: moisReception === "" ? 0.5 : 1 }}
                  />
                </div>
              </div>
            </div>
            <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "-8px 0 14px" }}>
              La réception ne peut pas être antérieure au lancement — libre au-delà, sans lien avec les mois actuellement affichés dans le planning.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, minWidth: 0 }}>
              <label style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>Saison
                <select value={saisonId} onChange={(e) => setSaisonId(e.target.value ? Number(e.target.value) : "")} style={{ display: "block", width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }}>
                  <option value="">Non renseignée</option>
                  {saisons.map((s) => <option key={s.id} value={s.id}>{s.nom}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>Année de collection
                <input type="number" value={anneeCollection} onChange={(e) => setAnneeCollection(e.target.value === "" ? "" : Number(e.target.value))} style={{ display: "block", width: "100%", minWidth: 0, border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }} />
              </label>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, minWidth: 0 }}>
              <label style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>Quantité prévisionnelle (total, tous coloris confondus)
                <input type="number" min={0} value={quantite} onChange={(e) => setQuantite(e.target.value === "" ? "" : Number(e.target.value))} style={{ display: "block", width: "100%", minWidth: 0, border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }} />
              </label>
              <label style={{ fontSize: 11.5, color: "var(--v2-text-3)" }}>Statut
                <select value={statut} onChange={(e) => setStatut(e.target.value as PlanningStatut)} style={{ display: "block", width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }}>
                  {STATUTS.map((s) => <option key={s} value={s}>{PLANNING_STATUT_LABELS[s]}</option>)}
                </select>
              </label>
            </div>

            <label style={{ fontSize: 11.5, color: "var(--v2-text-3)", display: "block", marginBottom: 10 }}>Coloris envisagés (séparés par une virgule)
              <input type="text" placeholder="Noir, Marine, Beige" value={coloris} onChange={(e) => setColoris(e.target.value)} style={{ display: "block", width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }} />
            </label>

            <label style={{ fontSize: 11.5, color: "var(--v2-text-3)", display: "block", marginBottom: 10 }}>Atelier / fournisseur envisagé
              <select value={atelierId} onChange={(e) => setAtelierId(e.target.value ? Number(e.target.value) : "")} style={{ display: "block", width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }}>
                <option value="">Non renseigné</option>
                {ateliers.map((a) => <option key={a.id} value={a.id}>{a.nom}{!a.actif ? " (inactif)" : ""}</option>)}
              </select>
            </label>

            <label style={{ fontSize: 11.5, color: "var(--v2-text-3)", display: "block", marginBottom: 14 }}>Notes
              <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={{ display: "block", width: "100%", border: "1px solid #D8D9D0", borderRadius: 8, padding: "7px 9px", fontSize: 13, marginTop: 3 }} />
            </label>

            {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginBottom: 8 }}>{error}</p>}
            <div className="modal-actions">
              <button className="btn ghost" onClick={() => setEtape(articleExistant ? "recherche" : "choix")} disabled={busy}>← Retour</button>
              <button className="btn primary" onClick={handleValiderPlanification} disabled={busy}>Ajouter au planning</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
