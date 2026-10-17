// Rendu de la description technique à l'écran.
//
// Un seul fichier décrit l'apparence du texte rédigé, et il est utilisé par les TROIS endroits
// qui l'affichent : la zone d'édition, l'aperçu du rendu dans l'onglet Description, et l'onglet
// Aperçu de la fiche. C'est la seule façon de garantir que ce que l'on voit en écrivant est ce
// que l'on obtient à l'impression.
//
// Les valeurs reprennent celles du générateur PDF (electron/ipc/ficheTechniquePdf.js, bloc
// « Description technique »), transposées des millimètres vers les pixels. Toute modification
// ici doit être reportée là-bas, et réciproquement.
//
// Ce module ne dépend de rien : ni React, ni TipTap. Il peut donc être importé partout sans
// alourdir quoi que ce soit.

/** Polices proposées dans la barre d'outils. Toutes présentes sur Windows, donc fidèles au PDF. */
export const POLICES: { libelle: string; valeur: string }[] = [
  { libelle: "Sans Serif", valeur: "" },
  { libelle: "Arial", valeur: "Arial, sans-serif" },
  { libelle: "Calibri", valeur: "Calibri, sans-serif" },
  { libelle: "Verdana", valeur: "Verdana, sans-serif" },
  { libelle: "Tahoma", valeur: "Tahoma, sans-serif" },
  { libelle: "Times New Roman", valeur: '"Times New Roman", serif' },
  { libelle: "Georgia", valeur: "Georgia, serif" },
  { libelle: "Cambria", valeur: "Cambria, serif" },
  { libelle: "Courier New", valeur: '"Courier New", monospace' },
];

/** Tailles proposées, en pixels — seule unité stockée en base. */
export const TAILLES: number[] = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

/** Couleurs de texte. Palette fermée : un document atelier ne gagne rien à 16 millions de teintes. */
export const COULEURS_TEXTE: { libelle: string; valeur: string }[] = [
  { libelle: "Automatique", valeur: "" },
  { libelle: "Noir", valeur: "#1a1a1a" },
  { libelle: "Gris", valeur: "#6b6b62" },
  { libelle: "Vert atelier", valeur: "#1f3a2e" },
  { libelle: "Vert", valeur: "#0e7a4e" },
  { libelle: "Bleu", valeur: "#1d4ed8" },
  { libelle: "Rouge", valeur: "#b91c1c" },
  { libelle: "Orange", valeur: "#b45309" },
  { libelle: "Violet", valeur: "#6d28d9" },
  { libelle: "Bordeaux", valeur: "#7c2d12" },
];

/** Couleurs de surlignage, volontairement claires pour rester lisibles en impression noir et blanc. */
export const COULEURS_SURLIGNAGE: { libelle: string; valeur: string }[] = [
  { libelle: "Aucun", valeur: "" },
  { libelle: "Jaune", valeur: "#fef08a" },
  { libelle: "Vert", valeur: "#d9f99d" },
  { libelle: "Bleu", valeur: "#bfdbfe" },
  { libelle: "Rose", valeur: "#fbcfe8" },
  { libelle: "Orange", valeur: "#fed7aa" },
  { libelle: "Gris", valeur: "#e5e7eb" },
];

/** Couleurs de fond de cellule proposées dans la barre des tableaux. */
export const COULEURS_CELLULE: { libelle: string; valeur: string }[] = [
  { libelle: "Aucun", valeur: "" },
  { libelle: "Gris clair", valeur: "#f2f3ee" },
  { libelle: "Vert clair", valeur: "#e8f5ee" },
  { libelle: "Bleu clair", valeur: "#e8f0fb" },
  { libelle: "Jaune clair", valeur: "#fdf6e3" },
  { libelle: "Rouge clair", valeur: "#fbeae6" },
];

// ---------------------------------------------------------------------------------------------
// Feuille de style commune
// ---------------------------------------------------------------------------------------------
// Toutes les règles sont préfixées par `.ft-rendu`, classe posée sur les trois conteneurs. Les
// sélecteurs atteignent donc aussi bien le contenu de l'éditeur que celui des aperçus, sans
// duplication.
export const CSS_RENDU_DESCRIPTION = `
.ft-rendu { font-size: 13.5px; line-height: 1.65; color: #1A1A1A; }
.ft-rendu > *:first-child, .ft-rendu .ProseMirror > *:first-child { margin-top: 0; }
.ft-rendu p { margin: 0 0 9px; }
.ft-rendu h2 {
  font-size: 15.5px; font-weight: 700; color: #1A1A1A; margin: 20px 0 8px;
  padding-bottom: 4px; border-bottom: 1px solid #DADCD3;
}
.ft-rendu h3 {
  font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
  color: #1F3A2E; margin: 18px 0 8px;
}
.ft-rendu ul, .ft-rendu ol { margin: 0 0 9px; padding-left: 22px; }
.ft-rendu li { margin-bottom: 3px; }
.ft-rendu li > p { margin: 0; }
.ft-rendu li::marker { color: #6B6B62; }
.ft-rendu ul ul, .ft-rendu ol ol, .ft-rendu ul ol, .ft-rendu ol ul { margin: 3px 0 0; }
.ft-rendu strong { font-weight: 700; }
.ft-rendu em { font-style: italic; }
.ft-rendu u { text-decoration: underline; }
.ft-rendu s { text-decoration: line-through; }
.ft-rendu mark { background: #fef08a; color: inherit; padding: 0 1px; border-radius: 2px; }

/* Tableaux : mêmes filets, mêmes proportions et même en-tête que dans le PDF.
   Le <colgroup> en pourcentages est posé à l'enregistrement par le filtre du processus principal
   (electron/ipc/descriptionTechnique.js) ; pendant la frappe, c'est l'éditeur qui gère lui-même
   les largeurs. Dans les deux cas, table-layout:fixed empêche tout débordement. */
.ft-rendu table {
  width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed;
  margin: 0 0 10px; font-size: 12.5px; overflow: hidden;
}
.ft-rendu table th, .ft-rendu table td {
  border: 1px solid #C9CCC2; padding: 5px 7px; vertical-align: top; text-align: left;
  position: relative; word-wrap: break-word; overflow-wrap: break-word; line-height: 1.45;
  min-width: 1em;
}
.ft-rendu table th { background: #F2F3EE; font-weight: 700; }
.ft-rendu table p { margin: 0 0 3px; }
.ft-rendu table p:last-child { margin-bottom: 0; }
.ft-rendu table ul, .ft-rendu table ol { margin: 0 0 3px; padding-left: 16px; }
`;

// Règles propres à la zone d'édition : hauteur utile, absence de contour, et les repères visuels
// de prosemirror-tables (cellule sélectionnée, poignée de redimensionnement de colonne).
export const CSS_ZONE_EDITION = `
.ft-desc-zone .ProseMirror { min-height: 340px; outline: none; padding: 14px 16px; }
.ft-desc-zone .ProseMirror:focus { outline: none; }
.ft-desc-zone .ProseMirror p.est-vide:first-child::before {
  content: attr(data-placeholder); float: left; height: 0; pointer-events: none; color: #A8A89E;
}
.ft-desc-zone .ProseMirror .selectedCell::after {
  content: ""; position: absolute; inset: 0; background: rgba(14,159,110,.14); pointer-events: none;
}
.ft-desc-zone .ProseMirror .column-resize-handle {
  position: absolute; right: -2px; top: 0; bottom: 0; width: 4px; background: #0E9F6E;
  cursor: col-resize; z-index: 20; pointer-events: none;
}
.ft-desc-zone .ProseMirror.resize-cursor { cursor: col-resize; }
.ft-desc-zone .ProseMirror table { margin-bottom: 12px; }
`;
