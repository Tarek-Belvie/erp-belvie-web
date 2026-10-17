import { useEffect, useState } from "react";
import { AccessoireCatalogue, Article, FicheTechnique, FTFourniture, FTFournitureCouleur, FTFournitureFamille } from "../../shared/types";
import Icon from "../../shared/Icon";
import { mediaUrl } from "../commandes/uiHelpers";
import { FieldLabel, FTField, Popover, SectionTitle, ftInputStyle, FT_BORDER_COLOR, FT_TEXT_SECONDARY } from "./FTChamps";

interface Props {
  fiche: FicheTechnique;
  article: Article;
  lectureSeule: boolean;
  onChanged: () => void;
}

/** Suggestions d'unités : une simple aide à la saisie. `unite` reste du texte libre en base
 *  (aucun CHECK), contrairement aux matières — une fourniture peut se compter en paire, en jeu,
 *  en bobine. Le datalist propose, il n'impose jamais. */
const UNITES_SUGGEREES = ["pièce", "m", "cm", "paire", "jeu", "bobine", "lot", "kg"];

const FAMILLES: { id: FTFournitureFamille; titre: string; sous: string; placeholder: string }[] = [
  {
    id: "habillage",
    titre: "Habillage & Branding",
    sous: "Étiquettes, hang tags et éléments de marque",
    placeholder: "Tapez pour rechercher (ex : étiq, hang...) ou créer",
  },
  {
    id: "composant",
    titre: "Composants de confection",
    sous: "Zips, boutons, élastiques, cordons et autres fournitures de montage",
    placeholder: "Tapez pour rechercher (ex : zip, élas...) ou créer",
  },
];

export default function FTFournituresTab({ fiche, lectureSeule, onChanged }: Props) {
  const fournitures = fiche.accessoires ?? [];
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  function notifyErr(msg: string) {
    setError(msg);
    setTimeout(() => setError(null), 4000);
  }

  async function handleUpdate(id: number, patch: Partial<FTFourniture>) {
    try {
      await window.api.ficheTechnique.updateAccessoire(id, patch);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Modification impossible.");
    }
  }

  async function handleDelete(id: number) {
    try {
      await window.api.ficheTechnique.deleteAccessoire(id);
      if (expandedId === id) setExpandedId(null);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Suppression impossible.");
    }
  }

  async function handlePhoto(id: number) {
    // Mécanisme de photo EXISTANT, réutilisé tel quel : pickAccessoirePhoto puis
    // setAccessoirePhoto, qui recopie le fichier dans le store et supprime l'ancienne image.
    const result = await window.api.ficheTechnique.pickAccessoirePhoto();
    if (result.canceled) return;
    if (!("filePath" in result)) { notifyErr((result as { error: string }).error); return; }
    try {
      await window.api.ficheTechnique.setAccessoirePhoto(id, result.filePath);
      onChanged();
    } catch (err: any) {
      notifyErr(err?.message || "Photo impossible à enregistrer.");
    }
  }

  return (
    <div>
      <datalist id="ft-unites-fournitures">
        {UNITES_SUGGEREES.map((u) => <option key={u} value={u} />)}
      </datalist>

      {error && <p style={{ color: "var(--v2-danger)", fontSize: 12.5, marginBottom: 8 }}>{error}</p>}

      {FAMILLES.map((f) => (
        <SectionFamille
          key={f.id}
          famille={f}
          premiere={f.id === "habillage"}
          ficheId={fiche.id}
          lignes={fournitures.filter((x) => x.famille === f.id)}
          lectureSeule={lectureSeule}
          expandedId={expandedId}
          setExpandedId={setExpandedId}
          onChanged={onChanged}
          onError={notifyErr}
          onUpdate={handleUpdate}
          onDelete={handleDelete}
          onPhoto={handlePhoto}
        />
      ))}
    </div>
  );
}

function SectionFamille({ famille, premiere, ficheId, lignes, lectureSeule, expandedId, setExpandedId, onChanged, onError, onUpdate, onDelete, onPhoto }: {
  famille: { id: FTFournitureFamille; titre: string; sous: string; placeholder: string };
  premiere: boolean;
  ficheId: number;
  lignes: FTFourniture[];
  lectureSeule: boolean;
  expandedId: number | null;
  setExpandedId: (id: number | null) => void;
  onChanged: () => void;
  onError: (m: string) => void;
  onUpdate: (id: number, patch: Partial<FTFourniture>) => void;
  onDelete: (id: number) => void;
  onPhoto: (id: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AccessoireCatalogue[]>([]);

  useEffect(() => {
    // Suggestions filtrées sur CETTE famille : proposer un hang tag dans les composants de
    // confection n'aiderait personne. Le catalogue reste extensible — « + Créer » accepte
    // n'importe quelle désignation.
    window.api.ficheTechnique.searchAccessoiresCatalogue(query, undefined, famille.id).then(setResults);
  }, [query, famille.id]);

  async function handleAdd(nom: string) {
    if (!nom.trim()) return;
    try {
      const created = await window.api.ficheTechnique.addAccessoire(ficheId, {
        nom: nom.trim(),
        famille: famille.id,
      });
      setQuery("");
      setExpandedId(created.id);
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Erreur lors de l'ajout.");
    }
  }

  return (
    // Séparation forte entre les deux familles : espace vertical généreux + filet horizontal
    // discret sur la seconde section. Assez pour segmenter la lecture, sans alourdir le design.
    <div style={{
      marginTop: premiere ? 0 : 34,
      paddingTop: premiere ? 0 : 24,
      borderTop: premiere ? "none" : "1px solid #E3E5DC",
    }}>
      <SectionTitle titre={famille.titre} sous={famille.sous} />

      {!lectureSeule && (
        <div style={{ position: "relative", marginBottom: 8, maxWidth: 460 }}>
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={famille.placeholder}
            style={{ ...ftInputStyle, padding: "8px 10px", fontSize: 13.5 }}
            onKeyDown={(e) => { if (e.key === "Enter" && query.trim()) handleAdd(query.trim()); }}
          />
          {query.trim() && (
            <div style={{ position: "absolute", zIndex: 20, width: "100%", border: `1px solid ${FT_BORDER_COLOR}`, borderRadius: 8, marginTop: 4, background: "#fff", boxShadow: "0 2px 8px rgba(0,0,0,.08)" }}>
              {results.map((r) => (
                <div key={r.id} onClick={() => handleAdd(r.nom)} style={{ padding: "8px 11px", fontSize: 13, cursor: "pointer", borderBottom: "1px solid #F0F1EC" }}>
                  {r.nom}
                </div>
              ))}
              <div onClick={() => handleAdd(query.trim())} style={{ padding: "8px 11px", fontSize: 12.5, cursor: "pointer", color: "#0E9F6E" }}>
                + Créer « {query.trim()} »
              </div>
            </div>
          )}
        </div>
      )}

      {!lectureSeule && !query.trim() && (
        <SuggestionsRapides
          items={results}
          dejaPresents={new Set(lignes.map((l) => (l.nom || "").toLowerCase()))}
          onAjouter={handleAdd}
        />
      )}

      {lignes.length === 0 ? (
        <p style={{ fontSize: 13, color: FT_TEXT_SECONDARY }}>Aucun élément pour l'instant.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lignes.map((l) => (
            <FournitureCard
              key={l.id}
              fourniture={l}
              famille={famille.id}
              expanded={expandedId === l.id}
              lectureSeule={lectureSeule}
              onToggle={() => setExpandedId(expandedId === l.id ? null : l.id)}
              onUpdate={(patch) => onUpdate(l.id, patch)}
              onDelete={() => onDelete(l.id)}
              onPhoto={() => onPhoto(l.id)}
              onChanged={onChanged}
              onError={onError}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Désignations préremplies du catalogue, proposées en un clic. Ce sont de simples raccourcis
 *  d'ajout : rien n'est figé, et « + Ajouter une ligne » (le champ de recherche ci-dessus)
 *  accepte n'importe quelle désignation. */
function SuggestionsRapides({ items, dejaPresents, onAjouter }: {
  items: AccessoireCatalogue[]; dejaPresents: Set<string>; onAjouter: (nom: string) => void;
}) {
  const restants = items.filter((i) => !dejaPresents.has(i.nom.toLowerCase())).slice(0, 8);
  if (restants.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
      {restants.map((i) => (
        <button
          key={i.id}
          className="btn ghost tiny"
          onClick={() => onAjouter(i.nom)}
          style={{ fontSize: 12 }}
        >
          + {i.nom}
        </button>
      ))}
    </div>
  );
}

function FournitureCard({ fourniture, famille, expanded, lectureSeule, onToggle, onUpdate, onDelete, onPhoto, onChanged, onError }: {
  fourniture: FTFourniture;
  famille: FTFournitureFamille;
  expanded: boolean;
  lectureSeule: boolean;
  onToggle: () => void;
  onUpdate: (patch: Partial<FTFourniture>) => void;
  onDelete: () => void;
  onPhoto: () => void;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const f = fourniture;
  const nbColoris = (f.couleurs ?? []).length;
  const conso = f.consommation_par_piece != null
    ? `${String(f.consommation_par_piece).replace(".", ",")} ${f.unite || ""}`.trim()
    : null;
  const estHabillage = famille === "habillage";

  return (
    <div
      style={{
        border: `1px solid ${expanded ? "#B9BAB0" : FT_BORDER_COLOR}`,
        borderRadius: 10,
        background: "#fff",
        // Une carte ouverte se détache nettement de ses voisines : ombre légère et bordure
        // un peu plus marquée, sans changer sa hauteur au repos.
        boxShadow: expanded ? "0 2px 10px rgba(0,0,0,.06)" : "none",
      }}
    >
      {/* Ligne fermée : nom, consommation à droite, suppression. Rien d'autre — les détails
          (couleur, dimension, référence) s'affichent à l'ouverture, ils encombraient la lecture. */}
      <div onClick={onToggle} style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", cursor: "pointer" }}>
        <span style={{ fontSize: 10, color: FT_TEXT_SECONDARY, transform: expanded ? "rotate(90deg)" : "none", transition: "transform 120ms" }}>▶</span>
        {f.photo_path && <img src={mediaUrl(f.photo_path)!} alt="" style={{ width: 26, height: 26, borderRadius: 5, objectFit: "cover" }} />}
        <strong style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{f.nom}</strong>
        {/* Une fourniture déclinée par couleur se voit SANS ouvrir la carte : c'est l'information
            qui change le besoin calculé, elle ne doit pas rester cachée d'un cran. */}
        {nbColoris > 0 && (
          <span style={{ fontSize: 11, color: FT_TEXT_SECONDARY, border: `1px solid ${FT_BORDER_COLOR}`, borderRadius: 999, padding: "1px 7px", whiteSpace: "nowrap" }}>
            {nbColoris} coloris
          </span>
        )}
        <span style={{ fontSize: 12.5, color: conso ? "#17181A" : FT_TEXT_SECONDARY, whiteSpace: "nowrap" }}>
          {conso ? `${conso}/pièce` : "—"}
        </span>
        {!lectureSeule && (
          <button className="btn ghost tiny" onClick={(e) => { e.stopPropagation(); onDelete(); }}>✕</button>
        )}
      </div>

      {expanded && (
        // maxWidth : sans borne, les champs s'étirent sur toute la largeur de l'écran alors que
        // les valeurs saisies sont très courtes. Grille de 12 colonnes pour proportionner
        // chaque champ à son contenu réel.
        <div style={{ padding: "0 12px 12px", maxWidth: 900 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 10 }}>
            <div style={{ gridColumn: estHabillage ? "span 5" : "span 4" }}>
              <FTField label="Désignation" value={f.nom} disabled={lectureSeule} onSave={(v) => onUpdate({ nom: v } as any)} />
            </div>

            {/* Habillage & Branding : présentation allégée. Emplacement, couleur et dimension ne
                sont pas pertinents pour une étiquette de composition ou un hang tag. */}
            {!estHabillage && (
              <>
                <div style={{ gridColumn: "span 4" }}>
                  <FTField label="Utilisation / Emplacement" value={f.emplacement} disabled={lectureSeule} onSave={(v) => onUpdate({ emplacement: v } as any)} placeholder="Poche côté..." />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <FTField label="Couleur" value={f.couleur} disabled={lectureSeule} onSave={(v) => onUpdate({ couleur: v } as any)} />
                </div>
                <div style={{ gridColumn: "span 2" }}>
                  <FTField label="Taille / Dim." value={f.taille_dimension} disabled={lectureSeule} onSave={(v) => onUpdate({ taille_dimension: v } as any)} placeholder="18 cm, #5" />
                </div>
              </>
            )}

            <div style={{ gridColumn: estHabillage ? "span 3" : "span 4" }}>
              <FTField label="Référence" value={f.reference} disabled={lectureSeule} onSave={(v) => onUpdate({ reference: v } as any)} placeholder="ZP-18-N" />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <FTField
                label="Conso. / pièce"
                value={f.consommation_par_piece != null ? String(f.consommation_par_piece) : null}
                disabled={lectureSeule}
                onSave={(v) => onUpdate({ consommation_par_piece: v as any })}
                placeholder="1"
              />
            </div>
            <div style={{ gridColumn: "span 2" }}>
              <FTField label="Unité" value={f.unite} disabled={lectureSeule} onSave={(v) => onUpdate({ unite: v } as any)} listId="ft-unites-fournitures" placeholder="pièce" />
            </div>

            <div style={{ gridColumn: "span 12" }}>
              <FTField label="Description / remarques" value={f.description} disabled={lectureSeule} onSave={(v) => onUpdate({ description: v } as any)} multiline />
            </div>
          </div>

          <ColorisFournitureBloc
            fourniture={f}
            lectureSeule={lectureSeule}
            onChanged={onChanged}
            onError={onError}
          />

          {!lectureSeule && (
            <div style={{ marginTop: 10 }}>
              <button className="btn ghost tiny" onClick={onPhoto}>
                <Icon name="photo" size={13} /> {f.photo_path ? "Changer la photo" : "Ajouter une photo"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Coloris d'une fourniture : couleur PRODUIT -> coloris de la fourniture.
 *
 * Pourquoi ce bloc existe. Sans lui, la seule façon de modéliser « pantalon noir = zip noir,
 * pantalon marine = zip marine » était de créer DEUX lignes de fourniture. Chacune consommait
 * alors sur la production entière : 580 pièces produites donnaient 1 160 zips à commander. Ici,
 * UNE ligne porte ses deux coloris, et le besoin se répartit : 450 noirs + 130 marine = 580.
 *
 * Différence avec les matières, assumée : le coloris est du TEXTE LIBRE, pas une entrée de
 * catalogue. Un zip noir n'a pas de nuancier fournisseur à référencer. La couleur produit, elle,
 * vient bien du même référentiel que les quantités de commande (listes_valeurs) — c'est ce qui
 * permet au calcul de rapprocher un coloris d'une quantité réellement lancée.
 */
function ColorisFournitureBloc({ fourniture, lectureSeule, onChanged, onError }: {
  fourniture: FTFourniture;
  lectureSeule: boolean;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const lignes = fourniture.couleurs ?? [];
  const [couleursProduit, setCouleursProduit] = useState<{ id: number; nom: string }[]>([]);
  const [ajout, setAjout] = useState(false);
  const [couleurProduitId, setCouleurProduitId] = useState("");
  const [colorisSaisi, setColorisSaisi] = useState("");
  const [nouvelleCouleur, setNouvelleCouleur] = useState<string | null>(null);

  useEffect(() => {
    window.api.listes.list("couleur").then(setCouleursProduit);
  }, []);

  // Réutilise listes.create("couleur", nom) — le même mécanisme que l'onglet Matières et que le
  // formulaire de commande. C'est listes.js qui détecte les doublons au nom normalisé et qui
  // RÉACTIVE une couleur désactivée du même nom au lieu d'en créer une seconde.
  async function creerCouleurProduit() {
    const nom = (nouvelleCouleur || "").trim();
    if (!nom) { onError("Saisissez le nom de la couleur produit."); return; }
    try {
      const creee = await window.api.listes.create("couleur", nom);
      setCouleursProduit(await window.api.listes.list("couleur"));
      setCouleurProduitId(String(creee.id));
      setNouvelleCouleur(null);
    } catch (err: any) {
      onError(err?.message || "Création de la couleur impossible.");
    }
  }

  async function ajouter() {
    if (!couleurProduitId) { onError("Sélectionnez une couleur produit."); return; }
    try {
      await window.api.ficheTechnique.addFournitureCouleur(fourniture.id, {
        couleur_produit_id: Number(couleurProduitId),
        couleur_fourniture: colorisSaisi.trim() || null,
      });
      setCouleurProduitId("");
      setColorisSaisi("");
      setAjout(false);
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Ajout impossible.");
    }
  }

  // Rend vrai si la base a accepté. Le champ de saisie s'en sert pour revenir à la valeur
  // enregistrée en cas de refus, au lieu de laisser à l'écran un chiffre qui n'existe pas.
  async function modifier(ligne: FTFournitureCouleur, patch: Record<string, unknown>) {
    try {
      await window.api.ficheTechnique.updateFournitureCouleur(ligne.id, patch as any);
      onChanged();
      return true;
    } catch (err: any) {
      onError(err?.message || "Modification impossible.");
      return false;
    }
  }

  async function supprimer(ligne: FTFournitureCouleur) {
    try {
      await window.api.ficheTechnique.deleteFournitureCouleur(ligne.id);
      onChanged();
    } catch (err: any) {
      onError(err?.message || "Suppression impossible.");
    }
  }

  const dejaUtilisees = new Set(lignes.map((l) => l.couleur_produit_id));

  return (
    <div style={{ marginTop: 14, borderTop: "1px solid #F0F1EC", paddingTop: 12 }}>
      <FieldLabel>Coloris par couleur produit</FieldLabel>

      {/* La conséquence sur le calcul est écrite ici, à l'endroit de la décision. Les deux
          messages disent la même règle vue des deux côtés : aucun coloris = toutes couleurs
          confondues ; au moins un coloris = chaque couleur lancée doit être déclarée. */}
      <p style={{ fontSize: 12, color: FT_TEXT_SECONDARY, margin: "2px 0 8px", lineHeight: 1.45, maxWidth: 620 }}>
        {lignes.length === 0
          ? "Aucun coloris déclaré : cette fourniture est commandée toutes couleurs confondues. Déclarez un coloris si elle change selon la couleur du produit."
          : "Chaque couleur produit lancée en production doit être déclarée ici. Si l'une manque, Approvisionnement signale son besoin comme incomplet au lieu de l'estimer."}
      </p>

      {lignes.map((l) => (
        <div key={l.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12.5, flexWrap: "wrap" }}>
          <span style={{ minWidth: 100, fontWeight: 600 }}>{l.couleur_produit_nom}</span>
          <span style={{ color: "var(--v2-text-3)" }}>→</span>
          <ChampInline
            valeur={l.couleur_fourniture}
            disabled={lectureSeule}
            largeur={140}
            placeholder="Coloris à préciser"
            onEnregistrer={(v) => modifier(l, { couleur_fourniture: v || null })}
          />
          <ChampInline
            valeur={l.reference}
            disabled={lectureSeule}
            largeur={120}
            mono
            placeholder="Référence"
            onEnregistrer={(v) => modifier(l, { reference: v || null })}
          />
          <ChampInline
            valeur={l.consommation_par_piece != null ? String(l.consommation_par_piece) : null}
            disabled={lectureSeule}
            largeur={64}
            placeholder="conso."
            onEnregistrer={(v) => modifier(l, { consommation_par_piece: v || null })}
          />
          <span style={{ color: FT_TEXT_SECONDARY, fontSize: 11.5 }}>
            {l.consommation_par_piece != null ? `${fourniture.unite || "pièce"}/pièce` : "conso. de la ligne"}
          </span>
          {!lectureSeule && (
            <button className="btn ghost tiny" onClick={() => supprimer(l)} style={{ marginLeft: "auto" }}>✕</button>
          )}
        </div>
      ))}

      {!lectureSeule && !ajout && (
        <button className="btn ghost tiny" onClick={() => setAjout(true)} style={{ marginTop: 6 }}>
          <Icon name="plus" size={13} /> Ajouter un coloris
        </button>
      )}

      {!lectureSeule && ajout && (
        <div style={{ marginTop: 8, padding: 10, border: "1px solid #E7E9E0", borderRadius: 8, background: "#FAFBF7" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 4 }}>
              <select
                value={couleurProduitId}
                onChange={(e) => setCouleurProduitId(e.target.value)}
                style={{ border: `1px solid ${FT_BORDER_COLOR}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, background: "#fff", minWidth: 150 }}
              >
                <option value="">Couleur produit…</option>
                {couleursProduit.map((c) => (
                  <option key={c.id} value={c.id} disabled={dejaUtilisees.has(c.id)}>
                    {c.nom}{dejaUtilisees.has(c.id) ? " ✓" : ""}
                  </option>
                ))}
              </select>
              <button className="btn ghost tiny" title="Créer une couleur produit" onClick={() => setNouvelleCouleur("")}>+</button>
              {nouvelleCouleur !== null && (
                <Popover titre="Nouvelle couleur produit" onFermer={() => setNouvelleCouleur(null)}>
                  <FieldLabel>Nom de la nouvelle couleur</FieldLabel>
                  <input
                    type="text" value={nouvelleCouleur} autoFocus
                    onChange={(e) => setNouvelleCouleur(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") creerCouleurProduit();
                      if (e.key === "Escape") setNouvelleCouleur(null);
                    }}
                    style={ftInputStyle}
                  />
                  <div style={{ marginTop: 8, display: "flex", gap: 6, justifyContent: "flex-end" }}>
                    <button className="btn ghost tiny" onClick={() => setNouvelleCouleur(null)}>Annuler</button>
                    <button className="btn tiny" onClick={creerCouleurProduit}>Créer</button>
                  </div>
                </Popover>
              )}
            </div>

            <span style={{ color: "var(--v2-text-3)" }}>→</span>

            <input
              type="text"
              value={colorisSaisi}
              onChange={(e) => setColorisSaisi(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") ajouter(); }}
              placeholder="Coloris de la fourniture (ex. Noir)"
              style={{ border: `1px solid ${FT_BORDER_COLOR}`, borderRadius: 6, padding: "5px 7px", fontSize: 12.5, minWidth: 200 }}
            />

            <div style={{ display: "flex", gap: 6, marginLeft: "auto" }}>
              <button
                className="btn ghost tiny"
                onClick={() => { setAjout(false); setCouleurProduitId(""); setColorisSaisi(""); setNouvelleCouleur(null); }}
              >
                Annuler
              </button>
              <button className="btn tiny" onClick={ajouter}>Ajouter</button>
            </div>
          </div>
          <p style={{ fontSize: 11.5, color: FT_TEXT_SECONDARY, margin: "8px 0 0" }}>
            Référence et consommation propres à ce coloris se renseignent ensuite sur la ligne.
          </p>
        </div>
      )}
    </div>
  );
}

/** Champ texte enregistré à la sortie du champ. Garde sa propre copie de la valeur pour pouvoir
 *  REVENIR à celle de la base si l'enregistrement est refusé — sans cela, une consommation
 *  négative refusée resterait affichée comme si elle avait été acceptée. */
function ChampInline({ valeur, disabled, largeur, placeholder, mono, onEnregistrer }: {
  valeur: string | null;
  disabled: boolean;
  largeur: number;
  placeholder?: string;
  mono?: boolean;
  onEnregistrer: (v: string) => Promise<boolean>;
}) {
  const [texte, setTexte] = useState(valeur ?? "");
  useEffect(() => { setTexte(valeur ?? ""); }, [valeur]);

  async function enregistrer() {
    const propre = texte.trim();
    if (propre === (valeur ?? "")) return;
    if (!(await onEnregistrer(propre))) setTexte(valeur ?? "");
  }

  return (
    <input
      type="text"
      value={texte}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setTexte(e.target.value)}
      onBlur={enregistrer}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      style={{
        width: largeur, border: `1px solid ${FT_BORDER_COLOR}`, borderRadius: 6,
        padding: "4px 6px", fontSize: 12.5, background: disabled ? "#F7F7F3" : "#fff",
        fontFamily: mono ? "var(--v2-font-mono, monospace)" : "inherit",
      }}
    />
  );
}
