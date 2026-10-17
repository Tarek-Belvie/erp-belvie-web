// Description technique : modèle de l'éditeur.
//
// `construireExtensions()` décrit ce que l'éditeur sait représenter. Tout ce qui n'est pas listé
// ici n'existe pas — ni au clavier, ni au collage, ni en base. C'est le premier des deux verrous
// de mise en forme, le second étant le filtre d'enregistrement du processus principal
// (electron/ipc/descriptionTechnique.js). Les deux listes doivent rester cohérentes : une balise
// que l'éditeur produit mais que le filtre ignore donnerait une mise en forme qui disparaît à
// l'enregistrement, et l'inverse donnerait du contenu enregistré qu'on ne pourrait plus modifier.
//
// Le nettoyage du collage vit dans descriptionCollage.ts, sans aucune dépendance, et est
// simplement réexporté ici pour que l'interface n'ait qu'un import à faire.

import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextStyle from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import FontFamily from "@tiptap/extension-font-family";
import TextAlign from "@tiptap/extension-text-align";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Extension } from "@tiptap/core";

export { nettoyerCollage, texteBrutEnParagraphes } from "./descriptionCollage";

// ---------------------------------------------------------------------------------------------
// Taille de caractères
// ---------------------------------------------------------------------------------------------
// TipTap 2 ne fournit pas d'extension de taille de police. Plutôt que d'ajouter une dépendance
// pour quinze lignes, on déclare un attribut supplémentaire sur la marque `textStyle` déjà
// utilisée par la couleur et la police. On se pose donc sur un mécanisme existant au lieu d'en
// créer un : une seule marque porte couleur, police et taille, et elles se combinent sans
// empiler des <span> l'un dans l'autre.
export const TailleCaracteres = Extension.create({
  name: "tailleCaracteres",

  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.fontSize || null,
            renderHTML: (attributs: Record<string, any>) =>
              attributs.fontSize ? { style: `font-size: ${attributs.fontSize}` } : {},
          },
        },
      },
    ];
  },
});

// ---------------------------------------------------------------------------------------------
// Cellules de tableau
// ---------------------------------------------------------------------------------------------
// Attributs ajoutés aux cellules : fond, alignement vertical et alignement horizontal. Les trois
// sont acceptés par le filtre d'enregistrement, donc conservés à la réouverture et reproduits
// dans le PDF. `this.parent?.()` conserve colspan, rowspan et colwidth fournis par l'extension
// d'origine : on étend, on ne remplace pas.
const attributsCelluleSupplementaires = {
  backgroundColor: {
    default: null,
    parseHTML: (element: HTMLElement) =>
      element.style.backgroundColor || element.getAttribute("bgcolor") || null,
    renderHTML: (attributs: Record<string, any>) =>
      attributs.backgroundColor ? { style: `background-color: ${attributs.backgroundColor}` } : {},
  },
  verticalAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.verticalAlign || null,
    renderHTML: (attributs: Record<string, any>) =>
      attributs.verticalAlign ? { style: `vertical-align: ${attributs.verticalAlign}` } : {},
  },
  textAlign: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.textAlign || null,
    renderHTML: (attributs: Record<string, any>) =>
      attributs.textAlign ? { style: `text-align: ${attributs.textAlign}` } : {},
  },
};

const CelluleEtendue = TableCell.extend({
  addAttributes() {
    return { ...(this.parent?.() || {}), ...attributsCelluleSupplementaires };
  },
});

const EnteteEtendue = TableHeader.extend({
  addAttributes() {
    return { ...(this.parent?.() || {}), ...attributsCelluleSupplementaires };
  },
});

// Le surlignage et le soulignement doivent aussi se reconnaître dans leur écriture « web » :
// Gmail et Google Docs n'emploient ni <mark> ni <u>, mais des <span> stylés. Sans ces règles de
// lecture supplémentaires, un collage depuis Gmail perdrait silencieusement ses surlignages.
const FONDS_IGNORES = ["", "transparent", "white", "#fff", "#ffffff", "rgb(255, 255, 255)", "rgba(0, 0, 0, 0)"];

const SurlignageEtendu = Highlight.extend({
  parseHTML() {
    return [
      { tag: "mark" },
      {
        tag: "span[style]",
        getAttrs: (element: any) => {
          const couleur = String(element.style.backgroundColor || "").trim().toLowerCase();
          if (FONDS_IGNORES.indexOf(couleur) !== -1) return false;
          return { color: element.style.backgroundColor };
        },
      },
    ];
  },
});

const SoulignementEtendu = Underline.extend({
  parseHTML() {
    return [
      { tag: "u" },
      {
        tag: "span[style]",
        getAttrs: (element: any) =>
          String(element.style.textDecoration || element.style.textDecorationLine || "")
            .indexOf("underline") !== -1
            ? {}
            : false,
      },
    ];
  },
});

/**
 * Modèle complet de l'éditeur.
 *
 * Ce qui est volontairement absent : les blocs de code, les citations, les filets horizontaux et
 * les niveaux de titre au-delà de deux. Un document d'atelier n'en a pas l'usage, et chaque
 * élément en plus est un élément de plus à rendre correctement dans le PDF.
 */
export function construireExtensions() {
  return [
    StarterKit.configure({
      // Deux niveaux seulement : « Titre » et « Sous-titre ». Au-delà, les plans divergent d'une
      // fiche à l'autre et le document perd sa lisibilité d'ensemble.
      heading: { levels: [2, 3] },
      code: false,
      codeBlock: false,
      blockquote: false,
      horizontalRule: false,
    }),
    TextStyle,
    Color,
    FontFamily.configure({ types: ["textStyle"] }),
    TailleCaracteres,
    SoulignementEtendu,
    SurlignageEtendu.configure({ multicolor: true }),
    TextAlign.configure({ types: ["heading", "paragraph"] }),
    // `resizable` : c'est ce qui donne les poignées de largeur de colonne au survol des bordures.
    Table.configure({ resizable: true, allowTableNodeSelection: true }),
    TableRow,
    EnteteEtendue,
    CelluleEtendue,
  ];
}

