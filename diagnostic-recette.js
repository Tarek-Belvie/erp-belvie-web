// ================================================================================================
// POURQUOI CETTE PRODUCTION N'UTILISE-T-ELLE PAS LA FICHE CORRIGÉE ?
// ================================================================================================
//
// Outil de DIAGNOSTIC. Il ne corrige rien, ne fige rien, n'actualise rien.
//
// La base est ouverte en LECTURE SEULE : SQLite refuse lui-même toute écriture, la garantie ne
// dépend donc pas de ce que ce fichier fait ensuite. Il écrit un seul fichier, son rapport, dans
// le dossier du projet.
//
// Il répond à une question précise : pour une production donnée, le calcul des besoins part-il
// de la recette FIGÉE au moment où la fiche a été rouverte, ou de la fiche TELLE QU'ELLE EST
// AUJOURD'HUI ? Et, dans le premier cas, qu'est-ce qui a changé entre les deux.
//
// Lancement :  npm run diagnostic:recette CMD-2026-047      (une production)
//              npm run diagnostic:recette -- --toutes        (l'inventaire de toutes)

const fs = require("fs");
const path = require("path");

function dossierDonnees() {
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "belvie-erp");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "belvie-erp");
  }
  return path.join(process.env.HOME || "", ".config", "belvie-erp");
}

function ouvrir(chemin) {
  try {
    const Database = require("better-sqlite3");
    return new Database(chemin, { readonly: true, fileMustExist: true });
  } catch (_) {
    const { DatabaseSync } = require("node:sqlite");
    return new DatabaseSync(chemin, { readOnly: true });
  }
}

function tableExiste(db, nom) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom);
}

const lignes = [];
function L(t) { lignes.push(t == null ? "" : String(t)); console.log(t == null ? "" : String(t)); }
function titre(t) { L(""); L(t); L("-".repeat(Math.max(10, t.length))); }

function n(v) {
  if (v == null || v === "") return "(vide)";
  return String(v).replace(".", ",");
}

/** Les champs d'un composant qui changent le RÉSULTAT du calcul. Comparer tout l'objet ferait
 *  apparaître des différences sans conséquence (un identifiant, un ordre d'affichage) et noierait
 *  celles qui comptent. */
function empreinteComposant(c) {
  return {
    "unité": c.unite,
    "consommation de base": c.consommation_base != null ? c.consommation_base : c.consommation_par_piece,
    "mode de consommation": c.mode_consommation || "(non renseigné)",
    "perte %": c.perte_pourcent || 0,
    "lié au catalogue": c.catalogue_id != null ? "oui" : "NON",
    "consommations par taille": Object.keys(c.consommations_taille || {}).length,
    "correspondances de couleur": Object.keys(c.couleurs || {}).length,
    "hors approvisionnement": c.hors_approvisionnement ? "oui" : "non",
  };
}

/**
 * Inventaire : quelles productions ont une référence technique figée, et lesquelles n'en ont pas.
 *
 * C'est la question à laquelle il faut répondre AVANT de décider du sort des productions
 * historiques : « combien sont concernées » n'est pas une opinion.
 */
function inventaire(db, sortie) {
  const DECIDEES = ["validee", "en_production", "controle_qualite", "terminee"];
  const rows = db.prepare(`
    SELECT c.id, c.numero, c.statut, c.quantite_totale,
           COALESCE(a.designation, '?') AS article,
           f.id AS fiche_id, f.statut AS fiche_statut, f.revision AS fiche_revision,
           r.fiche_revision AS figee_revision, r.figee_le, r.figee_motif
      FROM commandes c
      LEFT JOIN articles a ON a.id = c.article_id
      LEFT JOIN fiches_techniques f ON f.article_id = c.article_id AND f.archived_at IS NULL
      LEFT JOIN commandes_recette_figee r ON r.commande_id = c.id
     WHERE c.deleted_at IS NULL AND c.statut IN (${DECIDEES.map(() => "?").join(",")})
     ORDER BY c.statut, c.id
  `).all(...DECIDEES);

  L("INVENTAIRE DES RÉFÉRENCES TECHNIQUES — "
    + new Date().toISOString().slice(0, 16).replace("T", " "));
  L("Lecture seule. Aucune production n'est modifiée, aucune référence n'est figée.");
  L("");
  L("Productions décidées (validée, en production, contrôle qualité, terminée) : " + rows.length);
  L("");

  const sansReference = rows.filter((r) => r.figee_revision == null);
  const enRetard = rows.filter((r) => r.figee_revision != null && r.fiche_revision != null
    && Number(r.figee_revision) !== Number(r.fiche_revision));
  const aJour = rows.length - sansReference.length - enRetard.length;

  L("  SANS référence figée (suivent la fiche actuelle) : " + sansReference.length);
  L("  Figées et À JOUR avec la révision en vigueur      : " + aJour);
  L("  Figées et EN RETARD d'au moins une révision       : " + enRetard.length);
  L("");
  L("  " + "Production".padEnd(18) + "Statut".padEnd(18) + "Référence".padEnd(16)
    + "Révision".padEnd(18) + "Article");
  L("  " + "-".repeat(100));
  rows.forEach((r) => {
    const retard = r.figee_revision != null && r.fiche_revision != null
      && Number(r.figee_revision) !== Number(r.fiche_revision);
    const ref = r.figee_revision == null ? "AUCUNE" : (retard ? "EN RETARD" : "figée, à jour");
    const rev = r.figee_revision == null
      ? "suit la fiche " + (r.fiche_revision != null ? r.fiche_revision : "?")
      : r.figee_revision + " / " + (r.fiche_revision != null ? r.fiche_revision : "?");
    L("  " + String(r.numero || r.id).padEnd(18) + String(r.statut).padEnd(18)
      + ref.padEnd(16) + rev.padEnd(18) + String(r.article).slice(0, 26));
  });

  L("");
  L("Lecture de la colonne « Révision » : pour une production figée, « 1 / 2 » signifie");
  L("référence figée issue de la révision 1, fiche aujourd'hui en révision 2.");
  L("");
  if (sansReference.length > 0) {
    L("Les " + sansReference.length + " production(s) sans référence figée sont celles dont le sort");
    L("doit être décidé : elles suivent aujourd'hui la fiche, et changeront donc si la fiche change.");
    L("");
  }
  fs.writeFileSync(sortie, lignes.join("\r\n"), "utf-8");
  L("Rapport écrit dans : " + path.resolve(sortie));
  L("");
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((a) => /^--?toutes$/i.test(a))) {
    const base0 = path.join(dossierDonnees(), "belvie.db");
    if (!fs.existsSync(base0)) throw new Error("Base de données introuvable : " + base0);
    const db0 = ouvrir(base0);
    if (!tableExiste(db0, "commandes_recette_figee")) {
      throw new Error("La table des recettes figées n'existe pas : base non migrée.");
    }
    inventaire(db0, "inventaire-references-techniques.txt");
    try { db0.close(); } catch (_) {}
    return;
  }
  const recherche = (process.argv[2] || "").trim();
  const sortie = process.argv[3] || "diagnostic-recette.txt";
  if (!recherche) {
    console.error("");
    console.error("  Indiquez le numéro de la production. Exemple :");
    console.error("      npm run diagnostic:recette CMD-2026-047");
    console.error("");
    process.exit(1);
  }

  const base = path.join(dossierDonnees(), "belvie.db");
  if (!fs.existsSync(base)) throw new Error("Base de données introuvable : " + base);
  const db = ouvrir(base);

  L("DIAGNOSTIC DE RECETTE TECHNIQUE — " + new Date().toISOString().slice(0, 16).replace("T", " "));
  L("Base lue en lecture seule : " + base);
  L("Aucune écriture, aucune correction, aucune actualisation.");

  // --- La production ---------------------------------------------------------------------------
  const cmd = db.prepare(`
    SELECT c.id, c.numero, c.statut, c.quantite_totale, c.article_id, c.updated_at,
           a.designation AS article, a.reference_principale AS article_ref
      FROM commandes c LEFT JOIN articles a ON a.id = c.article_id
     WHERE (c.numero = ? OR CAST(c.id AS TEXT) = ?) AND c.deleted_at IS NULL
  `).get(recherche, recherche);
  if (!cmd) throw new Error("Production introuvable : " + recherche);

  titre("1. LA PRODUCTION");
  L("  Numéro        : " + cmd.numero + "   (id " + cmd.id + ")");
  L("  Article       : " + (cmd.article || "?") + "  " + (cmd.article_ref || ""));
  L("  Statut        : " + cmd.statut);
  L("  Quantité      : " + cmd.quantite_totale + " pièces");

  // --- La fiche technique ----------------------------------------------------------------------
  const fiche = db.prepare(`
    SELECT id, statut, revision, revision_motif, validated_at
      FROM fiches_techniques WHERE article_id = ? AND archived_at IS NULL
     ORDER BY id DESC LIMIT 1
  `).get(cmd.article_id);

  titre("2. LA FICHE TECHNIQUE DE CET ARTICLE");
  if (!fiche) {
    L("  AUCUNE fiche technique : il n'y a rien à calculer, et rien à actualiser.");
  } else {
    L("  Fiche         : id " + fiche.id);
    L("  Statut        : " + fiche.statut);
    L("  Révision      : " + fiche.revision);
    L("  Validée le    : " + (fiche.validated_at || "(pas validée actuellement)"));
    if (fiche.revision_motif) L("  Motif de la dernière réouverture : " + fiche.revision_motif);
    if (fiche.statut === "brouillon") {
      L("");
      L("  ATTENTION : la fiche est en BROUILLON. Vos corrections sont enregistrées, mais la");
      L("  fiche n'a pas été revalidée. Le numéro de révision n'avance qu'à la revalidation.");
    }
  }

  // --- La recette utilisée par le calcul -------------------------------------------------------
  const figee = tableExiste(db, "commandes_recette_figee")
    ? db.prepare("SELECT * FROM commandes_recette_figee WHERE commande_id = ?").get(cmd.id)
    : null;

  titre("3. D'OÙ PART LE CALCUL DES BESOINS  (la réponse à votre question)");
  if (!figee) {
    L("  SOURCE : LA FICHE TECHNIQUE ACTUELLE.");
    L("  Cette production n'a pas de recette figée : elle suit les évolutions de la fiche.");
    L("");
    L("  => Si des anomalies subsistent, elles ne viennent PAS du figeage. Voir le § 5 :");
    L("     les valeurs que le moteur lit réellement y sont imprimées une par une.");
  } else {
    L("  SOURCE : LA RECETTE FIGÉE SUR CETTE PRODUCTION.");
    L("  Figée le      : " + figee.figee_le);
    L("  Motif         : " + figee.figee_motif);
    L("  Issue de la révision : " + figee.fiche_revision);
    L("  Révision actuelle de la fiche : " + (fiche ? fiche.revision : "?"));
    const enRetard = fiche && Number(fiche.revision) !== Number(figee.fiche_revision);
    L("");
    if (enRetard) {
      L("  => RETARD CONFIRMÉ. Le calcul part de la révision " + figee.fiche_revision
        + ", la fiche est en révision " + fiche.revision + ".");
      L("     Vos corrections sont dans la fiche ; cette production ne les voit pas.");
      L("     Ce n'est pas une panne : c'est la protection de la nomenclature figée.");
    } else {
      L("  => Pas de retard de révision : la recette figée provient de la révision en vigueur.");
      L("     Si la fiche est en brouillon, vos corrections ne sont pas encore une révision.");
    }
  }

  // --- La comparaison, composant par composant -------------------------------------------------
  if (figee && fiche) {
    titre("4. CE QUI A CHANGÉ ENTRE LA RECETTE FIGÉE ET LA FICHE ACTUELLE");
    let ancienne = null;
    try { ancienne = JSON.parse(figee.composants_json); } catch (_) {}
    if (!Array.isArray(ancienne)) {
      L("  La recette figée n'a pas pu être relue (format " + figee.format_version + ").");
    } else {
      const { construireRecette } = require("./electron/ipc/besoins");
      const nouvelle = construireRecette(db, fiche.id).composants;

      const parCle = (liste) => {
        const m = {};
        liste.forEach((c) => { m[c.cle] = c; });
        return m;
      };
      const A = parCle(ancienne), N = parCle(nouvelle);
      const toutes = Array.from(new Set(Object.keys(A).concat(Object.keys(N))));

      let differences = 0;
      toutes.forEach((cle) => {
        const a = A[cle], b = N[cle];
        const nom = (a || b).nom;
        if (!a) { L("  AJOUTÉ dans la fiche   : " + nom + "  (absent de la recette figée)"); differences++; return; }
        if (!b) { L("  RETIRÉ de la fiche     : " + nom + "  (présent dans la recette figée)"); differences++; return; }
        const ea = empreinteComposant(a), eb = empreinteComposant(b);
        const champs = Object.keys(ea).filter((k) => String(ea[k]) !== String(eb[k]));
        if (champs.length === 0) return;
        differences++;
        L("  MODIFIÉ : " + nom);
        champs.forEach((k) => {
          L("      " + k.padEnd(28) + " figée : " + String(n(ea[k])).padEnd(14) + " | fiche : " + n(eb[k]));
        });
      });
      if (differences === 0) {
        L("  AUCUNE différence entre la recette figée et la fiche actuelle.");
        L("");
        L("  C'est un résultat important : si des anomalies subsistent, le figeage n'y est pour");
        L("  rien, et vos corrections ne portent pas sur ce que le moteur lit. Voir le § 5.");
      } else {
        L("");
        L("  " + differences + " composant(s) diffèrent. C'est exactement ce qu'une actualisation");
        L("  de cette production appliquerait — et ce qu'elle doit vous montrer avant de le faire.");
      }
    }
  }

  // --- Ce que le moteur lit RÉELLEMENT, et les anomalies qui en découlent ----------------------
  titre("5. CE QUE LE MOTEUR LIT, COMPOSANT PAR COMPOSANT");
  L("  (les valeurs de la source indiquée au § 3 — celles qui produisent les anomalies)");
  L("");
  let composants = [];
  if (figee) { try { composants = JSON.parse(figee.composants_json) || []; } catch (_) {} }
  else if (fiche) {
    const { construireRecette } = require("./electron/ipc/besoins");
    composants = construireRecette(db, fiche.id).composants;
  }

  if (composants.length === 0) {
    L("  Aucun composant.");
  } else {
    composants.forEach((c) => {
      const e = empreinteComposant(c);
      const manques = [];
      if (!c.unite) manques.push("UNITÉ MANQUANTE");
      const base = c.consommation_base != null ? c.consommation_base : c.consommation_par_piece;
      const parTaille = Object.keys(c.consommations_taille || {}).length;
      const parCouleur = Object.values(c.couleurs || {}).filter((x) => x && x.consommation != null).length;
      if ((base == null || base === "" || Number(base) <= 0) && parTaille === 0 && parCouleur === 0) {
        manques.push("CONSOMMATION MANQUANTE");
      }
      const couleursSansChoix = Object.values(c.couleurs || {}).filter((x) => x && !x.coloris_choisi).length;
      if (couleursSansChoix > 0) manques.push(couleursSansChoix + " coloris non choisi(s)");
      if (c.catalogue_id == null) manques.push("non relié au catalogue");

      L("  " + (c.type === "matiere" ? "[matière]   " : "[fourniture]") + " " + c.nom
        + (manques.length ? "   <<< " + manques.join(" · ") : ""));
      L("      unité " + n(e["unité"]) + "   |   consommation de base " + n(base)
        + "   |   mode " + n(e["mode de consommation"]));
      if (parTaille > 0) L("      consommations par taille : " + parTaille);
      if (Object.keys(c.couleurs || {}).length > 0) {
        L("      correspondances de couleur : " + Object.keys(c.couleurs).length
          + " (dont " + parCouleur + " avec une consommation propre)");
      }
      if (c.hors_approvisionnement) {
        L("      HORS APPROVISIONNEMENT — " + (c.hors_appro_motif || "motif non précisé"));
      }
    });
  }

  // --- Les bons MP déjà préparés sur cette production ------------------------------------------
  titre("6. CE QU'UNE ACTUALISATION TOUCHERAIT EN AVAL");
  const bons = tableExiste(db, "bc_mp_ligne_productions") ? db.prepare(`
    SELECT b.id, b.numero, b.statut, COUNT(DISTINCT l.id) AS lignes
      FROM bc_mp b
      JOIN bc_mp_lignes l ON l.bc_mp_id = b.id
      JOIN bc_mp_ligne_productions p ON p.bc_mp_ligne_id = l.id
     WHERE p.commande_id = ?
     GROUP BY b.id ORDER BY b.id
  `).all(cmd.id) : [];
  if (bons.length === 0) {
    L("  Aucun bon de commande MP ne porte sur cette production.");
    L("  Une actualisation n'aurait donc rien à préserver ici.");
  } else {
    L("  " + bons.length + " bon(s) de commande MP portent déjà sur cette production :");
    bons.forEach((b) => L("      " + b.numero + "   statut " + b.statut + "   " + b.lignes + " ligne(s)"));
    L("");
    L("  Ces bons sont des faits : ils ne doivent pas être recalculés par une actualisation.");
    L("  Après actualisation, ils continueront d'être déduits du « déjà commandé » comme avant ;");
    L("  c'est le RESTE À COMMANDER qui changera, et lui seul.");
  }

  const achats = db.prepare(`
    SELECT COUNT(*) AS n FROM achats_affectations WHERE commande_id = ?
  `).get(cmd.id);
  L("");
  L("  Achats affectés à cette production : " + achats.n);

  try { db.close(); } catch (_) {}

  fs.writeFileSync(sortie, lignes.join("\r\n"), "utf-8");
  L("");
  L("Rapport écrit dans : " + path.resolve(sortie));
  L("");
}

if (require.main === module) {
  try { main(); } catch (err) {
    console.error("");
    console.error("  " + (err && err.message ? err.message : String(err)));
    console.error("");
    console.error("  Rien n'a été modifié.");
    console.error("");
    process.exit(1);
  }
}

module.exports = { empreinteComposant };
