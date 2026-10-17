// Nettoyage d'un fragment collé dans la description technique.
//
// Ce qu'il faut faire d'un fragment venu de Word, Gmail, Google Docs, Excel ou d'une page web
// AVANT de le confier à l'éditeur. Sans cette étape, deux choses se perdent :
//
// - les mises en forme écrites dans un dialecte que l'éditeur ne reconnaît pas (tailles en
//   points, `bgcolor`, `valign`, listes Word déguisées en paragraphes) ;
// - la lisibilité du résultat, noyé sous les reliquats `mso-*`, les marges et les interlignes
//   du document d'origine, qui entreraient en conflit avec la mise en page de la fiche.
//
// Le module est volontairement SANS AUCUN IMPORT : c'est une transformation de chaîne, et elle
// se teste donc seule, sans éditeur, sans navigateur et sans Electron. Les règles ci-dessous
// sont le fruit de ce que produisent réellement ces applications, pas d'une norme.

const PT_VERS_PX = 96 / 72;

/** Traduit les tailles en points (Word, Google Docs) vers les pixels, seule unité stockée. */
export function convertirPointsEnPixels(html: string): string {
  return html.replace(/font-size\s*:\s*([\d.]+)\s*pt/gi, (_tout, valeur) => {
    const px = Math.round(Number(valeur) * PT_VERS_PX);
    if (!Number.isFinite(px) || px <= 0) return "font-size: 12px";
    return "font-size: " + Math.max(8, Math.min(48, px)) + "px";
  });
}

/**
 * Word n'écrit pas de listes : il écrit des paragraphes décorés d'un marqueur et d'un style
 * `mso-list`. Collés tels quels, ils donnent une suite de lignes avec des puces en dur, qui ne se
 * renumérotent pas et que l'on ne peut plus manipuler comme une liste.
 *
 * On les reconstruit donc en vraies listes. Le marqueur (« · », « 1. », « a) ») sert à décider
 * entre liste à puces et liste numérotée, puis il est retiré : c'est désormais l'éditeur qui
 * numérote, donc l'ajout d'un élément met toute la suite à jour.
 *
 * Limite assumée : les niveaux d'imbrication de Word sont ramenés à un seul niveau. Le retrait se
 * remet en place avec la touche Tab, et cela évite une reconstruction fragile de la hiérarchie à
 * partir d'identifiants internes (`mso-list: l0 level2 lfo1`) dont la signification varie d'une
 * version de Word à l'autre.
 */
export function convertirListesWord(html: string): string {
  let resultat = html.replace(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi, (tout, attrs, contenu) => {
    if (!/mso-list\s*:/i.test(String(attrs))) return tout;

    let marqueur = "";
    let corps = String(contenu).replace(
      /<span[^>]*mso-list\s*:\s*ignore[^>]*>([\s\S]*?)<\/span>/i,
      (_m, texte) => { marqueur = String(texte); return ""; },
    );

    const texteMarqueur = marqueur.replace(/<[^>]*>/g, "").replace(/&nbsp;/gi, " ").trim();
    const ordonnee = /^(\d+|[a-zA-Z]|[ivxIVX]+)\s*[.)]?$/.test(texteMarqueur) && !/^[·•o]$/.test(texteMarqueur);

    corps = corps.replace(/^(\s|&nbsp;)+/i, "");
    return `<li data-liste-word="${ordonnee ? "1" : "0"}">${corps}</li>`;
  });

  // Les éléments consécutifs sont regroupés dans une seule liste. Le type est décidé par le
  // premier marqueur du groupe : un groupe mixte est rarissime et vaut mieux homogène que coupé.
  resultat = resultat.replace(/(?:<li data-liste-word="[01]">[\s\S]*?<\/li>\s*)+/gi, (bloc) => {
    const ordonnee = /^\s*<li data-liste-word="1"/.test(bloc);
    const elements = bloc.replace(/ data-liste-word="[01]"/g, "");
    return ordonnee ? `<ol>${elements}</ol>` : `<ul>${elements}</ul>`;
  });

  return resultat;
}

/** Traduit les attributs de présentation d'Excel et de Word en styles que l'éditeur sait lire. */
export function traduireAttributsDePresentation(html: string): string {
  return html
    .replace(/<(td|th)\b([^>]*)>/gi, (_tout, balise, attrs) => {
      let reste = String(attrs);
      const styles: string[] = [];

      reste = reste.replace(/\sbgcolor\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, _g, g2, g3, g4) => {
        const couleur = (g2 || g3 || g4 || "").trim();
        if (couleur) styles.push("background-color: " + couleur);
        return "";
      });
      reste = reste.replace(/\salign\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, _g, g2, g3, g4) => {
        const valeur = (g2 || g3 || g4 || "").trim().toLowerCase();
        if (["left", "center", "right", "justify"].indexOf(valeur) !== -1) styles.push("text-align: " + valeur);
        return "";
      });
      reste = reste.replace(/\svalign\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi, (_m, _g, g2, g3, g4) => {
        const valeur = (g2 || g3 || g4 || "").trim().toLowerCase();
        if (["top", "middle", "bottom"].indexOf(valeur) !== -1) styles.push("vertical-align: " + valeur);
        return "";
      });

      if (styles.length === 0) return `<${balise}${reste}>`;

      // Les styles traduits sont ajoutés à ceux déjà présents, sans les écraser. Le délimiteur
      // peut être une apostrophe : c'est l'écriture de Word, et la rater ajouterait un second
      // attribut `style` que le navigateur ignorerait.
      if (/\sstyle\s*=\s*["']/i.test(reste)) {
        return `<${balise}${reste.replace(/(\sstyle\s*=\s*["'])/i, `$1${styles.join("; ")}; `)}>`;
      }
      return `<${balise}${reste} style="${styles.join("; ")}">`;
    })
    // `background:` abrégé (Excel) ramené à la propriété que l'éditeur interroge.
    .replace(/background\s*:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]*\))/gi, "background-color: $1")
    // <font color size face> : écriture ancienne, encore produite par certains outils.
    .replace(/<font\b([^>]*)>/gi, (_tout, attrs) => {
      const styles: string[] = [];
      const couleur = String(attrs).match(/color\s*=\s*"?([^"\s>]+)"?/i);
      const face = String(attrs).match(/face\s*=\s*"([^"]+)"/i);
      if (couleur) styles.push("color: " + couleur[1]);
      if (face) styles.push("font-family: " + face[1]);
      return styles.length ? `<span style="${styles.join("; ")}">` : "<span>";
    })
    .replace(/<\/font>/gi, "</span>");
}

// Propriétés de style conservées au collage. Volontairement identique à la liste du filtre
// d'enregistrement (electron/ipc/descriptionTechnique.js) : ce que l'on accepte de coller est
// exactement ce que l'on saura enregistrer, donc rien ne « disparaît » après la frappe suivante.
const PROPRIETES_CONSERVEES = [
  "color", "background-color", "font-family", "font-size", "font-weight",
  "font-style", "text-decoration", "text-decoration-line", "text-align", "vertical-align",
];

/**
 * Point d'entrée : branché sur `transformPastedHTML`, donc appelé avant que l'éditeur n'analyse
 * le fragment collé. Ce qui sort d'ici est du HTML ordinaire ; c'est ensuite le modèle de
 * l'éditeur, et lui seul, qui décide de ce qui est retenu.
 */
export function nettoyerCollage(htmlColle: string): string {
  let html = String(htmlColle || "");

  // 1. Enveloppes et commentaires. Les commentaires conditionnels de Word contiennent une
  //    seconde version du contenu, en balisage propriétaire : les laisser passer ferait
  //    apparaître le texte en double.
  html = html.replace(/<!--[\s\S]*?-->/g, "");
  html = html.replace(/<!\[[\s\S]*?\]>/g, "");
  html = html.replace(/<\?xml[\s\S]*?\?>/gi, "");
  html = html.replace(/<(style|script|xml|head|title)\b[\s\S]*?<\/\1\s*>/gi, "");
  html = html.replace(/<\/?(meta|link|base|html|body|form|input|button|svg|img|iframe|object|embed)\b[^>]*>/gi, "");
  // Balises à espace de noms : <o:p>, <w:sdt>, <v:shape>, <m:oMath>…
  html = html.replace(/<\/?[a-z]+:[a-z0-9-]+\b[^>]*>/gi, "");

  // 2. Reconstruction des listes Word — avant tout nettoyage de style, puisque c'est le style
  //    `mso-list` qui permet de les reconnaître.
  html = convertirListesWord(html);

  // 3. Traductions de dialecte.
  html = traduireAttributsDePresentation(html);
  html = convertirPointsEnPixels(html);

  // 4. Reliquats purement décoratifs. Les classes `Mso*` et les propriétés `mso-*` ne servent à
  //    rien ici, et les marges, interlignes et bordures au cas par cas entreraient en conflit
  //    avec la mise en page du document : ce sont elles, et non la mise en forme de l'auteur,
  //    qui rendent un collage Word méconnaissable.
  html = html.replace(/\s(class|lang|dir|id|width|height|border|cellspacing|cellpadding|nowrap|data-[a-z-]+)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Word délimite ses attributs par des apostrophes (`style='margin:0cm'`), le web par des
  // guillemets. Les deux écritures doivent être reconnues, sans quoi la moitié des collages
  // traverserait le filtre avec ses marges et ses interlignes d'origine — et c'est précisément
  // ce qui fait qu'un texte collé « ne ressemble à rien » dans la fiche.
  html = html.replace(/style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_tout, double, simple) => {
    const styleBrut = double !== undefined ? double : simple !== undefined ? simple : "";
    const retenus = String(styleBrut)
      .split(";")
      .map((declaration) => {
        const sep = declaration.indexOf(":");
        if (sep === -1) return null;
        const propriete = declaration.slice(0, sep).trim().toLowerCase();
        const valeur = declaration.slice(sep + 1).trim();
        if (!propriete || !valeur) return null;
        if (propriete.indexOf("mso-") === 0) return null;
        if (PROPRIETES_CONSERVEES.indexOf(propriete) === -1) return null;
        // Écriture normalisée : un style collé et un style saisi se présentent de la même
        // façon en base, ce qui rend les comparaisons et les tests fiables.
        return propriete + ": " + valeur;
      })
      .filter(Boolean);
    return retenus.length ? `style="${retenus.join("; ")}"` : "";
  });

  // 5. Paragraphes devenus vides (Word en intercale beaucoup) : ils n'ajouteraient que du blanc.
  html = html.replace(/<p(\s[^>]*)?>(\s|&nbsp;|<br\s*\/?>)*<\/p>/gi, "");
  html = html.replace(/<span(\s[^>]*)?>(\s|&nbsp;)*<\/span>/gi, " ");

  return html;
}

/**
 * Collage en texte brut (Ctrl+Maj+V) : chaque ligne devient un paragraphe, sinon un texte de
 * plusieurs alinéas arriverait en un seul pavé. Le texte est échappé : un collage ne doit jamais
 * pouvoir introduire de balise.
 */
export function texteBrutEnParagraphes(texte: string): string {
  const paragraphes = String(texte || "")
    .split(/\r?\n/)
    .map((ligne) => ligne.trim())
    .filter((ligne) => ligne !== "")
    .map((ligne) => "<p>" + ligne.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;") + "</p>");
  return paragraphes.join("");
}
