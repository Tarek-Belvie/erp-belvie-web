import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import { FicheTechnique } from "../../shared/types";
import { construireExtensions } from "./descriptionEditeur";
import { nettoyerCollage, texteBrutEnParagraphes } from "./descriptionCollage";
import {
  CSS_RENDU_DESCRIPTION,
  CSS_ZONE_EDITION,
  POLICES,
  TAILLES,
  COULEURS_TEXTE,
  COULEURS_SURLIGNAGE,
  COULEURS_CELLULE,
} from "./descriptionRendu";

// Description technique de l'article.
//
// Ce fichier ne contient que l'interface. Ce que l'éditeur sait représenter est décrit dans
// descriptionEditeur.ts, son apparence dans descriptionRendu.ts, et ce qui est réellement
// enregistré est filtré côté processus principal. Trois fichiers, trois responsabilités : on peut
// ajouter un bouton sans toucher au modèle, et resserrer le modèle sans toucher aux boutons.
//
// L'enregistrement est automatique, sur le modèle déjà en place dans le tableau des mesures :
// une frappe, une pause, une écriture, et un état visible en permanence. Aucune action
// « Enregistrer » à ne pas oublier.

interface Props {
  fiche: FicheTechnique;
  lectureSeule: boolean;
  onChanged: () => void;
}

const api: any = (window as any).api;

type EtatSauvegarde = "repos" | "en_cours" | "enregistre" | "erreur";
type MenuOuvert = null | "couleur" | "surlignage" | "tableau" | "cellule";

const BORDURE = "#D8D9D0";

function BoutonOutil({ actif, onClick, titre, children, disabled, large }: {
  actif?: boolean; onClick: () => void; titre: string; children: React.ReactNode;
  disabled?: boolean; large?: boolean;
}) {
  return (
    <button
      type="button"
      title={titre}
      aria-label={titre}
      aria-pressed={!!actif}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()} // garde la sélection dans l'éditeur
      onClick={onClick}
      style={{
        minWidth: large ? undefined : 30, height: 28, padding: large ? "0 9px" : "0 6px", fontSize: 12.5,
        border: "1px solid " + (actif ? "#0E9F6E" : BORDURE),
        background: actif ? "#ECFDF5" : "#fff",
        color: actif ? "#047857" : "#3A3A33",
        fontWeight: actif ? 700 : 500,
        borderRadius: 5, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.4 : 1,
        display: "inline-flex", alignItems: "center", justifyContent: "center", lineHeight: 1,
      }}
    >
      {children}
    </button>
  );
}

function Separateur() {
  return <span style={{ width: 1, background: "#E3E4DC", margin: "2px 3px", alignSelf: "stretch" }} />;
}

// Les alignements sont dessinés plutôt que représentés par un caractère : aucun glyphe Unicode
// n'est reconnaissable au premier coup d'œil pour « justifier » ou « centrer », alors que quatre
// traits le sont immédiatement. Quatorze lignes de SVG évitent d'ajouter une police d'icônes.
function IconeAlignement({ variante }: { variante: "left" | "center" | "right" | "justify" }) {
  const largeurs: Record<string, number[]> = {
    left: [12, 8, 12, 7],
    center: [12, 8, 12, 8],
    right: [12, 8, 12, 7],
    justify: [12, 12, 12, 12],
  };
  const l = largeurs[variante];
  return (
    <svg width="13" height="11" viewBox="0 0 13 11" aria-hidden="true">
      {l.map((largeur, i) => {
        const x = variante === "right" ? 12 - largeur : variante === "center" ? (12 - largeur) / 2 : 0;
        return <rect key={i} x={x} y={i * 3} width={largeur} height="1.4" rx="0.7" fill="currentColor" />;
      })}
    </svg>
  );
}

const STYLE_SELECT: React.CSSProperties = {
  height: 28, border: "1px solid " + BORDURE, borderRadius: 5, background: "#fff",
  fontSize: 12.5, color: "#3A3A33", padding: "0 4px", cursor: "pointer",
};

// Les menus déroulants se ferment au premier clic en dehors : un voile invisible placé sous le
// menu capte ce clic. Plus simple et plus fiable qu'un écouteur global sur le document, qui
// entrerait en concurrence avec la sélection dans l'éditeur.
function Voile({ onClose }: { onClose: () => void }) {
  return <div onMouseDown={onClose} style={{ position: "fixed", inset: 0, zIndex: 40 }} />;
}

function Pastilles({ couleurs, onChoix, titreVide }: {
  couleurs: { libelle: string; valeur: string }[];
  onChoix: (valeur: string) => void;
  titreVide: string;
}) {
  return (
    <div style={{
      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41,
      background: "#fff", border: "1px solid " + BORDURE, borderRadius: 7,
      boxShadow: "0 8px 22px rgba(0,0,0,.12)", padding: 8, width: 182,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 5 }}>
        {couleurs.filter((c) => c.valeur).map((c) => (
          <button
            key={c.valeur}
            type="button"
            title={c.libelle}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChoix(c.valeur)}
            style={{
              width: 30, height: 24, borderRadius: 4, cursor: "pointer",
              border: "1px solid rgba(0,0,0,.18)", background: c.valeur,
            }}
          />
        ))}
      </div>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => onChoix("")}
        style={{
          marginTop: 7, width: "100%", height: 25, fontSize: 11.5, cursor: "pointer",
          border: "1px solid " + BORDURE, borderRadius: 5, background: "#FBFBF8", color: "#3A3A33",
        }}
      >
        {titreVide}
      </button>
    </div>
  );
}

// Sélecteur visuel de dimensions : on survole la grille, on lit « 4 × 6 », on clique. Les deux
// champs en dessous couvrent les tableaux plus grands que la grille.
function MenuTableau({ onInserer }: { onInserer: (colonnes: number, lignes: number) => void }) {
  const [survol, setSurvol] = useState<{ c: number; l: number } | null>(null);
  const [colonnes, setColonnes] = useState(3);
  const [lignes, setLignes] = useState(3);
  const MAX_C = 8;
  const MAX_L = 8;

  return (
    <div style={{
      position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 41,
      background: "#fff", border: "1px solid " + BORDURE, borderRadius: 7,
      boxShadow: "0 8px 22px rgba(0,0,0,.12)", padding: 10, width: 218,
    }}>
      <div
        onMouseLeave={() => setSurvol(null)}
        style={{ display: "grid", gridTemplateColumns: `repeat(${MAX_C}, 1fr)`, gap: 2 }}
      >
        {Array.from({ length: MAX_L }).map((_, li) =>
          Array.from({ length: MAX_C }).map((__, ci) => {
            const actif = !!survol && ci < survol.c && li < survol.l;
            return (
              <div
                key={`${li}-${ci}`}
                onMouseEnter={() => setSurvol({ c: ci + 1, l: li + 1 })}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onInserer(ci + 1, li + 1)}
                style={{
                  height: 17, borderRadius: 2, cursor: "pointer",
                  border: "1px solid " + (actif ? "#0E9F6E" : "#E3E4DC"),
                  background: actif ? "#D1FAE5" : "#FBFBF8",
                }}
              />
            );
          }),
        )}
      </div>
      <div style={{ fontSize: 11.5, color: "#6B6B62", marginTop: 7, textAlign: "center" }}>
        {survol ? `${survol.c} colonne${survol.c > 1 ? "s" : ""} × ${survol.l} ligne${survol.l > 1 ? "s" : ""}` : "Survolez pour choisir"}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 9, paddingTop: 9, borderTop: "1px solid #EEF0EA" }}>
        <input
          type="number" min={1} max={20} value={colonnes}
          onChange={(e) => setColonnes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
          style={{ width: 46, height: 26, border: "1px solid " + BORDURE, borderRadius: 5, fontSize: 12, padding: "0 5px" }}
        />
        <span style={{ fontSize: 12, color: "#6B6B62" }}>×</span>
        <input
          type="number" min={1} max={60} value={lignes}
          onChange={(e) => setLignes(Math.max(1, Math.min(60, Number(e.target.value) || 1)))}
          style={{ width: 46, height: 26, border: "1px solid " + BORDURE, borderRadius: 5, fontSize: 12, padding: "0 5px" }}
        />
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onInserer(colonnes, lignes)}
          style={{
            flex: 1, height: 26, fontSize: 12, cursor: "pointer", borderRadius: 5,
            border: "1px solid #0E9F6E", background: "#ECFDF5", color: "#047857", fontWeight: 600,
          }}
        >
          Insérer
        </button>
      </div>
    </div>
  );
}

export default function FTDescriptionTab({ fiche, lectureSeule, onChanged }: Props) {
  const [etat, setEtat] = useState<EtatSauvegarde>("repos");
  const [erreur, setErreur] = useState<string | null>(null);
  const [apercu, setApercu] = useState(false);
  const [menu, setMenu] = useState<MenuOuvert>(null);
  const [htmlCourant, setHtmlCourant] = useState<string>(fiche.description_technique ?? "");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dernierEnregistreRef = useRef<string>(fiche.description_technique ?? "");
  const editeurRef = useRef<Editor | null>(null);
  // Horodatage du dernier Ctrl+Maj+V : c'est lui qui distingue un collage « texte brut » du
  // collage ordinaire, l'évènement de collage ne portant pas l'information des touches.
  const collageBrutRef = useRef<number>(0);

  const enregistrer = useCallback(async (html: string) => {
    if (html === dernierEnregistreRef.current) return;
    setEtat("en_cours");
    setErreur(null);
    try {
      await api.ficheTechnique.updateDescriptionTechnique(fiche.id, html);
      dernierEnregistreRef.current = html;
      setEtat("enregistre");
      onChanged();
    } catch (err: any) {
      setEtat("erreur");
      setErreur(err?.message || "Enregistrement impossible.");
    }
  }, [fiche.id, onChanged]);

  const editor = useEditor({
    editable: !lectureSeule,
    content: fiche.description_technique || "",
    extensions: construireExtensions(),
    editorProps: {
      // Tout fragment collé passe d'abord par le nettoyage : c'est là que les listes Word
      // redeviennent des listes, que les points deviennent des pixels et que le fatras `mso-*`
      // disparaît. L'éditeur ne voit que du HTML ordinaire.
      transformPastedHTML: (html: string) => nettoyerCollage(html),
      handleKeyDown: (_vue: any, evenement: KeyboardEvent) => {
        if ((evenement.ctrlKey || evenement.metaKey) && evenement.shiftKey && String(evenement.key || "").toLowerCase() === "v") {
          collageBrutRef.current = Date.now();
        }
        return false;
      },
      handlePaste: (_vue: any, evenement: ClipboardEvent) => {
        if (Date.now() - collageBrutRef.current > 1500) return false;
        collageBrutRef.current = 0;
        const texte = evenement.clipboardData ? evenement.clipboardData.getData("text/plain") : "";
        if (!texte) return false;
        evenement.preventDefault();
        // Un collage brut reste structuré : chaque ligne devient un paragraphe, sinon un texte
        // de plusieurs alinéas arriverait en un seul pavé.
        const paragraphes = texteBrutEnParagraphes(texte);
        editeurRef.current?.chain().focus().insertContent(paragraphes || "<p></p>").run();
        return true;
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      setHtmlCourant(html);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => enregistrer(html), 800);
    },
  }, [fiche.id]);

  useEffect(() => { editeurRef.current = editor ?? null; }, [editor]);

  // Une fiche validée passe en lecture seule comme le reste de la fiche technique.
  useEffect(() => {
    if (editor) editor.setEditable(!lectureSeule);
  }, [editor, lectureSeule]);

  // Enregistrement de ce qui reste en attente si l'utilisateur quitte l'onglet : sans cela, les
  // 800 dernières millisecondes de frappe seraient perdues sans aucun signal.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (editor && !lectureSeule) {
        const html = editor.getHTML();
        if (html !== dernierEnregistreRef.current) {
          api.ficheTechnique.updateDescriptionTechnique(fiche.id, html).catch(() => {});
        }
      }
    };
  }, [editor, fiche.id, lectureSeule]);

  const estVide = !htmlCourant || htmlCourant === "<p></p>" || htmlCourant.trim() === "";
  const dansTableau = !!editor && editor.isActive("table");

  function agir(action: (chain: any) => any) {
    if (!editor) return;
    action(editor.chain().focus()).run();
    setMenu(null);
  }

  // Couleur, police et taille vivent sur une seule et même marque : il faut donc relire les trois
  // et n'en remplacer qu'une, sans quoi changer la taille effacerait la couleur.
  function majTextStyle(cle: "fontFamily" | "fontSize" | "color", valeur: string | null) {
    if (!editor) return;
    const attributs: Record<string, any> = { ...editor.getAttributes("textStyle") };
    attributs[cle] = valeur || null;
    const chaine = editor.chain().focus();
    if (!attributs.fontFamily && !attributs.fontSize && !attributs.color) chaine.unsetMark("textStyle").run();
    else chaine.setMark("textStyle", attributs).run();
    setMenu(null);
  }

  const attributsTexte: Record<string, any> = editor ? editor.getAttributes("textStyle") : {};
  const policeCourante: string = attributsTexte.fontFamily || "";
  const tailleCourante: string = attributsTexte.fontSize || "";
  const niveauCourant = editor?.isActive("heading", { level: 2 }) ? "2"
    : editor?.isActive("heading", { level: 3 }) ? "3" : "p";

  return (
    <div>
      <style>{CSS_RENDU_DESCRIPTION + CSS_ZONE_EDITION}</style>

      <div className="detail-block">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h4 style={{ margin: 0 }}>Description technique de l'article</h4>
            <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "4px 0 0" }}>
              Caractéristiques, détails de confection, finitions et instructions particulières.
              Les espacements, les retraits, la numérotation et les filets des tableaux sont
              appliqués automatiquement.
            </p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
            <span style={{ fontSize: 11.5, color: etat === "erreur" ? "var(--v2-danger, #9A3412)" : "var(--v2-text-3)" }}>
              {etat === "en_cours" ? "Enregistrement…"
                : etat === "enregistre" ? "Modifications enregistrées"
                : etat === "erreur" ? "Échec de l'enregistrement"
                : lectureSeule ? "Lecture seule" : ""}
            </span>
            <button className="btn ghost tiny" onClick={() => setApercu((v) => !v)}>
              {apercu ? "Revenir à l'édition" : "Aperçu du rendu"}
            </button>
          </div>
        </div>

        {erreur && (
          <p style={{ background: "var(--v2-danger-bg, #FBEAE6)", color: "var(--v2-danger, #9A3412)", padding: "8px 11px", borderRadius: 6, fontSize: 12.5, margin: "10px 0 0" }}>
            {erreur}
          </p>
        )}

        {apercu ? (
          <div style={{ border: "1px solid #E7E9E0", borderRadius: 8, background: "#fff", padding: "16px 18px", marginTop: 12 }}>
            {estVide ? (
              <p style={{ fontSize: 13, color: "var(--v2-text-3)", margin: 0 }}>Aucune description rédigée pour l'instant.</p>
            ) : (
              <div className="ft-rendu" dangerouslySetInnerHTML={{ __html: htmlCourant }} />
            )}
            <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "14px 0 0", paddingTop: 10, borderTop: "1px solid #EEF0EA" }}>
              Rendu identique à celui du PDF : mêmes titres, mêmes listes, mêmes tableaux, mêmes
              espacements. Dans le document imprimé, les tableaux occupent la largeur utile de la
              page A4 en conservant les proportions de colonnes choisies ici.
            </p>
          </div>
        ) : (
          <div className="ft-desc-zone" style={{ marginTop: 12 }}>
            {!lectureSeule && (
              <div style={{
                display: "flex", gap: 4, padding: "7px 9px", border: "1px solid " + BORDURE,
                borderBottom: "none", borderRadius: "8px 8px 0 0", background: "#FBFBF8",
                flexWrap: "wrap", alignItems: "center", position: "relative",
              }}>
                <select
                  title="Police"
                  value={policeCourante}
                  onChange={(e) => majTextStyle("fontFamily", e.target.value)}
                  style={{ ...STYLE_SELECT, width: 118 }}
                >
                  {POLICES.map((p) => <option key={p.libelle} value={p.valeur}>{p.libelle}</option>)}
                  {policeCourante && !POLICES.some((p) => p.valeur === policeCourante) && (
                    <option value={policeCourante}>{policeCourante.replace(/"/g, "").split(",")[0]}</option>
                  )}
                </select>

                <select
                  title="Taille des caractères"
                  value={tailleCourante}
                  onChange={(e) => majTextStyle("fontSize", e.target.value)}
                  style={{ ...STYLE_SELECT, width: 72 }}
                >
                  <option value="">Normale</option>
                  {TAILLES.map((t) => <option key={t} value={`${t}px`}>{t}</option>)}
                  {tailleCourante && !TAILLES.some((t) => `${t}px` === tailleCourante) && (
                    <option value={tailleCourante}>{parseInt(tailleCourante, 10)}</option>
                  )}
                </select>

                <select
                  title="Niveau de titre"
                  value={niveauCourant}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "p") agir((c) => c.setParagraph());
                    else agir((c) => c.setHeading({ level: Number(v) }));
                  }}
                  style={{ ...STYLE_SELECT, width: 104 }}
                >
                  <option value="p">Paragraphe</option>
                  <option value="2">Titre</option>
                  <option value="3">Sous-titre</option>
                </select>

                <Separateur />

                <BoutonOutil titre="Gras (Ctrl+B)" actif={editor?.isActive("bold")} onClick={() => agir((c) => c.toggleBold())}>
                  <strong>G</strong>
                </BoutonOutil>
                <BoutonOutil titre="Italique (Ctrl+I)" actif={editor?.isActive("italic")} onClick={() => agir((c) => c.toggleItalic())}>
                  <em style={{ fontFamily: "Georgia, serif" }}>I</em>
                </BoutonOutil>
                <BoutonOutil titre="Souligné (Ctrl+U)" actif={editor?.isActive("underline")} onClick={() => agir((c) => c.toggleUnderline())}>
                  <span style={{ textDecoration: "underline" }}>S</span>
                </BoutonOutil>

                <div style={{ position: "relative", display: "inline-flex" }}>
                  <BoutonOutil titre="Couleur du texte" actif={menu === "couleur"} onClick={() => setMenu(menu === "couleur" ? null : "couleur")}>
                    <span style={{ borderBottom: "3px solid " + (attributsTexte.color || "#1a1a1a"), lineHeight: 1.1 }}>A</span>
                  </BoutonOutil>
                  {menu === "couleur" && (
                    <>
                      <Voile onClose={() => setMenu(null)} />
                      <Pastilles
                        couleurs={COULEURS_TEXTE}
                        titreVide="Couleur automatique"
                        onChoix={(v) => majTextStyle("color", v)}
                      />
                    </>
                  )}
                </div>

                <div style={{ position: "relative", display: "inline-flex" }}>
                  <BoutonOutil titre="Couleur de surlignage" actif={menu === "surlignage"} onClick={() => setMenu(menu === "surlignage" ? null : "surlignage")}>
                    <span style={{ background: editor?.getAttributes("highlight")?.color || "#fef08a", padding: "0 3px", borderRadius: 2 }}>A</span>
                  </BoutonOutil>
                  {menu === "surlignage" && (
                    <>
                      <Voile onClose={() => setMenu(null)} />
                      <Pastilles
                        couleurs={COULEURS_SURLIGNAGE}
                        titreVide="Retirer le surlignage"
                        onChoix={(v) => v ? agir((c) => c.setHighlight({ color: v })) : agir((c) => c.unsetHighlight())}
                      />
                    </>
                  )}
                </div>

                <Separateur />

                <BoutonOutil titre="Aligner à gauche" actif={editor?.isActive({ textAlign: "left" })} onClick={() => agir((c) => c.setTextAlign("left"))}>
                  <IconeAlignement variante="left" />
                </BoutonOutil>
                <BoutonOutil titre="Centrer" actif={editor?.isActive({ textAlign: "center" })} onClick={() => agir((c) => c.setTextAlign("center"))}>
                  <IconeAlignement variante="center" />
                </BoutonOutil>
                <BoutonOutil titre="Aligner à droite" actif={editor?.isActive({ textAlign: "right" })} onClick={() => agir((c) => c.setTextAlign("right"))}>
                  <IconeAlignement variante="right" />
                </BoutonOutil>
                <BoutonOutil titre="Justifier" actif={editor?.isActive({ textAlign: "justify" })} onClick={() => agir((c) => c.setTextAlign("justify"))}>
                  <IconeAlignement variante="justify" />
                </BoutonOutil>

                <Separateur />

                <BoutonOutil titre="Liste à puces" actif={editor?.isActive("bulletList")} onClick={() => agir((c) => c.toggleBulletList())} large>• Liste</BoutonOutil>
                <BoutonOutil titre="Liste numérotée" actif={editor?.isActive("orderedList")} onClick={() => agir((c) => c.toggleOrderedList())} large>1. Liste</BoutonOutil>
                <BoutonOutil
                  titre="Augmenter le retrait (Tab)"
                  disabled={!editor?.can().sinkListItem("listItem")}
                  onClick={() => agir((c) => c.sinkListItem("listItem"))}
                >→</BoutonOutil>
                <BoutonOutil
                  titre="Diminuer le retrait (Maj+Tab)"
                  disabled={!editor?.can().liftListItem("listItem")}
                  onClick={() => agir((c) => c.liftListItem("listItem"))}
                >←</BoutonOutil>

                <Separateur />

                <div style={{ position: "relative", display: "inline-flex" }}>
                  <BoutonOutil titre="Insérer un tableau" actif={menu === "tableau"} onClick={() => setMenu(menu === "tableau" ? null : "tableau")} large>
                    ⊞ Tableau
                  </BoutonOutil>
                  {menu === "tableau" && (
                    <>
                      <Voile onClose={() => setMenu(null)} />
                      <MenuTableau
                        onInserer={(colonnes, lignes) =>
                          agir((c) => c.insertTable({ rows: lignes, cols: colonnes, withHeaderRow: true }))
                        }
                      />
                    </>
                  )}
                </div>

                <BoutonOutil
                  titre="Supprimer la mise en forme de la sélection"
                  onClick={() => agir((c) => c.unsetAllMarks().clearNodes())}
                >⌫</BoutonOutil>

                <span style={{ flex: 1 }} />

                <BoutonOutil titre="Annuler (Ctrl+Z)" disabled={!editor?.can().undo()} onClick={() => agir((c) => c.undo())}>↶</BoutonOutil>
                <BoutonOutil titre="Rétablir (Ctrl+Maj+Z)" disabled={!editor?.can().redo()} onClick={() => agir((c) => c.redo())}>↷</BoutonOutil>
              </div>
            )}

            {/* Barre des tableaux : elle n'apparaît que lorsque le curseur est DANS un tableau,
                pour ne pas encombrer la barre principale en permanence. */}
            {!lectureSeule && dansTableau && (
              <div style={{
                display: "flex", gap: 4, padding: "6px 9px", border: "1px solid " + BORDURE,
                borderBottom: "none", background: "#F4F7F2", flexWrap: "wrap", alignItems: "center",
                position: "relative",
              }}>
                <span style={{ fontSize: 11, color: "#4B6B57", fontWeight: 600, marginRight: 4 }}>Tableau</span>

                <BoutonOutil titre="Insérer une ligne au-dessus" onClick={() => agir((c) => c.addRowBefore())} large>↑ Ligne</BoutonOutil>
                <BoutonOutil titre="Insérer une ligne en dessous" onClick={() => agir((c) => c.addRowAfter())} large>↓ Ligne</BoutonOutil>
                <BoutonOutil titre="Supprimer la ligne" onClick={() => agir((c) => c.deleteRow())} large>✕ Ligne</BoutonOutil>

                <Separateur />

                <BoutonOutil titre="Insérer une colonne à gauche" onClick={() => agir((c) => c.addColumnBefore())} large>← Col.</BoutonOutil>
                <BoutonOutil titre="Insérer une colonne à droite" onClick={() => agir((c) => c.addColumnAfter())} large>Col. →</BoutonOutil>
                <BoutonOutil titre="Supprimer la colonne" onClick={() => agir((c) => c.deleteColumn())} large>✕ Col.</BoutonOutil>

                <Separateur />

                <BoutonOutil titre="Fusionner les cellules sélectionnées" onClick={() => agir((c) => c.mergeCells())} large>Fusionner</BoutonOutil>
                <BoutonOutil titre="Séparer une cellule fusionnée" onClick={() => agir((c) => c.splitCell())} large>Séparer</BoutonOutil>
                <BoutonOutil titre="Ligne d'en-tête" actif={editor?.isActive("tableHeader")} onClick={() => agir((c) => c.toggleHeaderRow())} large>En-tête</BoutonOutil>

                <Separateur />

                <BoutonOutil titre="Aligner le contenu en haut" onClick={() => agir((c) => c.setCellAttribute("verticalAlign", "top"))}>⤒</BoutonOutil>
                <BoutonOutil titre="Centrer verticalement" onClick={() => agir((c) => c.setCellAttribute("verticalAlign", "middle"))}>⇳</BoutonOutil>
                <BoutonOutil titre="Aligner le contenu en bas" onClick={() => agir((c) => c.setCellAttribute("verticalAlign", "bottom"))}>⤓</BoutonOutil>

                <div style={{ position: "relative", display: "inline-flex" }}>
                  <BoutonOutil titre="Fond de la cellule" actif={menu === "cellule"} onClick={() => setMenu(menu === "cellule" ? null : "cellule")} large>
                    Fond
                  </BoutonOutil>
                  {menu === "cellule" && (
                    <>
                      <Voile onClose={() => setMenu(null)} />
                      <Pastilles
                        couleurs={COULEURS_CELLULE}
                        titreVide="Aucun fond"
                        onChoix={(v) => agir((c) => c.setCellAttribute("backgroundColor", v || null))}
                      />
                    </>
                  )}
                </div>

                <span style={{ flex: 1 }} />

                <BoutonOutil titre="Supprimer le tableau" onClick={() => agir((c) => c.deleteTable())} large>
                  <span style={{ color: "#9A3412" }}>Supprimer le tableau</span>
                </BoutonOutil>
              </div>
            )}

            <div style={{
              border: "1px solid " + BORDURE,
              borderRadius: lectureSeule ? 8 : "0 0 8px 8px",
              background: lectureSeule ? "#FBFBF8" : "#fff",
            }}>
              <EditorContent editor={editor} className="ft-rendu" />
            </div>

            {!lectureSeule && (
              <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "8px 0 0", lineHeight: 1.6 }}>
                <strong>Collage</strong> : Ctrl+V conserve la mise en forme d'origine (Word, Gmail,
                Google&nbsp;Docs, Excel, pages web), Ctrl+Maj+V colle en texte brut.
                Les tableaux collés restent modifiables ici — déplacez une bordure pour ajuster la
                largeur d'une colonne.<br />
                <strong>Saisie</strong> : Entrée crée un paragraphe, Maj+Entrée un simple retour à
                la ligne. Dans une liste, Tab décale d'un niveau ; dans un tableau, Tab passe à la
                cellule suivante.
              </p>
            )}
          </div>
        )}
      </div>

      {lectureSeule && (
        <p style={{ fontSize: 12.5, color: "var(--v2-text-3)" }}>
          Cette fiche est {fiche.statut === "validee" ? "validée" : "archivée"} : la description n'est plus modifiable.
        </p>
      )}
    </div>
  );
}
