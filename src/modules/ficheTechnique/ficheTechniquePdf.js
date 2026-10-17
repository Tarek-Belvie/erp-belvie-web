const fs = require("fs/promises");
const {
  assainirDescription,
  decouperEnBlocs,
  blocEstTableau,
  compterColonnes,
} = require("./descriptionTechnique");

// ==============================================================================================
// DOSSIER TECHNIQUE — PDF A4 PAYSAGE
// ==============================================================================================
//
// Pourquoi ce fichier ne réutilise plus la mécanique d'impression des bons de commande.
//
// Les BC reposent sur un seul grand tableau dont le thead et le tfoot se répètent, plus un calcul
// d'espaceurs qui pousse le pied de page vers le bas. Ce procédé a trois limites qui interdisent
// le dossier technique demandé :
//
//   1. la hauteur de page y est écrite en dur (297 mm) ; en paysage, elle vaut 210 mm et tout le
//      calcul devient faux ;
//   2. il ne sait pas compter les pages, donc pas de « Page 3 / 9 » ;
//   3. il ne sait pas réserver une page entière à un élément, donc pas de dessin pleine page.
//
// Ce module construit donc les pages LUI-MÊME. Le document est écrit sous forme d'une suite de
// blocs, puis un algorithme de répartition les mesure un par un dans la fenêtre d'impression et
// les pose sur des pages de 297 x 210 mm construites explicitement, chacune avec son en-tête, son
// pied et son numéro. Rien n'est laissé à la coupure automatique du navigateur : ni la place des
// titres, ni celle des lignes de tableau, ni le nombre de pages.
//
// bcPfPdf.js n'est pas modifié et n'est plus importé : les bons de commande sont intacts.
//
// L'export garde le nom genererPdfDepuisFenetreDediee, donc main.js n'a pas à changer.

const FT_STATUT_LABELS = { brouillon: "Brouillon", validee: "Validée", archivee: "Archivée" };
const VUE_LABELS = { face: "Vue de face", dos: "Vue de dos", detail: "Détail", autre: "Autre vue" };

// Révision du document. La table fiches_techniques n'a pas de colonne de révision, et sa
// contrainte UNIQUE(article_id) garantit une seule fiche par article : il n'existe donc, à ce
// jour, qu'une seule révision possible. La valeur est posée ici, en un seul endroit, pour que le
// jour où de vraies révisions existeront, seule cette ligne soit à brancher sur la base.
const REVISION_PAR_DEFAUT = "V01";

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function mediaUrl(relPath) {
  return relPath ? `belvie-media://local/${relPath}` : null;
}

function fmtDate(sqliteDateTime) {
  if (!sqliteDateTime) return "—";
  const [datePart] = String(sqliteDateTime).split(" ");
  const [y, m, d] = datePart.split("-");
  return `${d}/${m}/${y}`;
}

function num(n) {
  return n == null ? "—" : String(n).replace(".", ",");
}

// Les coordonnées d'annotation sont stockées entre 0 et 1. Multiplier par 100 en virgule
// flottante donne « 14.000000000000002 % » : exact au centième près, mais illisible dans le
// document et inutilement lourd. Deux décimales suffisent très largement à la précision d'un
// repère posé à la souris.
function pourcent(valeur) {
  return Math.round(Number(valeur || 0) * 10000) / 100;
}

// Miroir exact du calcul affiché à l'écran : consommation technique x (1 + perte / 100).
// La consommation budgétée n'est stockée nulle part — ici comme ailleurs, elle se recalcule.
function budgetee(technique, perte) {
  if (technique == null) return "—";
  return (technique * (1 + (perte || 0) / 100)).toFixed(3).replace(".", ",");
}

// ----------------------------------------------------------------------------------------------
// Géométrie de la page
// ----------------------------------------------------------------------------------------------
// Une seule source pour ces valeurs : la CSS les utilise, et l'algorithme de répartition mesure
// ensuite la zone réellement obtenue plutôt que de refaire le calcul. Modifier une marge ici
// suffit donc, sans aucun ajustement ailleurs.
const PAGE_L_MM = 297;
const PAGE_H_MM = 210;
const MARGE_MM = 12;
const ENTETE_MM = 22;
const PIED_MM = 11;

const CSS = `
@page { size: ${PAGE_L_MM}mm ${PAGE_H_MM}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #fff; color: #1A1A1A;
  font-family: 'Inter', 'Segoe UI', Arial, Helvetica, sans-serif; -webkit-print-color-adjust: exact; }
*, *::before, *::after { box-sizing: border-box; }
/* Les blocs en attente et les modèles d'en-tête restent dans le document, masqués.
   Volontairement masqués par display:none et non placés dans un <template> : le contenu d'un
   template est inerte, ses images ne se chargent jamais, et le logo comme les dessins
   arriveraient donc trop tard pour être mesurés. */
#source, .modele { display: none; }

/* --- La page ------------------------------------------------------------------------------- */
.page {
  width: ${PAGE_L_MM}mm; height: ${PAGE_H_MM}mm; position: relative; overflow: hidden;
  page-break-after: always; break-after: page; background: #fff;
}
.page:last-child { page-break-after: auto; break-after: auto; }
/* Soupape de sécurité : un bloc indivisible plus haut qu'une page déborde visiblement plutôt
   que d'être tronqué. Mieux vaut une page chargée qu'une information disparue. */
.page.deborde { overflow: visible; }

.page-entete {
  position: absolute; top: 0; left: 0; right: 0; height: ${ENTETE_MM}mm;
  padding: 5mm ${MARGE_MM}mm 0; display: flex; align-items: flex-start; gap: 8mm;
  border-bottom: 1.2px solid #1A1A1A;
}
/* Colonne flexible : c'est elle qui donne une hauteur DÉFINIE aux blocs pleine page, sans quoi
   un dessin ne saurait pas quelle place il peut occuper (une hauteur en pourcentage ne résout
   pas contre un parent de hauteur automatique). */
.page-corps {
  position: absolute; top: ${ENTETE_MM}mm; bottom: ${PIED_MM}mm;
  left: ${MARGE_MM}mm; right: ${MARGE_MM}mm; padding: 4mm 0 3mm;
  display: flex; flex-direction: column; align-items: stretch;
}
.bloc { flex: 0 0 auto; }
.bloc[data-page="pleine"] { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.page-pied {
  position: absolute; bottom: 0; left: 0; right: 0; height: ${PIED_MM}mm;
  padding: 0 ${MARGE_MM}mm 3.5mm; display: flex; align-items: flex-end;
  justify-content: space-between; gap: 8mm;
  font-size: 7.5px; color: #6B6B62; border-top: 0.8px solid #DADCD3;
}
.page-pied .pied-societe { max-width: 200mm; line-height: 1.5; }
.page-pied .pied-numero { font-weight: 600; color: #1A1A1A; white-space: nowrap; }

/* --- En-tête ------------------------------------------------------------------------------- */
.ent-marque { flex-shrink: 0; width: 42mm; }
.ent-logo { max-height: 11mm; max-width: 42mm; object-fit: contain; object-position: left top; display: block; }
.ent-nom { font-weight: 800; font-size: 19px; letter-spacing: 0.01em; line-height: 1; }
.ent-titre-bloc { flex-shrink: 0; }
.ent-titre { font-size: 13px; font-weight: 800; letter-spacing: 0.06em; text-transform: uppercase; line-height: 1.1; }
.ent-ref { font-size: 12.5px; font-weight: 700; color: #1F3A2E; margin-top: 1.5mm; letter-spacing: 0.02em; }
.ent-infos {
  margin-left: auto; display: grid; grid-template-columns: auto auto auto auto; gap: 0.8mm 3mm;
  font-size: 8px; line-height: 1.35; align-content: start;
}
.ent-infos .k { color: #8A8A80; white-space: nowrap; }
.ent-infos .v { font-weight: 700; white-space: nowrap; }
.ent-infos .v.accent { color: #1F3A2E; }

/* --- Titres de section --------------------------------------------------------------------- */
.section-titre {
  background: #EDEFE9; border-left: 3px solid #1F3A2E; padding: 1.8mm 3mm;
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.07em; text-transform: uppercase;
  margin: 0 0 3.5mm;
}
.sous-titre {
  font-size: 9px; font-weight: 700; color: #4B4B43; letter-spacing: 0.04em;
  text-transform: uppercase; margin: 0 0 2mm;
}
.mention-suite { font-size: 8px; color: #8A8A80; font-style: italic; margin: 0 0 2mm; }
.bloc-espace { margin-bottom: 5mm; }

/* --- Tableaux de données ------------------------------------------------------------------- */
/* Largeur pleine du paysage : 273 mm utiles, donc des colonnes larges et une police confortable
   plutôt que du texte comprimé. table-layout auto laisse les colonnes s'ajuster au contenu.
   Aucun filet vertical : dans un tableau de relevé, ce sont les LIGNES que l'œil doit suivre,
   et les traits verticaux ne font que les hacher. La lecture est tenue par l'alternance de fond
   et par un filet horizontal franc.
   Les fonds de ligne sont OPAQUES : c'est aussi ce qui empêche le filigrane de transparaître
   derrière les chiffres. */
.t-donnees { width: 100%; border-collapse: collapse; table-layout: auto; background: #fff; }
.t-donnees thead { display: table-header-group; }
.t-donnees th {
  background: #1F3A2E; color: #fff; font-size: 8.5px; font-weight: 700; letter-spacing: 0.05em;
  text-transform: uppercase; padding: 2.8mm 3mm; text-align: center; vertical-align: middle;
}
.t-donnees td {
  font-size: 10px; padding: 2.4mm 3mm; text-align: center; vertical-align: middle;
  border-bottom: 0.8px solid #CFD3C9; height: 8.5mm;
}
.t-donnees th:first-child, .t-donnees td:first-child { text-align: left; padding-left: 3.5mm; }
.t-donnees th:last-child, .t-donnees td:last-child { padding-right: 3.5mm; }
.t-donnees th.g, .t-donnees td.g { text-align: left; }
/* Quantités, consommations et pourcentages : alignés à droite, unité collée à la valeur, pour
   que les ordres de grandeur se comparent d'un coup d'œil en colonne. */
.t-donnees th.n, .t-donnees td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
.t-donnees tbody tr:nth-child(odd) { background: #fff; }
.t-donnees tbody tr:nth-child(even) { background: #F5F7F2; }
.t-donnees tbody tr:last-child td { border-bottom: 0.8px solid #1F3A2E; }
.t-donnees tbody tr { break-inside: avoid; }

/* --- Sommaire ------------------------------------------------------------------------------- */
.som-titre { font-size: 15px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; margin: 0 0 1.5mm; }
.som-sous { font-size: 9.5px; color: #6B6B62; margin: 0 0 7mm; }
.som-ligne { display: flex; align-items: baseline; gap: 2mm; margin-bottom: 3.2mm; text-decoration: none; color: inherit; }
.som-ligne .lib { font-size: 11.5px; font-weight: 700; white-space: nowrap; }
.som-ligne .pts { flex: 1; border-bottom: 0.8px dotted #B9BDB1; transform: translateY(-1mm); }
.som-ligne .pg { font-size: 11px; font-weight: 700; white-space: nowrap; }
.som-ligne.sous { margin-bottom: 2.2mm; padding-left: 9mm; }
.som-ligne.sous .lib { font-size: 10px; font-weight: 500; color: #4B4B43; }
.som-ligne.sous .pg { font-size: 10px; font-weight: 500; color: #4B4B43; }

/* --- Dessins techniques pleine page -------------------------------------------------------- */
.croquis-zone {
  flex: 1 1 auto; min-height: 0; width: 100%;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
}
.croquis-cadre { position: relative; flex: 0 0 auto; }
.croquis-cadre img { width: 100%; height: 100%; display: block; }
.croquis-legende { font-size: 9px; color: #6B6B62; margin-top: 2.5mm; text-align: center; }
.annotation {
  position: absolute; background: #fff; border: 0.8px solid #1A1A1A; border-radius: 1.5px;
  padding: 0.3mm 1.2mm; font-size: 7.5px; line-height: 1.3; white-space: nowrap;
  transform: translate(-50%, -100%);
}

/* --- Photos produit ------------------------------------------------------------------------ */
.photos-grille { display: flex; gap: 5mm; flex: 1 1 auto; min-height: 0; align-items: stretch; }
/* Une seule photo : elle prend toute la largeur plutôt que de laisser les deux tiers de la page
   vides. Dès qu'il y a des vues de détail, la principale reprend sa colonne. */
.photos-grille.seule .photo-principale { flex: 1 1 auto; }
.photo-principale { flex: 0 0 38%; border: 0.8px solid #DADCD3; border-radius: 2px; overflow: hidden;
  display: flex; align-items: center; justify-content: center; background: #FAFAF8; }
.photo-principale img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }
.photos-secondaires { flex: 1; display: grid; grid-template-columns: repeat(3, 1fr);
  grid-auto-rows: 1fr; gap: 4mm; align-content: start; }
.photo-vignette { border: 0.8px solid #DADCD3; border-radius: 2px; overflow: hidden;
  display: flex; align-items: center; justify-content: center; background: #FAFAF8; }
.photo-vignette img { max-width: 100%; max-height: 100%; object-fit: contain; display: block; }

/* --- Identification ------------------------------------------------------------------------ */
.champs-grille { display: grid; grid-template-columns: repeat(6, 1fr); gap: 4mm 6mm; }
.champ-k { font-size: 7.5px; text-transform: uppercase; letter-spacing: 0.05em; color: #9A9A90; margin-bottom: 1mm; }
.champ-v { font-size: 11px; font-weight: 600; }

/* --- Notes --------------------------------------------------------------------------------- */
.notes-cadre { border: 0.8px solid #DADCD3; border-radius: 2px; padding: 4mm 5mm; }
.notes-texte { font-size: 10px; white-space: pre-wrap; line-height: 1.55; }

/* --- Description technique ----------------------------------------------------------------- */
/* Deux niveaux de mise en forme coexistent : celle que l'auteur choisit (gras, italique,
   souligné, police, taille, couleur, surlignage, alignement, largeurs de colonnes) arrive sous
   forme de styles en ligne déjà validés à l'enregistrement ; celle que l'application impose
   (espacements, filets, hiérarchie) est définie ci-dessous, et nulle part ailleurs. */
/* Taille relevée et interligne resserré par rapport à la première version : en atelier, ce texte
   se lit debout, parfois à bout de bras. 11.5px sur 273 mm de large reste très confortable, et
   les espacements sont harmonisés — un seul écart entre paragraphes, un seul avant un titre. */
.ft-desc { font-size: 11.5px; line-height: 1.58; color: #15150F; }
.ft-desc p { margin: 0 0 2.5mm; }
/* Les marges HAUTES comptent autant que les basses : chaque élément de la description est un
   bloc indépendant, posé par l'algorithme de répartition. Sans marge haute sur les titres, un
   sous-titre viendrait se coller au paragraphe qui le précède, et le texte perdrait son rythme. */
.ft-desc h2 {
  font-size: 13px; font-weight: 800; color: #15150F; margin: 5mm 0 2.5mm;
  padding-bottom: 1.2mm; border-bottom: 0.8px solid #C9CCC2;
}
.ft-desc h3 {
  font-size: 11.5px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em;
  color: #1F3A2E; margin: 4mm 0 2mm;
}
.ft-desc ul, .ft-desc ol { margin: 0 0 2.5mm; padding-left: 6mm; }
.ft-desc li { margin-bottom: 1mm; }
/* L'éditeur enveloppe le texte d'une puce dans un paragraphe. Sans cette règle, chaque puce
   hériterait de la marge de paragraphe et la liste serait deux fois trop aérée. */
.ft-desc li > p { margin: 0; }
.ft-desc li::marker { color: #6B6B62; }
.ft-desc ul ul, .ft-desc ol ol, .ft-desc ul ol, .ft-desc ol ul { margin: 1mm 0 0; }
.ft-desc strong { font-weight: 700; }
.ft-desc em { font-style: italic; }
.ft-desc u { text-decoration: underline; }
.ft-desc s { text-decoration: line-through; }
.ft-desc mark { background: #fef08a; color: inherit; padding: 0 1px; }
/* Premier élément d'une section ou d'une page : pas de marge haute, elle ferait un vide sous le
   bandeau de titre ou en haut de page. Le premier cas est marqué à la construction, le second
   dépend de la page sur laquelle le bloc atterrit et ne peut donc être traité qu'en CSS. */
.ft-desc.premier > *:first-child { margin-top: 0; }
.page-corps > .bloc:first-child .ft-desc > *:first-child { margin-top: 0; }

.ft-desc table {
  width: 100%; max-width: 100%; border-collapse: collapse; table-layout: fixed;
  margin: 0; font-size: 10.5px; background: #fff;
}
.ft-desc table thead { display: table-header-group; }
.ft-desc table tr { break-inside: avoid; }
.ft-desc table th, .ft-desc table td {
  border: 0.8px solid #C9CCC2; padding: 2mm 2.4mm; vertical-align: top; text-align: left;
  word-wrap: break-word; overflow-wrap: break-word; line-height: 1.45;
}
.ft-desc table th { background: #E7EAE2; font-weight: 700; }
.ft-desc table tbody tr:nth-child(even) { background: #FAFBF7; }
.ft-desc table p { margin: 0 0 1mm; }
.ft-desc table p:last-child { margin-bottom: 0; }
.ft-desc table ul, .ft-desc table ol { margin: 0 0 1mm; padding-left: 4.5mm; }
/* Resserrement progressif : un tableau large réduit sa typographie plutôt que de déborder.
   Les seuils sont plus hauts qu'en portrait, le paysage offrant 273 mm utiles. */
.ft-desc-serree table { font-size: 8.5px; }
.ft-desc-serree table th, .ft-desc-serree table td { padding: 1.1mm 1.4mm; }
.ft-desc-tres-serree table { font-size: 7.5px; }
.ft-desc-tres-serree table th, .ft-desc-tres-serree table td { padding: 0.8mm 1mm; }

img { max-width: 100%; }

/* --- Filigrane ----------------------------------------------------------------------------- */
/* Deux précautions valent mieux qu'une : l'encre est très pâle (3 %), et tous les tableaux ont
   un fond OPAQUE, si bien que le filigrane ne transparaît jamais derrière des chiffres. Il reste
   lisible sur les zones blanches, ce qui suffit à signaler un brouillon. Le statut figure en
   toutes lettres dans l'en-tête, qui est la mention qui fait foi. */
.filigrane {
  position: absolute; top: 50%; left: 0; width: 100%; text-align: center;
  font-size: 50px; font-weight: 700; letter-spacing: 12px;
  color: rgba(31,58,46,0.030); transform: translateY(-50%) rotate(-16deg);
  pointer-events: none; z-index: 0;
}
.page-corps, .page-entete, .page-pied { position: absolute; z-index: 1; }
`;

// ==============================================================================================
// Algorithme de répartition — exécuté DANS la fenêtre d'impression
// ==============================================================================================
// Injecté tel quel dans le document : il a besoin de mesurer des hauteurs réelles, ce qui n'est
// possible qu'une fois la page rendue, les polices chargées et les images décodées.
//
// Principe : on pose les blocs un par un dans la zone de contenu de la page courante et on
// regarde si elle déborde. Si oui, on retire le bloc et on ouvre une page. Trois raffinements
// font la différence entre une pagination correcte et une pagination acceptable :
//
//   - un bloc marqué « colle au suivant » (un titre de section, un sous-titre) ne reste jamais
//     seul en bas de page : il part avec le bloc qu'il introduit ;
//   - un tableau ou une liste trop grand n'est pas repoussé en entier, il est COUPÉ entre deux
//     lignes, et sa suite reprend page suivante avec son en-tête de colonnes et la mention
//     « (suite) » ;
//   - un dessin technique réclame sa propre page et y est agrandi au maximum, à proportions
//     strictement conservées.
const SCRIPT_PAGINATION = `
(function () {
  function mesurerDepassement(zone) {
    return zone.scrollHeight > zone.clientHeight + 0.5;
  }

  function texteNonVide(element) {
    return (element.textContent || "").trim() !== "";
  }

  window.paginerDossier = function paginerDossier() {
    var source = document.getElementById("source");
    var document_ = document.getElementById("document");
    if (!source || !document_) return { ok: false, raison: "conteneurs introuvables" };

    var modeleEntete = document.getElementById("modele-entete").innerHTML;
    var modelePied = document.getElementById("modele-pied").innerHTML;
    var filigrane = document.getElementById("modele-filigrane").innerHTML;

    var blocs = Array.prototype.slice.call(source.children);
    var zone = null;
    var pages = 0;

    function nouvellePage() {
      var page = document.createElement("div");
      page.className = "page";
      page.innerHTML =
        filigrane +
        '<div class="page-entete">' + modeleEntete + "</div>" +
        '<div class="page-corps"></div>' +
        '<div class="page-pied">' + modelePied + "</div>";
      document_.appendChild(page);
      pages++;
      return page.querySelector(".page-corps");
    }

    // Coupe un bloc contenant un tableau ou une liste entre deux lignes. Renvoie la partie qui
    // n'a pas tenu, ou null si le bloc n'est pas coupable.
    function couper(bloc, zoneCourante) {
      var conteneur = bloc.querySelector("tbody") || bloc.querySelector("ul, ol");
      if (!conteneur) return null;
      var estTableau = conteneur.tagName === "TBODY";
      var elements = estTableau
        ? Array.prototype.slice.call(conteneur.children)
        : Array.prototype.slice.call(conteneur.children);
      if (elements.length < 2) return null;

      var retirees = [];
      // On retire par la fin jusqu'à ce que la page accepte le reste. Il doit toujours rester au
      // moins une ligne, sinon la page suivante recevrait exactement le même problème.
      while (mesurerDepassement(zoneCourante) && conteneur.children.length > 1) {
        var dernier = conteneur.children[conteneur.children.length - 1];
        conteneur.removeChild(dernier);
        retirees.unshift(dernier);
      }
      if (retirees.length === 0) return null;
      if (mesurerDepassement(zoneCourante)) {
        // Même une seule ligne ne tient pas : on rend tout et on laisse l'appelant décider.
        for (var r = 0; r < retirees.length; r++) conteneur.appendChild(retirees[r]);
        return null;
      }

      var suite = bloc.cloneNode(true);
      var conteneurSuite = suite.querySelector("tbody") || suite.querySelector("ul, ol");
      while (conteneurSuite.firstChild) conteneurSuite.removeChild(conteneurSuite.firstChild);
      for (var i = 0; i < retirees.length; i++) conteneurSuite.appendChild(retirees[i]);

      // Une liste numérotée coupée doit CONTINUER sa numérotation. Sans cela, la suite
      // repartirait de 1 page suivante et l'on croirait à une nouvelle énumération — c'est
      // exactement le genre de détail qui fait douter d'un dossier d'atelier.
      if (conteneurSuite.tagName === "OL") {
        var depart = parseInt(conteneur.getAttribute("start") || "1", 10);
        if (!isFinite(depart) || depart < 1) depart = 1;
        conteneurSuite.setAttribute("start", depart + conteneur.children.length);
      }

      var libelleSuite = bloc.getAttribute("data-suite");
      if (libelleSuite) {
        var mention = document.createElement("div");
        mention.className = "mention-suite";
        mention.textContent = libelleSuite + " (suite)";
        suite.insertBefore(mention, suite.firstChild);
      }
      return suite;
    }

    // Dernier recours pour un bloc indivisible plus haut qu'une page : on réduit la typographie
    // par paliers, puis on laisse déborder visiblement. Jamais de troncature silencieuse.
    function ajusterOuLaisserDeborder(bloc, zoneCourante) {
      var paliers = [0.92, 0.84, 0.76, 0.68];
      for (var i = 0; i < paliers.length; i++) {
        bloc.style.zoom = paliers[i];
        if (!mesurerDepassement(zoneCourante)) return;
      }
      bloc.style.zoom = "";
      zoneCourante.parentNode.classList.add("deborde");
    }

    for (var b = 0; b < blocs.length; b++) {
      var bloc = blocs[b];

      // Dessin technique ou page de photos : sa propre page, toujours.
      if (bloc.getAttribute("data-page") === "pleine") {
        zone = nouvellePage();
        zone.appendChild(bloc);
        zone = null; // la page est close : le bloc suivant en ouvrira une autre
        continue;
      }

      // Chaque grand module ouvre une page. Règle volontairement stricte : un dossier d'atelier
      // se feuillette, et l'on doit pouvoir tomber sur « Matières » sans la chercher au milieu
      // d'un tableau de mesures. La page n'est pas ouverte si la courante est encore vierge,
      // sinon on fabriquerait une page blanche.
      if (bloc.getAttribute("data-nouvelle-page") === "1" && zone && zone.children.length > 0) {
        zone = nouvellePage();
      }

      if (!zone) zone = nouvellePage();
      zone.appendChild(bloc);
      if (!mesurerDepassement(zone)) continue;

      zone.removeChild(bloc);

      if (zone.children.length === 0) {
        // Le bloc est seul et déborde déjà : on tente la coupure, sinon la réduction.
        zone.appendChild(bloc);
        var resteSeul = couper(bloc, zone);
        while (resteSeul) {
          zone = nouvellePage();
          zone.appendChild(resteSeul);
          if (!mesurerDepassement(zone)) { resteSeul = null; break; }
          var suivant = couper(resteSeul, zone);
          if (!suivant) { ajusterOuLaisserDeborder(resteSeul, zone); break; }
          resteSeul = suivant;
        }
        continue;
      }

      // Un titre qui précède et qui doit rester collé part avec son bloc. La boucle peut vider
      // entièrement la page : c'est voulu. Le cas se présente dès qu'un module ouvre une page
      // (bandeau), pose son sous-titre, puis découvre que son tableau ne tient pas — bandeau et
      // sous-titre doivent alors suivre, et la page restée vide est supprimée plus bas. Un
      // garde-fou qui l'interdirait laisserait précisément le bandeau seul sur sa page.
      var aEmporter = [];
      var dernierPose = zone.children[zone.children.length - 1];
      while (dernierPose && dernierPose.getAttribute && dernierPose.getAttribute("data-colle") === "suivant") {
        zone.removeChild(dernierPose);
        aEmporter.unshift(dernierPose);
        dernierPose = zone.children[zone.children.length - 1];
      }

      // Tentative de coupure sur la page courante : un long tableau doit commencer ici plutôt
      // que de laisser un grand vide.
      var reste = null;
      if (aEmporter.length === 0) {
        zone.appendChild(bloc);
        reste = couper(bloc, zone);
        if (!reste) zone.removeChild(bloc);
      }

      var aPlacer = reste ? [reste] : aEmporter.concat([bloc]);
      zone = nouvellePage();
      for (var p = 0; p < aPlacer.length; p++) zone.appendChild(aPlacer[p]);

      while (mesurerDepassement(zone)) {
        var dernierBloc = zone.children[zone.children.length - 1];
        var suite = couper(dernierBloc, zone);
        if (!suite) { ajusterOuLaisserDeborder(dernierBloc, zone); break; }
        zone = nouvellePage();
        zone.appendChild(suite);
      }
    }

    // Une page de garde vide ne doit jamais subsister (document sans aucun contenu).
    var toutes = Array.prototype.slice.call(document_.querySelectorAll(".page"));
    for (var t = toutes.length - 1; t >= 0; t--) {
      var corps = toutes[t].querySelector(".page-corps");
      if (corps && corps.children.length === 0) { toutes[t].remove(); toutes.splice(t, 1); }
    }

    // Agrandissement des dessins : à proportions strictement conservées, et calculé APRÈS la
    // mise en page, quand la zone de contenu a sa taille définitive. Les annotations sont
    // positionnées en pourcentages, donc elles suivent exactement l'image.
    var cadres = document_.querySelectorAll(".croquis-cadre");
    for (var c = 0; c < cadres.length; c++) {
      var cadre = cadres[c];
      var image = cadre.querySelector("img");
      if (!image || !image.naturalWidth || !image.naturalHeight) continue;
      var zoneCroquis = cadre.closest(".croquis-zone");
      if (!zoneCroquis) continue;
      var legende = zoneCroquis.querySelector(".croquis-legende");
      var hauteurLegende = legende ? legende.getBoundingClientRect().height + 10 : 0;
      var dispoL = zoneCroquis.clientWidth;
      var dispoH = zoneCroquis.clientHeight - hauteurLegende;
      if (dispoL <= 0 || dispoH <= 0) continue;
      var facteur = Math.min(dispoL / image.naturalWidth, dispoH / image.naturalHeight);
      cadre.style.width = (image.naturalWidth * facteur) + "px";
      cadre.style.height = (image.naturalHeight * facteur) + "px";
    }

    // ------------------------------------------------------------------------------------
    // Sommaire
    // ------------------------------------------------------------------------------------
    // Il ne peut être construit qu'ICI, et c'est tout l'intérêt : les numéros de page ne sont
    // connus qu'une fois le contenu réparti. On relève donc les sections sur les pages déjà
    // posées, on fabrique les pages de sommaire, puis on les insère EN TÊTE — ce qui décale
    // tout le contenu d'autant de pages, décalage reporté sur les numéros annoncés.
    //
    // Le nombre de pages de sommaire ne dépend que du NOMBRE d'entrées, jamais des chiffres
    // qu'elles portent : on peut donc les composer d'abord, les compter, puis inscrire les
    // numéros. Aucune itération, aucun risque de ne pas converger.
    var entrees = [];
    for (var pg = 0; pg < toutes.length; pg++) {
      var reperes = toutes[pg].querySelectorAll("[data-sommaire], [data-sommaire-sous]");
      for (var rp = 0; rp < reperes.length; rp++) {
        var repere = reperes[rp];
        var principal = repere.getAttribute("data-sommaire");
        var secondaire = repere.getAttribute("data-sommaire-sous");
        // Un même bloc peut porter les deux : la première page des dessins ouvre le module ET
        // constitue la première vue listée en dessous.
        if (principal) entrees.push({ libelle: principal, sous: false, ancre: repere.id || "", page: pg });
        if (secondaire) entrees.push({ libelle: secondaire, sous: true, ancre: repere.id || "", page: pg });
      }
    }

    var nbPagesSommaire = 0;
    if (entrees.length > 0) {
      var pagesSommaire = [];
      var zoneSommaire = null;
      var lignes = [];

      var nouvellePageSommaire = function () {
        var page = document.createElement("div");
        page.className = "page";
        page.innerHTML =
          filigrane +
          '<div class="page-entete">' + modeleEntete + "</div>" +
          '<div class="page-corps"></div>' +
          '<div class="page-pied">' + modelePied + "</div>";
        pagesSommaire.push(page);
        return page.querySelector(".page-corps");
      };

      zoneSommaire = nouvellePageSommaire();
      var enTeteSommaire = document.createElement("div");
      enTeteSommaire.className = "bloc";
      enTeteSommaire.innerHTML =
        '<div class="som-titre">Sommaire</div>' +
        '<div class="som-sous">Dossier technique de confection — sections et pages</div>';
      zoneSommaire.appendChild(enTeteSommaire);

      for (var e = 0; e < entrees.length; e++) {
        var entree = entrees[e];
        var ligne = document.createElement(entree.ancre ? "a" : "div");
        ligne.className = "bloc som-ligne" + (entree.sous ? " sous" : "");
        if (entree.ancre) ligne.setAttribute("href", "#" + entree.ancre);
        var lib = document.createElement("span");
        lib.className = "lib";
        lib.textContent = entree.libelle;
        var pts = document.createElement("span");
        pts.className = "pts";
        var pgSpan = document.createElement("span");
        pgSpan.className = "pg";
        ligne.appendChild(lib);
        ligne.appendChild(pts);
        ligne.appendChild(pgSpan);

        zoneSommaire.appendChild(ligne);
        if (mesurerDepassement(zoneSommaire)) {
          zoneSommaire.removeChild(ligne);
          zoneSommaire = nouvellePageSommaire();
          zoneSommaire.appendChild(ligne);
        }
        lignes.push({ span: pgSpan, page: entree.page });
      }

      nbPagesSommaire = pagesSommaire.length;
      for (var l = 0; l < lignes.length; l++) {
        lignes[l].span.textContent = String(lignes[l].page + nbPagesSommaire + 1);
      }
      for (var s = pagesSommaire.length - 1; s >= 0; s--) {
        document_.insertBefore(pagesSommaire[s], document_.firstChild);
      }
      toutes = Array.prototype.slice.call(document_.querySelectorAll(".page"));
    }

    // Numérotation : le total n'est connu qu'ici, une fois toutes les pages posées.
    var total = toutes.length;
    for (var n = 0; n < toutes.length; n++) {
      var numero = toutes[n].querySelector(".pied-numero");
      if (numero) numero.textContent = "Page " + (n + 1) + " / " + total;
    }

    source.remove();
    return { ok: true, pages: total, pagesSommaire: nbPagesSommaire, entrees: entrees.length };
  };
})();
`;

// ==============================================================================================
// Construction des blocs
// ==============================================================================================

function bloc(contenu, options) {
  const o = options || {};
  const attributs = [];
  if (o.id) attributs.push(`id="${esc(o.id)}"`);
  if (o.pleinePage) attributs.push('data-page="pleine"');
  if (o.nouvellePage) attributs.push('data-nouvelle-page="1"');
  if (o.colleSuivant) attributs.push('data-colle="suivant"');
  if (o.suite) attributs.push(`data-suite="${esc(o.suite)}"`);
  // Repères du sommaire : relevés après la mise en pages, quand le numéro de page est connu.
  if (o.sommaire) attributs.push(`data-sommaire="${esc(o.sommaire)}"`);
  if (o.sommaireSous) attributs.push(`data-sommaire-sous="${esc(o.sommaireSous)}"`);
  attributs.push(`class="bloc${o.classe ? " " + o.classe : ""}${o.sansEspace ? "" : " bloc-espace"}"`);
  return `<div ${attributs.join(" ")}>${contenu}</div>`;
}

// Les GRANDS modules sont numérotés en chiffres romains ; la numérotation rédigée à l'intérieur
// de la description reste en chiffres arabes et appartient à l'auteur. Deux systèmes distincts,
// donc aucune confusion possible entre « II. Description technique » et le « 2. Dimensions et
// caractéristiques » écrit dans l'éditeur.
const ROMAINS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"];
function romain(n) {
  return ROMAINS[n] || String(n);
}

/**
 * Bandeau d'un grand module. Il ouvre une page, s'inscrit au sommaire et sert d'ancre au lien
 * cliquable. Les trois rôles tiennent dans ce seul endroit, ce qui évite qu'un module apparaisse
 * dans le sommaire sans commencer une page, ou l'inverse.
 */
function titreModule(index, libelle, libelleSommaire) {
  return bloc(`<div class="section-titre">${romain(index)}. ${esc(libelle)}</div>`, {
    colleSuivant: true, sansEspace: true, nouvellePage: true,
    id: "sec-" + index,
    sommaire: romain(index) + ". " + (libelleSommaire || libelle),
  });
}

function buildEntete(fiche, article, entreprise) {
  const logo = entreprise && entreprise.logo_path
    ? `<img src="${mediaUrl(entreprise.logo_path)}" alt="" class="ent-logo" />`
    : `<div class="ent-nom">${esc((entreprise && entreprise.nom_commercial) || "Belvie")}</div>`;

  return `
    <div class="ent-marque">${logo}</div>
    <div class="ent-titre-bloc">
      <div class="ent-titre">Fiche technique</div>
      <div class="ent-ref">${esc(article.reference_principale || "Référence à compléter")}</div>
    </div>
    <div class="ent-infos">
      <div class="k">Article :</div><div class="v">${esc(article.designation || article.produit || "—")}</div>
      <div class="k">Révision :</div><div class="v accent">${esc(REVISION_PAR_DEFAUT)}</div>
      <div class="k">Saison :</div><div class="v">${esc(article.saison || "—")}</div>
      <div class="k">Statut :</div><div class="v">${esc(FT_STATUT_LABELS[fiche.statut] || fiche.statut)}</div>
      <div class="k">Genre :</div><div class="v">${esc(article.rayon || "—")}</div>
      <div class="k">Date :</div><div class="v">${fmtDate(fiche.updated_at || fiche.created_at)}</div>
    </div>`;
}

function buildPied(entreprise) {
  const identite = entreprise
    ? [
        entreprise.raison_sociale,
        [entreprise.adresse, [entreprise.code_postal, entreprise.ville].filter(Boolean).join(" "), entreprise.pays].filter(Boolean).join(", "),
        entreprise.telephone,
        entreprise.email,
      ].filter(Boolean).join(" • ")
    : "";
  return `
    <div class="pied-societe">${esc(identite)}</div>
    <div class="pied-numero">Page</div>`;
}

// --- Photos produit -----------------------------------------------------------------------
function buildPhotosBloc(article, moduleVisuels, nbCroquis) {
  const photos = (article.photos || []).filter((p) => p && (p.photo_path || p.photo_thumb_path));
  if (photos.length === 0) return "";
  const principale = photos.find((p) => p.est_principale) || photos[0];
  const autres = photos.filter((p) => p !== principale).slice(0, 6);
  // Sans aucun dessin, c'est cette page qui ouvre le module des visuels.
  const ouvreLeModule = nbCroquis === 0;

  return bloc(`
    <div class="section-titre">${romain(moduleVisuels)}. Dessins techniques — Photo produit et détails</div>
    <div class="photos-grille${autres.length === 0 ? " seule" : ""}">
      <div class="photo-principale"><img src="${mediaUrl(principale.photo_path || principale.photo_thumb_path)}" alt="" /></div>
      ${autres.length > 0 ? `<div class="photos-secondaires">${autres.map((p) =>
        `<div class="photo-vignette"><img src="${mediaUrl(p.photo_path || p.photo_thumb_path)}" alt="" /></div>`).join("")}</div>` : ""}
    </div>`, {
    pleinePage: true, sansEspace: true,
    id: "sec-" + moduleVisuels + (ouvreLeModule ? "" : "-photo"),
    sommaire: ouvreLeModule ? romain(moduleVisuels) + ". Dessins techniques et photographies" : undefined,
    sommaireSous: "Photo produit et détails",
  });
}

// --- Description technique ------------------------------------------------------------------
function classeDensite(b) {
  const colonnes = compterColonnes(b);
  if (colonnes >= 13) return " ft-desc-tres-serree";
  if (colonnes >= 9) return " ft-desc-serree";
  return "";
}

// Un bloc par élément de premier niveau : c'est ce découpage qui permet à l'algorithme de
// répartition de savoir où une page se termine, et donc de ne jamais couper un titre de son
// premier paragraphe ni laisser une puce seule.
function buildDescriptionBlocs(descriptionHtml, numero) {
  const assainie = assainirDescription(descriptionHtml);
  if (!assainie) return "";
  const blocs = decouperEnBlocs(assainie);
  if (blocs.length === 0) return "";

  return titreModule(numero, "Description technique") + blocs.map((b, index) => {
    const estTitre = /^\s*<h[23]\b/i.test(b);
    return bloc(`<div class="ft-desc${index === 0 ? " premier" : ""}${classeDensite(b)}">${b}</div>`, {
      colleSuivant: estTitre,
      sansEspace: true,
      classe: "desc-bloc",
      // Les blocs sécables (tableau, liste) annoncent leur reprise page suivante.
      suite: (blocEstTableau(b) || /^\s*<[ou]l\b/i.test(b)) ? "Description technique" : undefined,
    });
  }).join("");
}

// --- Mesures ---------------------------------------------------------------------------------
function buildMesuresBloc(grille, numero) {
  const lignes = (grille && grille.lignes) || [];
  const tailles = (grille && grille.tailles) || [];
  if (lignes.length === 0 || tailles.length === 0) return "";
  const valeur = (mesureId, ftTailleId) =>
    (grille.valeurs || []).find((v) => v.mesure_catalogue_id === mesureId && v.ft_taille_id === ftTailleId)?.valeur ?? "—";

  const entetes = tailles.map((t) => `<th>${esc(t.nom)}</th>`).join("");
  const corps = lignes.map((l) => {
    const tol = l.tolerance_plus || l.tolerance_moins ? `±${l.tolerance_plus || l.tolerance_moins}` : "—";
    const cellules = tailles.map((t) => `<td>${esc(valeur(l.id, t.id))}</td>`).join("");
    return `<tr><td>${esc(l.repere || "—")}</td><td class="g">${esc(l.nom)}</td>${cellules}<td>${esc(tol)}</td></tr>`;
  }).join("");

  return titreModule(numero, "Tableau de mesures (en cm)", "Tableau des mesures") + bloc(`
    <table class="t-donnees">
      <thead><tr><th>Repère</th><th class="g">Mesure</th>${entetes}<th>Tolérance</th></tr></thead>
      <tbody>${corps}</tbody>
    </table>`, { suite: "Tableau de mesures" });
}

// --- Matières et coloris ---------------------------------------------------------------------
function buildMatieresBlocs(matieres, numero) {
  if (!matieres || matieres.length === 0) return "";

  const corps = matieres.map((m) => `
    <tr>
      <td class="g">${esc(m.nom)}</td>
      <td class="g">${esc(m.utilisation || "—")}</td>
      <td class="g">${esc(m.composition || "—")}</td>
      <td class="n">${m.grammage ? esc(m.grammage) + " g/m²" : "—"}</td>
      <td class="n">${num(m.consommation_technique)} ${esc(m.unite)}</td>
      <td class="n">${num(m.perte_pourcent)} %</td>
      <td class="n"><strong>${budgetee(m.consommation_technique, m.perte_pourcent)} ${esc(m.unite)}</strong></td>
    </tr>`).join("");

  let sortie = titreModule(numero, "Matières", "Matières et coloris") + bloc(`
    <table class="t-donnees">
      <thead><tr><th class="g">Matière</th><th class="g">Utilisation</th><th class="g">Composition</th><th class="n">Grammage</th><th class="n">Conso. technique</th><th class="n">Perte</th><th class="n">Conso. budgétée</th></tr></thead>
      <tbody>${corps}</tbody>
    </table>`, { suite: "Matières" });

  const coloris = matieres.flatMap((m) => (m.couleurs || []).map((c) => `
    <tr>
      <td class="g">${esc(m.nom)}</td>
      <td class="g">${esc(c.couleur_produit_nom)}</td>
      <td class="g">${esc(c.matiere_couleur_libelle || "—")}</td>
      <td class="g">${esc(c.matiere_couleur_reference || "—")}</td>
    </tr>`)).join("");

  if (coloris) {
    sortie += bloc('<div class="sous-titre">Correspondance des coloris</div>', { colleSuivant: true, sansEspace: true }) +
      bloc(`
        <table class="t-donnees">
          <thead><tr><th class="g">Matière</th><th class="g">Couleur produit</th><th class="g">Coloris matière</th><th class="g">Référence</th></tr></thead>
          <tbody>${coloris}</tbody>
        </table>`, { suite: "Correspondance des coloris" });
  }
  return sortie;
}

// --- Nomenclature ----------------------------------------------------------------------------
// Les variables, les fonctions et la table en base gardent le nom « fournitures » : ce sont des
// identifiants internes. Seul le libellé imprimé change.
function buildNomenclatureBlocs(fournitures, numero) {
  if (!fournitures || fournitures.length === 0) return "";
  const habillage = fournitures.filter((f) => f.famille === "habillage");
  const composants = fournitures.filter((f) => f.famille === "composant");

  let sortie = titreModule(numero, "Nomenclature (fournitures, accessoires et branding)", "Nomenclature");

  if (composants.length > 0) {
    sortie += bloc('<div class="sous-titre">Composants de confection</div>', { colleSuivant: true, sansEspace: true }) +
      bloc(`
        <table class="t-donnees">
          <thead><tr><th class="g">Désignation</th><th class="g">Utilisation</th><th class="g">Couleur</th><th>Taille / Dim.</th><th class="g">Référence</th><th class="n">Conso. / pièce</th></tr></thead>
          <tbody>${composants.map((f) => `
            <tr>
              <td class="g">${esc(f.nom)}</td>
              <td class="g">${esc(f.emplacement || "—")}</td>
              <td class="g">${esc(f.couleur || "—")}</td>
              <td>${esc(f.taille_dimension || "—")}</td>
              <td class="g">${esc(f.reference || "—")}</td>
              <td class="n">${f.consommation_par_piece != null ? num(f.consommation_par_piece) + " " + esc(f.unite || "") : "—"}</td>
            </tr>`).join("")}</tbody>
        </table>`, { suite: "Composants de confection" });
  }

  if (habillage.length > 0) {
    sortie += bloc('<div class="sous-titre">Habillage &amp; Branding</div>', { colleSuivant: true, sansEspace: true }) +
      bloc(`
        <table class="t-donnees">
          <thead><tr><th class="g">Désignation</th><th class="g">Référence</th><th class="n">Conso. / pièce</th></tr></thead>
          <tbody>${habillage.map((f) => `
            <tr>
              <td class="g">${esc(f.nom)}</td>
              <td class="g">${esc(f.reference || "—")}</td>
              <td class="n">${f.consommation_par_piece != null ? num(f.consommation_par_piece) + " " + esc(f.unite || "") : "—"}</td>
            </tr>`).join("")}</tbody>
        </table>`, { suite: "Habillage et Branding" });
  }

  return sortie;
}

// --- Identification et notes ------------------------------------------------------------------
function buildIdentificationBloc(article, fiche, numero) {
  const champs = [
    ["Catégorie", article.categorie],
    ["Type d'article", article.produit],
    ["Coupe", fiche.coupe_nom],
    ["Saison", article.saison],
    ["Collection", article.annee_collection],
    ["Genre / Univers", article.rayon],
  ];
  if (champs.every(([, v]) => !v)) return "";
  return titreModule(numero, "Identification de l'article") + bloc(`
    <div class="champs-grille">
      ${champs.map(([k, v]) => `<div><div class="champ-k">${esc(k)}</div><div class="champ-v">${esc(v || "—")}</div></div>`).join("")}
    </div>`);
}

function buildNotesBloc(notes, numero) {
  if (!notes) return "";
  return titreModule(numero, "Notes générales") +
    bloc(`<div class="notes-cadre"><div class="notes-texte">${esc(notes)}</div></div>`);
}

// ==============================================================================================
// Document
// ==============================================================================================
/**
 * Ordre du dossier : dessins techniques d'abord (une page chacun), puis la photo produit, puis
 * la description, les mesures, les matières et coloris, la nomenclature, l'identification et les
 * notes. Une section sans contenu est entièrement omise — un document d'atelier ne doit pas être
 * rempli de tirets.
 *
 * La numérotation des sections est calculée sur les sections RÉELLEMENT présentes : il n'y a
 * jamais de trou dans la suite, quel que soit l'état de remplissage de la fiche.
 */
function buildFicheTechniqueHtml(fiche, article, entreprise) {
  let n = 0;
  const suivant = () => ++n;

  const morceaux = [];

  // I — Dessins techniques et photographies. UN SEUL module, même s'il occupe plusieurs pages :
  // le sommaire annonce le module à sa première page, puis liste les vues disponibles en
  // sous-entrées. C'est ainsi qu'on lit un dossier : on cherche « les dessins », puis la vue.
  const croquis = (fiche.croquis || []).filter((c) => c && c.image_path);
  const photos = (article.photos || []).filter((p) => p && (p.photo_path || p.photo_thumb_path));
  const moduleVisuels = croquis.length > 0 || photos.length > 0 ? suivant() : 0;

  croquis.forEach((c, index) => {
    const visibles = (c.annotations || []).filter((a) => a.visible_impression);
    const traits = visibles.map((a) =>
      `<line x1="${pourcent(a.label_x)}" y1="${pourcent(a.label_y)}" x2="${pourcent(a.ancre_x)}" y2="${pourcent(a.ancre_y)}" stroke="${esc(a.couleur || "#1A1A1A")}" stroke-width="${a.epaisseur || 1}" vector-effect="non-scaling-stroke" />`).join("");
    const etiquettes = visibles.map((a) =>
      `<div class="annotation" style="left:${pourcent(a.label_x)}%;top:${pourcent(a.label_y)}%;border-color:${esc(a.couleur || "#1A1A1A")}">${esc(a.texte)}</div>`).join("");
    const libelle = c.vue === "autre" ? (c.vue_personnalisee || "Autre vue") : (VUE_LABELS[c.vue] || "Vue");

    morceaux.push(bloc(`
      <div class="section-titre">${romain(moduleVisuels)}. ${esc("Dessins techniques — " + libelle)}</div>
      <div class="croquis-zone">
        <div class="croquis-cadre">
          <img src="${mediaUrl(c.image_path)}" alt="" />
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" style="position:absolute;inset:0;width:100%;height:100%">${traits}</svg>
          ${etiquettes}
        </div>
        ${c.legende ? `<div class="croquis-legende">${esc(c.legende)}</div>` : ""}
      </div>`, {
      pleinePage: true, sansEspace: true,
      id: "sec-" + moduleVisuels + (index === 0 ? "" : "-" + (index + 1)),
      // Seule la première vue porte l'entrée principale du sommaire ; les autres sont des
      // sous-entrées, décalées et en caractères plus légers.
      sommaire: index === 0 ? romain(moduleVisuels) + ". Dessins techniques et photographies" : undefined,
      sommaireSous: libelle,
    }));
  });

  const photosBloc = buildPhotosBloc(article, moduleVisuels, croquis.length);
  if (photosBloc) morceaux.push(photosBloc);

  const description = buildDescriptionBlocs(fiche.description_technique, n + 1);
  if (description) { suivant(); morceaux.push(description); }

  const mesures = buildMesuresBloc(fiche.grille, n + 1);
  if (mesures) { suivant(); morceaux.push(mesures); }

  const matieres = buildMatieresBlocs(fiche.matieres, n + 1);
  if (matieres) { suivant(); morceaux.push(matieres); }

  const nomenclature = buildNomenclatureBlocs(fiche.accessoires, n + 1);
  if (nomenclature) { suivant(); morceaux.push(nomenclature); }

  const identification = buildIdentificationBloc(article, fiche, n + 1);
  if (identification) { suivant(); morceaux.push(identification); }

  const notes = buildNotesBloc(fiche.notes, n + 1);
  if (notes) { suivant(); morceaux.push(notes); }

  const filigrane = fiche.statut === "brouillon" ? '<div class="filigrane">BROUILLON</div>' : "";

  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><title>Fiche technique</title><style>${CSS}</style></head>
<body>
  <div class="modele" id="modele-entete">${buildEntete(fiche, article, entreprise)}</div>
  <div class="modele" id="modele-pied">${buildPied(entreprise)}</div>
  <div class="modele" id="modele-filigrane">${filigrane}</div>
  <div id="source">${morceaux.join("")}</div>
  <div id="document"></div>
  <script>${SCRIPT_PAGINATION}<\/script>
</body>
</html>`;
}

// ==============================================================================================
// Impression
// ==============================================================================================
/**
 * Fenêtre dédiée, invisible : le document n'est pas une capture de l'écran et ne dépend ni de la
 * taille de la fenêtre principale, ni de ce qui y est affiché.
 *
 * L'ordre des opérations compte : charger, ATTENDRE les polices et les images (sans quoi les
 * mesures de hauteur seraient fausses et les dessins mal agrandis), répartir, puis imprimer.
 */
async function genererPdfDepuisFenetreDediee(html, outputPath) {
  // Chargé ici et non en tête de fichier : la construction du document (buildFicheTechniqueHtml)
  // ne dépend ainsi d'aucun module Electron et reste vérifiable hors de l'application.
  const { BrowserWindow } = require("electron");

  const printWindow = new BrowserWindow({
    show: false,
    width: 1123,
    height: 794,
    useContentSize: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    await printWindow.webContents.executeJavaScript(`
      Promise.all([
        document.fonts.ready,
        ...Array.from(document.images).map((image) => {
          if (image.complete) return Promise.resolve();
          return new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          });
        })
      ])
    `);

    const resultat = await printWindow.webContents.executeJavaScript("window.paginerDossier()");
    if (!resultat || !resultat.ok) {
      throw new Error("Mise en pages du dossier impossible : " + ((resultat && resultat.raison) || "cause inconnue"));
    }

    const pdfBuffer = await printWindow.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      landscape: true,
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
    });

    await fs.writeFile(outputPath, pdfBuffer);
    return { pages: resultat.pages };
  } finally {
    if (!printWindow.isDestroyed()) printWindow.destroy();
  }
}

module.exports = { buildFicheTechniqueHtml, genererPdfDepuisFenetreDediee, SCRIPT_PAGINATION };
