import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FicheTechnique } from "../../shared/types";

// Description technique de l'article.
//
// L'éditeur est volontairement pauvre : gras, liste à puces, liste numérotée, sous-titre. Ni
// police, ni taille, ni couleur, ni alignement. Ce n'est pas un choix d'interface mais un choix
// de modèle : les extensions correspondantes ne sont pas chargées, donc ces mises en forme
// n'existent pas — y compris au clavier (Ctrl+I ne fait rien) et au collage, que TipTap ramène
// systématiquement à son schéma. L'auteur ne peut écrire que du contenu ; la présentation
// appartient à l'application, à l'écran comme dans le PDF.
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

// Styles du contenu rédigé. Les valeurs reprennent celles du PDF (ficheTechniquePdf.js) pour que
// l'écran annonce fidèlement le document imprimé : même hiérarchie, mêmes espacements relatifs.
const STYLES = `
.ft-desc-zone .ProseMirror {
  min-height: 320px; outline: none; font-size: 13.5px; line-height: 1.65; color: var(--v2-text, #1A1A1A);
  padding: 14px 16px;
}
.ft-desc-zone .ProseMirror > *:first-child { margin-top: 0; }
.ft-desc-zone .ProseMirror p { margin: 0 0 9px; }
.ft-desc-zone .ProseMirror h3 {
  font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: #1F3A2E; margin: 18px 0 8px;
}
.ft-desc-zone .ProseMirror ul, .ft-desc-zone .ProseMirror ol { margin: 0 0 9px; padding-left: 22px; }
.ft-desc-zone .ProseMirror li { margin-bottom: 3px; }
.ft-desc-zone .ProseMirror li::marker { color: #6B6B62; }
.ft-desc-zone .ProseMirror strong { font-weight: 700; }
.ft-desc-zone .ProseMirror p.est-vide:first-child::before {
  content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: #A8A89E;
}
.ft-desc-apercu { font-size: 13.5px; line-height: 1.65; color: #1A1A1A; }
.ft-desc-apercu > *:first-child { margin-top: 0; }
.ft-desc-apercu p { margin: 0 0 9px; }
.ft-desc-apercu h3 { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #1F3A2E; margin: 18px 0 8px; }
.ft-desc-apercu ul, .ft-desc-apercu ol { margin: 0 0 9px; padding-left: 22px; }
.ft-desc-apercu li { margin-bottom: 3px; }
.ft-desc-apercu li::marker { color: #6B6B62; }
`;

function BoutonOutil({ actif, onClick, titre, children, disabled }: {
  actif?: boolean; onClick: () => void; titre: string; children: React.ReactNode; disabled?: boolean;
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
        minWidth: 32, height: 30, padding: "0 9px", fontSize: 13,
        border: "1px solid " + (actif ? "#0E9F6E" : "#D8D9D0"),
        background: actif ? "#ECFDF5" : "#fff",
        color: actif ? "#047857" : "#3A3A33",
        fontWeight: actif ? 700 : 500,
        borderRadius: 6, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.45 : 1,
      }}
    >
      {children}
    </button>
  );
}

export default function FTDescriptionTab({ fiche, lectureSeule, onChanged }: Props) {
  const [etat, setEtat] = useState<EtatSauvegarde>("repos");
  const [erreur, setErreur] = useState<string | null>(null);
  const [apercu, setApercu] = useState(false);
  const [htmlCourant, setHtmlCourant] = useState<string>(fiche.description_technique ?? "");

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dernierEnregistreRef = useRef<string>(fiche.description_technique ?? "");

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
    extensions: [
      StarterKit.configure({
        // Un seul niveau de sous-titre : la hiérarchie du document appartient à la fiche
        // technique, pas à l'auteur. Deux niveaux ouvriraient la porte aux plans incohérents
        // d'une fiche à l'autre.
        heading: { levels: [3] },
        // Tout ce qui relève de la décoration est retiré du modèle, pas seulement de la barre.
        italic: false,
        strike: false,
        code: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
    ],
    onUpdate: ({ editor: ed }) => {
      const html = ed.getHTML();
      setHtmlCourant(html);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => enregistrer(html), 800);
    },
  }, [fiche.id]);

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

  const estVide = !htmlCourant || htmlCourant === "<p></p>";

  function basculer(ed: Editor | null, action: (chain: any) => any) {
    if (!ed) return;
    action(ed.chain().focus()).run();
  }

  return (
    <div>
      <style>{STYLES}</style>

      <div className="detail-block">
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <h4 style={{ margin: 0 }}>Description technique de l'article</h4>
            <p style={{ fontSize: 11.5, color: "var(--v2-text-3)", margin: "4px 0 0" }}>
              Caractéristiques, détails de confection, finitions et instructions particulières.
              La mise en page est appliquée automatiquement : concentrez-vous sur le contenu.
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
              <div className="ft-desc-apercu" dangerouslySetInnerHTML={{ __html: htmlCourant }} />
            )}
            <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "14px 0 0", paddingTop: 10, borderTop: "1px solid #EEF0EA" }}>
              Rendu identique à celui du PDF : mêmes titres, mêmes listes, mêmes espacements.
            </p>
          </div>
        ) : (
          <div className="ft-desc-zone" style={{ marginTop: 12 }}>
            {!lectureSeule && (
              <div style={{
                display: "flex", gap: 6, padding: "8px 10px", border: "1px solid #D8D9D0",
                borderBottom: "none", borderRadius: "8px 8px 0 0", background: "#FBFBF8", flexWrap: "wrap",
              }}>
                <BoutonOutil
                  titre="Gras (Ctrl+B)"
                  actif={editor?.isActive("bold")}
                  onClick={() => basculer(editor, (c) => c.toggleBold())}
                >
                  <strong>G</strong>
                </BoutonOutil>
                <BoutonOutil
                  titre="Sous-titre"
                  actif={editor?.isActive("heading", { level: 3 })}
                  onClick={() => basculer(editor, (c) => c.toggleHeading({ level: 3 }))}
                >
                  Sous-titre
                </BoutonOutil>
                <span style={{ width: 1, background: "#E3E4DC", margin: "2px 4px" }} />
                <BoutonOutil
                  titre="Liste à puces"
                  actif={editor?.isActive("bulletList")}
                  onClick={() => basculer(editor, (c) => c.toggleBulletList())}
                >
                  • Liste
                </BoutonOutil>
                <BoutonOutil
                  titre="Liste numérotée"
                  actif={editor?.isActive("orderedList")}
                  onClick={() => basculer(editor, (c) => c.toggleOrderedList())}
                >
                  1. Liste
                </BoutonOutil>
                <span style={{ width: 1, background: "#E3E4DC", margin: "2px 4px" }} />
                <BoutonOutil
                  titre="Décaler vers la droite (Tab)"
                  disabled={!editor?.can().sinkListItem("listItem")}
                  onClick={() => basculer(editor, (c) => c.sinkListItem("listItem"))}
                >
                  →
                </BoutonOutil>
                <BoutonOutil
                  titre="Décaler vers la gauche (Maj+Tab)"
                  disabled={!editor?.can().liftListItem("listItem")}
                  onClick={() => basculer(editor, (c) => c.liftListItem("listItem"))}
                >
                  ←
                </BoutonOutil>
                <span style={{ flex: 1 }} />
                <BoutonOutil
                  titre="Annuler (Ctrl+Z)"
                  disabled={!editor?.can().undo()}
                  onClick={() => basculer(editor, (c) => c.undo())}
                >
                  ↶
                </BoutonOutil>
                <BoutonOutil
                  titre="Rétablir (Ctrl+Maj+Z)"
                  disabled={!editor?.can().redo()}
                  onClick={() => basculer(editor, (c) => c.redo())}
                >
                  ↷
                </BoutonOutil>
              </div>
            )}

            <div style={{
              border: "1px solid #D8D9D0",
              borderRadius: lectureSeule ? 8 : "0 0 8px 8px",
              background: lectureSeule ? "#FBFBF8" : "#fff",
            }}>
              <EditorContent editor={editor} />
            </div>

            {!lectureSeule && (
              <p style={{ fontSize: 11, color: "var(--v2-text-3)", margin: "8px 0 0" }}>
                Entrée crée un paragraphe, Maj+Entrée un simple retour à la ligne. Dans une liste,
                Tab décale d'un niveau. Le texte collé depuis un autre document est automatiquement
                ramené à la mise en forme de la fiche.
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
