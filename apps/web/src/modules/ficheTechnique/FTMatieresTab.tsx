import { useEffect, useState } from "react";
import {
  Article,
  FicheTechnique,
  FTMatiere,
  FTMatiereCouleur,
  MatiereCatalogue,
  MatiereCouleur,
} from "../../shared/types";
import Icon from "../../shared/Icon";
import { FieldLabel, FTField, Popover, FT_BORDER_COLOR, FT_TEXT_SECONDARY } from "./FTChamps";

interface Props {
  fiche: FicheTechnique;
  article: Article;
  lectureSeule: boolean;
  onChanged: () => void;
}

const UNITES: { value: string; label: string }[] = [
  { value: "kg", label: "kg" },
  { value: "m", label: "m" },
  { value: "piece", label: "pièce" },
  { value: "lot", label: "lot" },
];

/** Miroir exact de consommationBudgetee() côté processus principal. Aucune colonne ne stocke
 *  cette valeur : elle est recalculée à l'affichage, ici pour l'aperçu immédiat pendant la
 *  saisie, et par le main process pour la valeur qui fait foi (matiere.consommation_budgetee). */
function budgetee(technique: number | null, perte: number | null): number | null {
  if (technique == null) return null;
  return technique * (1 + (perte || 0) / 100);
}

function fmt(n: number | null, decimales = 3): string {
  if (n == null) return "—";
  return n.toFixed(decimales).replace(".", ",");
}

export default function FTMatieresTab({ fiche, lectureSeule, onChanged }: Props) {
  const matieres = fiche.matieres ?? [];
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MatiereCatalogue[]>([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.api.ficheTechnique.searchMatieresCatalogue(query).then(setResults);
  }, [query]);

  function notifyErr(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }

  async function handleAdd(nom: string) {
    if (!nom.trim()) return;
    try {
      const created = await window.api.ficheTechnique.addMatiere(fiche.id, { nom: nom.trim() });
      setQuery("");
      setExpandedId(created.id);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Erreur lors de l'ajout.");
    }
  }

  async function handleUpdate(id: number, patch: Partial<FTMatiere>) {
    try {
      await window.api.ficheTechnique.updateMatiere(id, patch);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Modification impossible.");
    }
  }

  async function handleDelete(id: number) {
    try {
      await window.api.ficheTechnique.deleteMatiere(id);
      if (expandedId === id) setExpandedId(null);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Suppression impossible.");
    }
  }

  return (
    <div>
      {!lectureSeule && (
        <div className="detail-block">
          <h4>Ajouter une matière</h4>
          <div style={{ position: "relative" }}>
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tapez pour rechercher (ex : moll, jers...) ou créer une nouvelle matière"
              style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "8px 10px", fontSize: 13.5 }}
              onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) handleAdd(query.trim()); }}
            />
            {query.trim() && (
              <div style={{ border: "1px solid #E7E9E0", borderRadius: 8, marginTop: 4, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
                {results.map((r) => (
                  <div
                    key={r.id}
                    onClick={() => handleAdd(r.nom)}
                    style={{ padding: "8px 11px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #F0F1EC" }}
                  >
                    {r.nom}
                  </div>
                ))}
                <div onClick={() => handleAdd(query.trim())} style={{ padding: "8px 11px", fontSize: 12.5, cursor: "pointer", color: "#0E9F6E" }}>
                  + Créer « {query.trim()} »
                </div>
              </div>
            )}
          </div>
          {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginTop: 6 }}>{error}</p>}
        </div>
      )}

      {lectureSeule && error && (
        <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginBottom: 8 }}>{error}</p>
      )}

      {matieres.length === 0 ? (
        <p style={{ fontSize: 13, color: "var(--v2-text-3)" }}>Aucune matière pour l'instant.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {matieres.map((m) => (
            <MatiereCard
              key={m.id}
              matiere={m}
              expanded={expandedId === m.id}
              lectureSeule={lectureSeule}
              onToggle={() => setExpandedId(expandedId === m.id ? null : m.id)}
              onUpdate={(patch) => handleUpdate(m.id, patch)}
              onDelete={() => handleDelete(m.id)}
              onChanged={onChanged}
              onError={notifyErr}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MatiereCard({ matiere, expanded, lectureSeule, onToggle, onUpdate, onDelete, onChanged, onError }: {
  matiere: FTMatiere;
  expanded: boolean;
  lectureSeule: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<FTMatiere>) => void;
  onDelete: () => void;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const m = matiere;
  const uniteLabel = UNITES.find((u) => u.value === m.unite)?.label ?? m.unite;
  const resume = [
    m.grammage ? `${m.grammage} g/m²` : null,
    m.consommation_budgetee != null ? `${fmt(m.consommation_budgetee)} ${uniteLabel}/pièce` : null,
    m.couleurs.length > 0 ? `${m.couleurs.length} coloris` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div style={{ border: "1px solid #E7E9E0", borderRadius: 10, background: "#fff" }}>
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", cursor: "pointer" }}>
        <span style={{ fontSize: 11, color: "var(--v2-text-3)", transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▶</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontSize: 13.5 }}>{m.nom}</strong>
          {m.utilisation && (
            <span style={{ fontSize: 12, color: "var(--v2-text-3)", marginLeft: 8 }}>{m.utilisation}</span>
          )}
        </div>
        {resume && <span style={{ fontSize: 12, color: "var(--v2-text-3)" }}>{resume}</span>}
        {!lectureSeule && (
          <button className="btn ghost tiny" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
        )}
      </div>

      {expanded && (
        <div style={{ padding: "0 14px 14px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 10 }}>
            <FTField label="Nom de la matière" value={m.nom} disabled={lectureSeule} onSave={(v) => onUpdate({ nom: v } as any)} />
            <FTField label="Utilisation" value={m.utilisation} disabled={lectureSeule} onSave={(v) => onUpdate({ utilisation: v } as any)} />
            <FTField label="Composition" value={m.composition} disabled={lectureSeule} onSave={(v) => onUpdate({ composition: v } as any)} />
            <FTField label="Grammage (g/m²)" value={m.grammage} disabled={lectureSeule} onSave={(v) => onUpdate({ grammage: v } as any)} />
            <div>
              <FieldLabel>Unité</FieldLabel>
              <select
                value={m.unite}
                disabled={lectureSeule}
                onChange={(e) => onUpdate({ unite: e.target.value } as any)}
                style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff" }}
              >
                {UNITES.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </select>
            </div>
            <FTField
              label={`Consommation technique (${uniteLabel}/pièce)`}
              value={m.consommation_technique != null ? String(m.consommation_technique) : null}
              disabled={lectureSeule}
              onSave={(v) => onUpdate({ consommation_technique: v as any })}
            />
            <FTField
              label="Perte (%)"
              value={m.perte_pourcent != null ? String(m.perte_pourcent) : null}
              disabled={lectureSeule}
              onSave={(v) => onUpdate({ perte_pourcent: v as any })}
            />
            <div>
              <FieldLabel>Consommation budgétée</FieldLabel>
              <div
                title="Calculée : consommation technique × (1 + perte / 100). Jamais saisie ni stockée."
                style={{
                  border: "1px dashed var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5,
                  background: "#FAFBF7", color: "var(--v2-text-2)",
                }}
              >
                {m.consommation_budgetee != null
                  ? `${fmt(budgetee(m.consommation_technique, m.perte_pourcent))} ${uniteLabel}/pièce`
                  : "—"}
              </div>
            </div>
          </div>

          <ColorisBloc matiere={m} lectureSeule={lectureSeule} onChanged={onChanged} onError={onError} />
        </div>
      )}
    </div>
  );
}

/** Coloris : couleur PRODUIT (listes_valeurs, le même référentiel que les quantités réelles de
 *  commande_lignes) -> coloris MATIÈRE (catalogue de la matière, qui porte la référence
 *  fournisseur). Deux notions distinctes, jamais confondues. */
function ColorisBloc({ matiere, lectureSeule, onChanged, onError }: {
  matiere: FTMatiere;
  lectureSeule: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [couleursProduit, setCouleursProduit] = useState<{ id: number; nom: string }[]>([]);
  const [colorisMatiere, setColorisMatiere] = useState<MatiereCouleur[]>([]);
  const [ajout, setAjout] = useState(false);
  const [couleurProduitId, setCouleurProduitId] = useState<string>("");
  const [matiereCouleurId, setMatiereCouleurId] = useState<string>("");
  const [nouveauColoris, setNouveauColoris] = useState<{ libelle: string; code: string; reference: string } | null>(null);
  const [nouvelleCouleur, setNouvelleCouleur] = useState<string | null>(null);

  useEffect(() => {
    window.api.listes.list("couleur").then(setCouleursProduit);
  }, []);
  // La dépendance porte sur les matiere_couleur_id réellement affectés, et non sur le simple
  // NOMBRE de couleurs : créer un coloris ou en changer un ne modifie pas la longueur du tableau,
  // la liste ne se serait donc jamais rechargée dans ces deux cas.
  const signatureColoris = matiere.couleurs.map((c) => c.matiere_couleur_id ?? 0).join(",");
  useEffect(() => {
    if (!matiere.matiere_catalogue_id) { setColorisMatiere([]); return; }
    window.api.ficheTechnique.listMatiereCouleurs(matiere.matiere_catalogue_id).then(setColorisMatiere);
  }, [matiere.matiere_catalogue_id, matiere.couleurs.length, signatureColoris]);

  async function rechargerColoris() {
    if (!matiere.matiere_catalogue_id) return;
    setColorisMatiere(await window.api.ficheTechnique.listMatiereCouleurs(matiere.matiere_catalogue_id));
  }

  async function rechargerCouleursProduit() {
    setCouleursProduit(await window.api.listes.list("couleur"));
  }

  // Reutilise listes.create("couleur", nom), le meme mecanisme que l'ajout a la volee du
  // formulaire de commande. Aucune logique dupliquee ici : c'est listes.js qui detecte les
  // doublons au nom normalise et qui REACTIVE une couleur desactivee du meme nom au lieu d'en
  // creer une seconde. Une couleur absente du menu parce que desactivee revient donc a sa place,
  // avec son id d'origine — et tout l'historique qui s'y rattache reste coherent.
  async function handleCreerCouleurProduit() {
    const nom = (nouvelleCouleur || "").trim();
    if (!nom) { onError("Saisissez le nom de la couleur produit."); return; }
    try {
      const creee = await window.api.listes.create("couleur", nom);
      await rechargerCouleursProduit();
      setCouleurProduitId(String(creee.id));
      setNouvelleCouleur(null);
    } catch (err: any) {
      onError(err?.message || "Création de la couleur impossible.");
    }
  }

  async function handleAjouter() {
    if (!couleurProduitId) { onError("Sélectionnez une couleur produit."); return; }
    try {
      await window.api.ficheTechnique.addMatiereCouleur(matiere.id, {
        couleur_produit_id: Number(couleurProduitId),
        matiere_couleur_id: matiereCouleurId ? Number(matiereCouleurId) : null,
      });
      setCouleurProduitId("");
      setMatiereCouleurId("");
      setAjout(false);
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Ajout impossible.");
    }
  }

  async function handleCreerColoris() {
    if (!nouveauColoris) return;
    if (!matiere.matiere_catalogue_id) { onError("Cette matière n'est pas reliée au catalogue."); return; }
    try {
      const cree = await window.api.ficheTechnique.createMatiereCouleur(matiere.matiere_catalogue_id, {
        libelle: nouveauColoris.libelle,
        code: nouveauColoris.code || null,
        reference: nouveauColoris.reference || null,
      });
      await rechargerColoris();
      setMatiereCouleurId(String(cree.id));
      setNouveauColoris(null);
    } catch (err: any) {
      onError(err?.message || "Création du coloris impossible.");
    }
  }

  // Création d'un coloris DEPUIS une ligne déjà enregistrée. Le coloris n'existant pas encore au
  // moment où la couleur produit a été ajoutée, c'est ici qu'on doit pouvoir le créer — sinon la
  // correspondance reste bloquée à « coloris à définir » sans aucun moyen d'en sortir.
  // Après création, il est immédiatement affecté à CETTE ligne via updateMatiereCouleur, qui met
  // à jour matiere_couleur_id sans jamais supprimer ni recréer la couleur produit.
  async function handleCreerColorisPourLigne(ligne: FTMatiereCouleur, payload: { libelle: string; code: string; reference: string }) {
    if (!matiere.matiere_catalogue_id) { onError("Cette matière n'est pas reliée au catalogue."); return false; }
    try {
      const cree = await window.api.ficheTechnique.createMatiereCouleur(matiere.matiere_catalogue_id, {
        libelle: payload.libelle,
        code: payload.code || null,
        reference: payload.reference || null,
      });
      await rechargerColoris();
      await window.api.ficheTechnique.updateMatiereCouleur(ligne.id, { matiere_couleur_id: cree.id });
      onChanged();
      return true;
    } catch (err: any) {
      onError(err?.message || "Création du coloris impossible.");
      return false;
    }
  }

  async function handleChangerColoris(ligne: FTMatiereCouleur, value: string) {
    try {
      await window.api.ficheTechnique.updateMatiereCouleur(ligne.id, {
        matiere_couleur_id: value ? Number(value) : null,
      });
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Modification impossible.");
    }
  }

  async function handleSupprimer(ligne: FTMatiereCouleur) {
    try {
      await window.api.ficheTechnique.deleteMatiereCouleur(ligne.id);
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Suppression impossible.");
    }
  }

  // Les couleurs deja associees restent VISIBLES, simplement desactivees : les retirer de la liste
  // donnait l'impression d'un referentiel incomplet, sans expliquer pourquoi. Toutes les couleurs
  // actives de listes_valeurs sont donc affichees, dans l'ordre alphabetique renvoye par
  // listes.list() — aucun tri ni filtrage supplementaire cote interface.
  const dejaUtilisees = new Set(matiere.couleurs.map((c) => c.couleur_produit_id));

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid #F0F1EC", paddingTop: 12 }}>
      <FieldLabel>Coloris</FieldLabel>

      {matiere.couleurs.length === 0 && (
        <p style={{ fontSize: 12.5, color: "var(--v2-text-3)", margin: "4px 0 8px" }}>
          Aucune correspondance de coloris pour cette matière.
        </p>
      )}

      {matiere.couleurs.map((c) => (
        <LigneCorrespondance
          key={c.id}
          ligne={c}
          colorisMatiere={colorisMatiere}
          lectureSeule={lectureSeule}
          matiereCatalogueId={matiere.matiere_catalogue_id}
          onChangerColoris={(v) => handleChangerColoris(c, v)}
          onCreerColoris={(payload) => handleCreerColorisPourLigne(c, payload)}
          onSupprimer={() => handleSupprimer(c)}
        />
      ))}

      {!lectureSeule && !ajout && (
        <button className="btn ghost tiny" onClick={() => setAjout(true)} style={{ marginTop: 6 }}>
          <Icon name="plus" size={13} /> Ajouter un coloris
        </button>
      )}

      {!lectureSeule && ajout && (
        <div style={{ marginTop: 8, padding: 10, border: "1px solid #E7E9E0", borderRadius: 8, background: "#FAFBF7" }}>
          {/* UNE seule ligne de travail : couleur produit -> coloris matiere, meme forme que les
              lignes deja enregistrees au-dessus. Les creations passent par un popover flottant et
              n'ajoutent jamais de seconde ligne sous celle-ci. */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
              <select
                value={couleurProduitId}
                onChange={(e) => setCouleurProduitId(e.target.value)}
                style={{ border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", minWidth: 150 }}
              >
                <option value="">Couleur produit…</option>
                {couleursProduit.map((c) => (
                  <option key={c.id} value={c.id} disabled={dejaUtilisees.has(c.id)}>
                    {c.nom}{dejaUtilisees.has(c.id) ? " \u2713" : ""}
                  </option>
                ))}
              </select>
              <button
                className="btn ghost tiny" title="Créer une couleur produit"
                onClick={() => { setNouveauColoris(null); setNouvelleCouleur(""); }}
              >
                +
              </button>
              {nouvelleCouleur !== null && (
                <Popover titre="Nouvelle couleur produit" onFermer={() => setNouvelleCouleur(null)}>
                  <FieldLabel>Nom de la nouvelle couleur</FieldLabel>
                  <input
                    type="text" value={nouvelleCouleur} autoFocus
                    onChange={(e) => setNouvelleCouleur(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleCreerCouleurProduit();
                      if (e.key === "Escape") setNouvelleCouleur(null);
                    }}
                    style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
                  />
                  <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn ghost tiny" onClick={() => setNouvelleCouleur(null)}>Annuler</button>
                    <button className="btn tiny" onClick={handleCreerCouleurProduit}>Créer</button>
                  </div>
                </Popover>
              )}
            </div>

            <span style={{ color: "var(--v2-text-3)" }}>→</span>

            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
              <select
                value={matiereCouleurId}
                onChange={(e) => setMatiereCouleurId(e.target.value)}
                style={{ border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", minWidth: 170 }}
              >
                <option value="">Sélectionner un coloris matière</option>
                {colorisMatiere.map((cm) => <option key={cm.id} value={cm.id}>{cm.libelle}</option>)}
              </select>
              <button
                className="btn ghost tiny" title="Créer un coloris matière"
                onClick={() => { setNouvelleCouleur(null); setNouveauColoris({ libelle: "", code: "", reference: "" }); }}
              >
                +
              </button>
              {nouveauColoris && (
                <Popover titre="Nouveau coloris matière" onFermer={() => setNouveauColoris(null)} large>
                  <FieldLabel>Libellé (ex. Noir 001)</FieldLabel>
                  <input
                    type="text" value={nouveauColoris.libelle} autoFocus
                    onChange={(e) => setNouveauColoris({ ...nouveauColoris, libelle: e.target.value })}
                    onKeyDown={(e) => { if (e.key === "Escape") setNouveauColoris(null); }}
                    style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
                  />
                  <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                    <div style={{ flex: 1 }}>
                      <FieldLabel>Code (ex. N01)</FieldLabel>
                      <input
                        type="text" value={nouveauColoris.code}
                        onChange={(e) => setNouveauColoris({ ...nouveauColoris, code: e.target.value })}
                        style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
                      />
                    </div>
                    <div style={{ flex: 2 }}>
                      <FieldLabel>Référence (ex. MOL-320-N01)</FieldLabel>
                      <input
                        type="text" value={nouveauColoris.reference}
                        onChange={(e) => setNouveauColoris({ ...nouveauColoris, reference: e.target.value })}
                        style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn ghost tiny" onClick={() => setNouveauColoris(null)}>Annuler</button>
                    <button className="btn tiny" onClick={handleCreerColoris}>Créer</button>
                  </div>
                </Popover>
              )}
            </div>

            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <button
                className="btn ghost tiny"
                onClick={() => { setAjout(false); setNouveauColoris(null); setNouvelleCouleur(null); setCouleurProduitId(""); setMatiereCouleurId(""); }}
              >
                Annuler
              </button>
              <button className="btn tiny" onClick={handleAjouter}>Ajouter</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Une correspondance ENREGISTRÉE : couleur produit → coloris matière → référence.
 *  Chaque ligne reste pleinement modifiable tant que la fiche l'est : on peut choisir un coloris,
 *  en changer, revenir à « non défini », ou en créer un à la volée si le catalogue de la matière
 *  est encore vide — ce dernier cas étant précisément celui où la ligne était bloquée. */
function LigneCorrespondance({ ligne, colorisMatiere, lectureSeule, matiereCatalogueId, onChangerColoris, onCreerColoris, onSupprimer }: {
  ligne: FTMatiereCouleur;
  colorisMatiere: MatiereCouleur[];
  lectureSeule: boolean;
  matiereCatalogueId: number | null;
  onChangerColoris: (value: string) => void;
  onCreerColoris: (payload: { libelle: string; code: string; reference: string }) => Promise<boolean>;
  onSupprimer: () => void;
}) {
  const [nouveau, setNouveau] = useState<{ libelle: string; code: string; reference: string } | null>(null);

  // La référence affichée est celle du coloris RÉELLEMENT sélectionné, relue dans la liste plutôt
  // que dans la ligne : elle suit donc le select immédiatement, sans attendre le rechargement.
  const selectionne = ligne.matiere_couleur_id != null
    ? colorisMatiere.find((cm) => cm.id === ligne.matiere_couleur_id)
    : null;
  const reference = selectionne ? selectionne.reference : ligne.matiere_couleur_reference;

  async function creer() {
    if (!nouveau || !nouveau.libelle.trim()) return;
    if (await onCreerColoris(nouveau)) setNouveau(null);
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", fontSize: 12.5 }}>
      <span style={{ minWidth: 110, fontWeight: 600 }}>{ligne.couleur_produit_nom}</span>
      <span style={{ color: "var(--v2-text-3)" }}>→</span>

      <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
        <select
          value={ligne.matiere_couleur_id != null ? String(ligne.matiere_couleur_id) : ""}
          disabled={lectureSeule}
          onChange={(e) => onChangerColoris(e.target.value)}
          style={{ border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "4px 6px", fontSize: 12.5, background: "#fff", minWidth: 170 }}
        >
          <option value="">Sélectionner un coloris matière</option>
          {colorisMatiere.map((cm) => (
            <option key={cm.id} value={cm.id}>{cm.libelle}</option>
          ))}
        </select>

        {!lectureSeule && matiereCatalogueId != null && (
          <button
            className="btn ghost tiny" title="Créer un coloris matière"
            onClick={() => setNouveau({ libelle: "", code: "", reference: "" })}
          >
            +
          </button>
        )}

        {nouveau && (
          <Popover titre="Nouveau coloris matière" onFermer={() => setNouveau(null)} large>
            <FieldLabel>Libellé (ex. Noir 001)</FieldLabel>
            <input
              type="text" value={nouveau.libelle} autoFocus
              onChange={(e) => setNouveau({ ...nouveau, libelle: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter") creer(); if (e.key === "Escape") setNouveau(null); }}
              style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <div style={{ flex: 1 }}>
                <FieldLabel>Code (ex. N01)</FieldLabel>
                <input
                  type="text" value={nouveau.code}
                  onChange={(e) => setNouveau({ ...nouveau, code: e.target.value })}
                  style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
                />
              </div>
              <div style={{ flex: 2 }}>
                <FieldLabel>Référence (ex. MOL-320-N01)</FieldLabel>
                <input
                  type="text" value={nouveau.reference}
                  onChange={(e) => setNouveau({ ...nouveau, reference: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") creer(); }}
                  style={{ width: "100%", border: "1px solid var(--ft-border, #C9CAC0)", borderRadius: 6, padding: "5px 7px", fontSize: 12.5 }}
                />
              </div>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "flex-end" }}>
              <button className="btn ghost tiny" onClick={() => setNouveau(null)}>Annuler</button>
              <button className="btn tiny" onClick={creer}>Créer et sélectionner</button>
            </div>
          </Popover>
        )}
      </div>

      <span style={{ color: "var(--v2-text-3)", fontFamily: "var(--v2-font-mono, monospace)", fontSize: 12 }}>
        {reference || "—"}
      </span>

      {!lectureSeule && (
        <button className="btn ghost tiny" onClick={onSupprimer} style={{ marginLeft: "auto" }}>✕</button>
      )}
    </div>
  );
}



