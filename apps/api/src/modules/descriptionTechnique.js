// Description technique de l'article : assainissement et découpage du texte enrichi.
//
// Le texte est stocké en HTML. Ce module est le SEUL endroit qui décide ce qu'un auteur peut
// enregistrer : balises, attributs, et jusqu'au détail des propriétés de style autorisées, avec
// la valeur attendue pour chacune. Tout le reste est retiré silencieusement.
//
// Ce filtre n'est pas une simple précaution de sécurité. C'est lui qui garantit qu'un collage
// venu de Word, de Gmail, d'Excel ou d'une page web ressort PROPRE : les mises en forme utiles
// (gras, italique, souligné, police, taille, couleur, surlignage, alignement, listes, tableaux)
// sont conservées, et tout le fatras qui les accompagne — classes, `mso-*`, marges, bordures
// dessinées au cas par cas, polices fantômes, scripts — disparaît. La présentation d'ensemble
// (filets des tableaux, espacements, hiérarchie) reste imposée par l'application.
//
// Le module est partagé entre l'enregistrement (ficheTechnique.js) et la génération du PDF
// (ficheTechniquePdf.js) : une seule définition de ce qui est autorisé, donc aucune divergence
// possible entre ce que l'on enregistre, ce que l'on affiche et ce que l'on imprime.

// ---------------------------------------------------------------------------------------------
// 1. Balises autorisées, et attributs propres à chacune
// ---------------------------------------------------------------------------------------------
// `style` est traité à part : il est autorisé partout, mais filtré propriété par propriété.
const BALISES_AUTORISEES = {
  p: [],
  h2: [],
  h3: [],
  br: [],
  strong: [],
  em: [],
  u: [],
  s: [],
  span: [],
  // mark : surlignage. La couleur voyage dans le style, pas dans un attribut `data-color` —
  // c'est elle que l'éditeur relit à la réouverture.
  mark: [],
  ul: [],
  ol: [],
  li: [],
  table: [],
  thead: [],
  tbody: [],
  tr: [],
  // colwidth : largeur de colonne mémorisée par l'éditeur quand l'utilisateur déplace une
  // bordure. Attribut non standard, ignoré par les navigateurs, mais relu par l'éditeur à la
  // réouverture — c'est ce qui fait qu'un tableau retrouve ses dimensions des jours plus tard.
  th: ["colspan", "rowspan", "colwidth"],
  td: ["colspan", "rowspan", "colwidth"],
  colgroup: [],
  col: ["span"],
};

// Balises sans contenu : elles ne doivent jamais être réécrites avec une fermeture, et ne
// comptent pas dans le calcul d'imbrication.
const BALISES_VIDES = ["br", "col"];

// Balises dont le CONTENU doit disparaître avec elles : laisser le texte d'un <script> ou d'un
// <style> produirait du charabia dans le document atelier. Word en colle systématiquement.
const BALISES_A_VIDER = ["script", "style", "head", "title", "xml"];

// ---------------------------------------------------------------------------------------------
// 2. Propriétés de style autorisées, avec le format attendu pour la valeur
// ---------------------------------------------------------------------------------------------

// Couleurs nommées acceptées. Volontairement court : une valeur inconnue (`windowtext`,
// `ButtonFace` et autres héritages de Word) est rejetée plutôt que devinée.
const COULEURS_NOMMEES = [
  "black", "white", "red", "green", "blue", "yellow", "orange", "purple", "pink",
  "brown", "grey", "gray", "silver", "gold", "navy", "teal", "olive", "maroon",
  "lime", "aqua", "cyan", "magenta", "fuchsia", "beige", "ivory", "khaki",
  "transparent",
];

function validerCouleur(valeur) {
  const v = valeur.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(v) || /^#[0-9a-f]{6}$/.test(v)) return v;
  const rgb = v.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/);
  if (rgb) {
    const composantes = [rgb[1], rgb[2], rgb[3]].map((n) => Math.max(0, Math.min(255, Math.round(Number(n)))));
    if (composantes.some((n) => !Number.isFinite(n))) return null;
    // Normalisé en hexadécimal : une seule écriture en base, donc des comparaisons fiables.
    return "#" + composantes.map((n) => n.toString(16).padStart(2, "0")).join("");
  }
  if (COULEURS_NOMMEES.indexOf(v) !== -1) return v;
  return null;
}

// Un fond blanc n'apporte rien et masquerait l'alternance de lignes du tableau : Word et Excel
// en posent partout, on les retire.
function validerFond(valeur) {
  const couleur = validerCouleur(valeur);
  if (couleur === null) return null;
  if (couleur === "transparent" || couleur === "white" || couleur === "#fff" || couleur === "#ffffff") return null;
  return couleur;
}

const TAILLE_MIN_PX = 8;
const TAILLE_MAX_PX = 48;

// Les tailles arrivent en pt depuis Word et en px depuis le web : tout est ramené en px, seule
// unité stockée. Une taille hors bornes est ramenée aux bornes plutôt que rejetée — un texte
// collé en 6 pt doit rester lisible dans le document atelier.
function validerTaille(valeur) {
  const m = valeur.trim().toLowerCase().match(/^([\d.]+)\s*(px|pt)$/);
  if (!m) return null;
  let px = Number(m[1]);
  if (!Number.isFinite(px) || px <= 0) return null;
  if (m[2] === "pt") px = px * 96 / 72;
  px = Math.round(px);
  if (px < TAILLE_MIN_PX) px = TAILLE_MIN_PX;
  if (px > TAILLE_MAX_PX) px = TAILLE_MAX_PX;
  return px + "px";
}

// Les noms de police sont acceptés sur leur forme, pas sur une liste fermée : un document collé
// doit garder sa police, même si elle n'est pas dans notre barre d'outils. En revanche la forme
// est stricte — lettres, chiffres, espaces et traits d'union — ce qui exclut toute tentative
// d'injecter autre chose qu'un nom de police.
const FAMILLES_GENERIQUES = ["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"];

function validerPolice(valeur) {
  const noms = valeur.split(",").slice(0, 4).map((nom) => {
    const propre = nom.trim().replace(/^["']|["']$/g, "").trim();
    if (!/^[A-Za-z0-9][A-Za-z0-9 \-]{0,31}$/.test(propre)) return null;
    if (FAMILLES_GENERIQUES.indexOf(propre.toLowerCase()) !== -1) return propre.toLowerCase();
    // Les noms composés sont réécrits entre guillemets : « Times New Roman » sans guillemets
    // n'est pas du CSS valide partout.
    return propre.indexOf(" ") !== -1 ? '"' + propre + '"' : propre;
  }).filter(Boolean);
  return noms.length > 0 ? noms.join(", ") : null;
}

function validerMotsCles(liste) {
  return (valeur) => {
    const v = valeur.trim().toLowerCase();
    return liste.indexOf(v) !== -1 ? v : null;
  };
}

function validerLargeur(valeur) {
  const v = valeur.trim().toLowerCase();
  if (/^\d{1,3}(\.\d+)?%$/.test(v)) return v;
  if (/^\d{1,4}(\.\d+)?px$/.test(v)) return v;
  return null;
}

const PROPRIETES_AUTORISEES = {
  "color": validerCouleur,
  "background-color": validerFond,
  "font-family": validerPolice,
  "font-size": validerTaille,
  "font-weight": validerMotsCles(["bold", "normal", "600", "700", "800", "900", "400"]),
  "font-style": validerMotsCles(["italic", "normal"]),
  "text-decoration": validerMotsCles(["underline", "line-through", "none"]),
  "text-align": validerMotsCles(["left", "center", "right", "justify"]),
  "vertical-align": validerMotsCles(["top", "middle", "bottom", "baseline"]),
  "width": validerLargeur,
};

/**
 * Réduit un attribut `style` aux seules propriétés autorisées, avec leur valeur validée.
 * Renvoie "" si rien ne subsiste : un `style=""` vide n'a aucun intérêt en base.
 */
function filtrerStyle(styleBrut) {
  if (!styleBrut) return "";
  // Garde-fou : tout ce qui pourrait charger une ressource ou évaluer du code est écarté en
  // bloc, avant même l'examen propriété par propriété.
  if (/url\s*\(|expression\s*\(|javascript:|@import|\\/i.test(styleBrut)) return "";

  const retenues = [];
  styleBrut.split(";").forEach((declaration) => {
    const sep = declaration.indexOf(":");
    if (sep === -1) return;
    const propriete = declaration.slice(0, sep).trim().toLowerCase();
    const valeur = declaration.slice(sep + 1).trim();
    if (!valeur) return;
    const valider = PROPRIETES_AUTORISEES[propriete];
    if (!valider) return;
    const valide = valider(valeur);
    if (valide === null || valide === "") return;
    retenues.push(propriete + ": " + valide);
  });

  return retenues.join("; ");
}

// ---------------------------------------------------------------------------------------------
// 3. Assainissement
// ---------------------------------------------------------------------------------------------

const REGEX_ATTRIBUT = /([a-zA-Z][a-zA-Z0-9-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;

// Une valeur d'attribut relue depuis la base est ÉCHAPPÉE : `font-family: "Times New Roman"` y
// est écrit `font-family: &quot;Times New Roman&quot;`. Sans ce décodage, le validateur de police
// verrait une valeur contenant `&` et `;`, la rejetterait, et la police disparaîtrait au second
// enregistrement — exactement le genre de perte silencieuse qu'un filtre doit éviter. Le
// réencodage à la sortie (echapperValeurAttribut) referme le cycle : filtrer deux fois donne le
// même résultat que filtrer une fois.
function decoderEntites(valeur) {
  return String(valeur)
    .replace(/&quot;/gi, '"')
    .replace(/&#0*34;/g, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&");
}

function lireAttributs(chaine) {
  const attributs = {};
  if (!chaine) return attributs;
  let m;
  REGEX_ATTRIBUT.lastIndex = 0;
  while ((m = REGEX_ATTRIBUT.exec(chaine)) !== null) {
    const nom = m[1].toLowerCase();
    const valeur = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    attributs[nom] = decoderEntites(valeur);
  }
  return attributs;
}

function echapperValeurAttribut(valeur) {
  return String(valeur).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// colspan / rowspan / span : des entiers, bornés. Un rowspan de 5000 collé par erreur depuis un
// tableur produirait un document illisible.
function validerEntierCellule(valeur) {
  const n = parseInt(String(valeur).trim(), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return String(Math.min(n, 64));
}

// colwidth : un entier, ou plusieurs séparés par des virgules quand la cellule couvre
// plusieurs colonnes.
function validerColwidth(valeur) {
  const parts = String(valeur).split(",").map((p) => parseInt(p.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0 && n <= 4000);
  return parts.length > 0 ? parts.join(",") : null;
}

/**
 * Réduit un fragment HTML aux balises, attributs et styles autorisés ci-dessus.
 * Renvoie null si le résultat ne contient aucun texte et aucun tableau : une description
 * « vide » doit valoir NULL en base, et non un `<p></p>` qui ferait croire à une section remplie.
 */
function assainirDescription(htmlBrut) {
  if (htmlBrut == null) return null;
  let html = String(htmlBrut);

  BALISES_A_VIDER.forEach((balise) => {
    html = html.replace(new RegExp("<" + balise + "\\b[\\s\\S]*?</" + balise + "\\s*>", "gi"), "");
    html = html.replace(new RegExp("<" + balise + "\\b[^>]*/?>", "gi"), "");
  });

  // Commentaires, y compris les commentaires conditionnels dont Word truffe ses collages.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<!\[[\s\S]*?\]>/g, "");
  html = html.replace(/<![^>]*>/g, "");

  // Chaque balise est réécrite avec ses seuls attributs autorisés, ou purement retirée. Le
  // texte d'une balise retirée est toujours conservé : supprimer une balise inconnue ne doit
  // jamais faire disparaître une information technique.
  html = html.replace(/<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9:]*)\b([^>]*?)(\/?)\s*>/g, (_tout, fermante, nom, attrs) => {
    const balise = nom.toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(BALISES_AUTORISEES, balise)) return "";

    if (BALISES_VIDES.indexOf(balise) !== -1) {
      if (fermante) return "";
      if (balise === "br") return "<br />";
      // <col> : seules la portée et la largeur ont un sens.
      const attributs = lireAttributs(attrs);
      const morceaux = [];
      const span = attributs.span ? validerEntierCellule(attributs.span) : null;
      if (span) morceaux.push('span="' + span + '"');
      const style = filtrerStyle(attributs.style);
      if (style) morceaux.push('style="' + echapperValeurAttribut(style) + '"');
      return "<col" + (morceaux.length ? " " + morceaux.join(" ") : "") + " />";
    }

    if (fermante) return "</" + balise + ">";

    const attributs = lireAttributs(attrs);
    const autorises = BALISES_AUTORISEES[balise];
    const morceaux = [];

    autorises.forEach((nomAttribut) => {
      if (!Object.prototype.hasOwnProperty.call(attributs, nomAttribut)) return;
      let valeur = attributs[nomAttribut];
      if (nomAttribut === "colspan" || nomAttribut === "rowspan") valeur = validerEntierCellule(valeur);
      else if (nomAttribut === "colwidth") valeur = validerColwidth(valeur);
      if (valeur === null || valeur === "") return;
      morceaux.push(nomAttribut + '="' + echapperValeurAttribut(valeur) + '"');
    });

    const style = filtrerStyle(attributs.style);
    if (style) morceaux.push('style="' + echapperValeurAttribut(style) + '"');

    return "<" + balise + (morceaux.length ? " " + morceaux.join(" ") : "") + ">";
  });

  // Paragraphes et titres vides produits par l'éditeur en fin de saisie : inutiles dans un
  // document imprimé, ils ne feraient qu'ajouter du blanc.
  html = html.replace(/<(p|h2|h3)(\s[^>]*)?>\s*(<br \/>)?\s*<\/\1>/gi, "");
  // Enveloppes vides laissées par le retrait d'une balise de décoration.
  html = html.replace(/<span(\s[^>]*)?>\s*<\/span>/gi, "");

  html = normaliserLargeursTables(html);

  const texteSeul = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
  // Un tableau de cellules encore vides est un contenu légitime : l'auteur vient de l'insérer.
  if (texteSeul === "" && !/<table\b/i.test(html)) return null;

  return html.trim();
}

// ---------------------------------------------------------------------------------------------
// 4. Largeurs de colonnes
// ---------------------------------------------------------------------------------------------
/**
 * Pose sur chaque tableau un <colgroup> dont les largeurs sont exprimées en POURCENTAGES.
 *
 * Pourquoi : l'éditeur mémorise les largeurs en pixels (attribut `colwidth`), ce qui convient à
 * l'écran mais déborderait de la largeur imprimable d'une A4. En traduisant ces pixels en
 * proportions, le même tableau occupe exactement la largeur disponible à l'écran comme sur le
 * papier, en gardant les proportions voulues par l'auteur. Les `colwidth` sont laissés en place :
 * c'est eux que l'éditeur relit à la réouverture pour replacer ses poignées de redimensionnement.
 *
 * Un tableau dont aucune colonne n'a été redimensionnée reçoit des colonnes égales — c'est le
 * cas d'un tableau fraîchement inséré ou collé depuis un tableur.
 */
function normaliserLargeursTables(html) {
  return html.replace(/<table\b([^>]*)>([\s\S]*?)<\/table>/gi, (_tout, attrsTable, interieur) => {
    const sansColgroup = interieur.replace(/<colgroup\b[^>]*>[\s\S]*?<\/colgroup>/gi, "");

    const premiereLigne = sansColgroup.match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
    if (!premiereLigne) return "<table" + attrsTable + ">" + sansColgroup + "</table>";

    const largeurs = [];
    let complet = true;
    const regexCellule = /<(td|th)\b([^>]*)>/gi;
    let cellule;
    while ((cellule = regexCellule.exec(premiereLigne[1])) !== null) {
      const attributs = lireAttributs(cellule[2]);
      const colspan = Math.max(1, parseInt(attributs.colspan || "1", 10) || 1);
      const brutes = String(attributs.colwidth || "").split(",")
        .map((n) => parseInt(n.trim(), 10)).filter((n) => Number.isFinite(n) && n > 0);
      for (let i = 0; i < colspan; i++) {
        if (brutes[i]) largeurs.push(brutes[i]);
        else { largeurs.push(0); complet = false; }
      }
    }

    if (largeurs.length === 0) return "<table" + attrsTable + ">" + sansColgroup + "</table>";

    let cols;
    if (complet) {
      const total = largeurs.reduce((s, n) => s + n, 0);
      cols = largeurs.map((n) => '<col style="width: ' + (Math.round(n / total * 10000) / 100) + '%" />');
    } else {
      const part = Math.round(100 / largeurs.length * 100) / 100;
      cols = largeurs.map(() => '<col style="width: ' + part + '%" />');
    }

    return "<table" + attrsTable + "><colgroup>" + cols.join("") + "</colgroup>" + sansColgroup + "</table>";
  });
}

// ---------------------------------------------------------------------------------------------
// 5. Lecture
// ---------------------------------------------------------------------------------------------

/** true si la description contient réellement quelque chose à imprimer. */
function descriptionRenseignee(html) {
  return assainirDescription(html) !== null;
}

/**
 * Découpe la description assainie en blocs de PREMIER NIVEAU (un paragraphe, un titre, une
 * liste entière, un tableau entier).
 *
 * Utilité : le générateur PDF place chaque bloc dans sa propre ligne de tableau. C'est ce qui
 * permet au calcul d'espaceurs de bcPfPdf.js de savoir où une page se termine, et donc de ne
 * jamais couper un titre de son premier paragraphe ni laisser une ligne orpheline. Une
 * description d'un seul tenant empêcherait ce calcul.
 *
 * Le découpage est sensible à l'imbrication : une liste contenant une sous-liste, ou un tableau
 * entier avec toutes ses lignes, reste UN bloc.
 */
function decouperEnBlocs(htmlAssaini) {
  if (!htmlAssaini) return [];
  const blocs = [];
  // Attention : les balises portent désormais des attributs (colspan, style…). Le motif doit
  // donc les tolérer, sans quoi le calcul de profondeur raterait toutes les cellules.
  const regexBalise = /<(\/?)([a-z0-9]+)\b[^>]*?(\/?)>/gi;

  let profondeur = 0;
  let debutBloc = -1;
  let correspondance;

  while ((correspondance = regexBalise.exec(htmlAssaini)) !== null) {
    const estFermante = correspondance[1] === "/";
    const balise = correspondance[2].toLowerCase();
    const autoFermante = correspondance[3] === "/";
    // Balises sans contenu : elles ne changent jamais la profondeur. Un <br /> en début de
     // document ne doit pas non plus ouvrir un bloc.
    if (BALISES_VIDES.indexOf(balise) !== -1 || autoFermante) continue;

    if (!estFermante) {
      if (profondeur === 0) debutBloc = correspondance.index;
      profondeur++;
    } else {
      profondeur--;
      if (profondeur === 0 && debutBloc !== -1) {
        blocs.push(htmlAssaini.slice(debutBloc, correspondance.index + correspondance[0].length));
        debutBloc = -1;
      }
      // Sécurité : une balise fermante orpheline ne doit jamais faire passer la profondeur
      // sous zéro et décaler tous les blocs suivants.
      if (profondeur < 0) profondeur = 0;
    }
  }

  // Texte laissé hors de toute balise (cas limite) : il ne doit pas disparaître du document.
  if (blocs.length === 0) {
    const reste = htmlAssaini.trim();
    if (reste) blocs.push("<p>" + reste + "</p>");
  }

  return blocs;
}

/** true si ce bloc est un tableau : le PDF le traite différemment des paragraphes. */
function blocEstTableau(bloc) {
  return /^\s*<table\b/i.test(String(bloc || ""));
}

/**
 * Nombre de colonnes d'un bloc tableau, colspan compris. Le générateur PDF s'en sert pour
 * resserrer la typographie d'un tableau large plutôt que de le laisser déborder de la page.
 */
function compterColonnes(bloc) {
  const premiereLigne = String(bloc || "").match(/<tr\b[^>]*>([\s\S]*?)<\/tr>/i);
  if (!premiereLigne) return 0;
  let total = 0;
  const regexCellule = /<(td|th)\b([^>]*)>/gi;
  let cellule;
  while ((cellule = regexCellule.exec(premiereLigne[1])) !== null) {
    const attributs = lireAttributs(cellule[2]);
    total += Math.max(1, parseInt(attributs.colspan || "1", 10) || 1);
  }
  return total;
}

module.exports = {
  assainirDescription,
  descriptionRenseignee,
  decouperEnBlocs,
  blocEstTableau,
  compterColonnes,
  filtrerStyle,
  BALISES_AUTORISEES,
  PROPRIETES_AUTORISEES,
};
