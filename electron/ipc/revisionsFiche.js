// Révisions de fiche technique — rouvrir une fiche validée sans toucher aux productions passées.
//
// Ce fichier est le SEUL à écrire dans fiches_techniques_revisions et commandes_recette_figee.
// besoins.js, lui, reste strictement en lecture : deux contrôles automatiques l'imposent, et
// c'est ce qui garantit qu'un simple affichage des besoins ne peut jamais figer quoi que ce soit.
//
// Le geste de l'utilisateur est unique : « Modifier la nomenclature ». Derrière ce bouton, trois
// écritures qui ne valent que prises ensemble :
//
//   1. l'état actuel de la fiche est archivé (c'est la version de référence, conservée) ;
//   2. la recette est FIGÉE sur chaque production déjà décidée de cet article ;
//   3. la fiche repasse en brouillon.
//
// Si l'une des trois échoue, aucune n'est appliquée. Une fiche rouverte alors qu'une production
// n'a pas été protégée verrait ses besoins changer rétroactivement — exactement ce que tout ce
// mécanisme existe pour empêcher.

const { construireRecette } = require("./besoins");

// Productions à protéger : celles qui sont DÉCIDÉES. Un brouillon de commande n'en fait pas
// partie — il doit au contraire suivre la dernière version de la fiche, c'est tout son intérêt.
// Une commande annulée non plus : elle ne produira rien.
const STATUTS_A_PROTEGER = ["validee", "en_production", "controle_qualite", "terminee"];

/**
 * Transaction explicite, en BEGIN / COMMIT / ROLLBACK plutôt qu'avec db.transaction().
 *
 * Raison : le même code s'exécute ainsi en production et dans les tests automatiques, qui
 * utilisent un autre pilote SQLite. Un mécanisme de transaction testé n'est pas un mécanisme de
 * transaction supposé — et c'est précisément celui dont tout le reste dépend.
 */
function enTransaction(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const resultat = fn();
    db.exec("COMMIT");
    return resultat;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (_) { /* la transaction était déjà défaite */ }
    throw err;
  }
}

function lireFiche(db, ficheId) {
  const fiche = db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  return fiche;
}

/** Les productions décidées de cet article qui n'ont PAS encore de recette figée. */
function productionsADeproteger(db, articleId) {
  return db.prepare(`
    SELECT c.id, c.numero, c.statut
      FROM commandes c
     WHERE c.article_id = ?
       AND c.deleted_at IS NULL
       AND c.statut IN (${STATUTS_A_PROTEGER.map(() => "?").join(",")})
       AND NOT EXISTS (SELECT 1 FROM commandes_recette_figee r WHERE r.commande_id = c.id)
     ORDER BY c.id
  `).all(articleId, ...STATUTS_A_PROTEGER);
}

/**
 * Ce que « Modifier la nomenclature » va faire, AVANT de le faire. Sert à l'écran de confirmation :
 * on ne demande pas à quelqu'un d'approuver une opération dont on ne lui dit pas la portée.
 * Lecture seule.
 */
function apercuModification(db, ficheId) {
  const fiche = lireFiche(db, ficheId);
  const productions = fiche.statut === "validee" ? productionsADeproteger(db, fiche.article_id) : [];
  const dejaFigees = db.prepare(`
    SELECT COUNT(*) AS n FROM commandes_recette_figee r
      JOIN commandes c ON c.id = r.commande_id
     WHERE c.article_id = ?
  `).get(fiche.article_id).n;

  return {
    fiche_id: fiche.id,
    statut: fiche.statut,
    revision: fiche.revision,
    modifiable: fiche.statut === "validee",
    productions_a_proteger: productions,
    productions_deja_protegees: dejaFigees,
  };
}

/**
 * Rouvre une fiche validée pour modification.
 *
 * @param {number} operateurId  opérateur actif, pour la traçabilité. Facultatif.
 * @param {string} motif        motif libre de la demande. Facultatif.
 */
function rouvrirPourModification(db, ficheId, options) {
  const o = options || {};
  const fiche = lireFiche(db, ficheId);

  if (fiche.statut === "brouillon") {
    throw new Error("Cette fiche est déjà en brouillon : elle est modifiable telle quelle.");
  }
  if (fiche.statut !== "validee") {
    throw new Error("Seule une fiche validée peut être rouverte pour modification.");
  }

  // La recette est construite AVANT la transaction : c'est une lecture, elle peut échouer sans
  // conséquence, et mieux vaut s'en apercevoir avant d'avoir commencé à écrire.
  const recette = construireRecette(db, ficheId);
  const contenu = require("./ficheTechnique").get(db, ficheId);
  if (!contenu) throw new Error("Fiche technique illisible : modification annulée.");

  const aProteger = productionsADeproteger(db, fiche.article_id);

  return enTransaction(db, () => {
    // 1. Archiver l'état actuel. UNIQUE(fiche_id, revision) empêche d'archiver deux fois la même
    //    version : si cette ligne existe déjà, l'insertion échoue et tout est annulé.
    db.prepare(`
      INSERT INTO fiches_techniques_revisions
        (fiche_id, revision, motif, contenu_json, format_version, validated_at, archivee_par_id)
      VALUES (?, ?, ?, ?, 1, ?, ?)
    `).run(fiche.id, fiche.revision, o.motif || null, JSON.stringify(contenu),
      fiche.validated_at || null, o.operateur_id || null);

    // 2. Figer la recette sur chaque production décidée. La recette est la MÊME pour toutes :
    //    c'est la fiche dans l'état qu'elles voyaient encore il y a une seconde.
    const composants = JSON.stringify(recette.composants);
    const insert = db.prepare(`
      INSERT INTO commandes_recette_figee
        (commande_id, fiche_id, fiche_revision, composants_json, format_version, figee_motif, figee_par_id)
      VALUES (?, ?, ?, ?, ?, 'revision_fiche', ?)
    `);
    aProteger.forEach((c) => {
      insert.run(c.id, fiche.id, fiche.revision, composants, recette.format_version, o.operateur_id || null);
    });

    // 3. Rouvrir. Le NUMÉRO de révision n'avance pas ici : il désigne une version VALIDÉE, et ce
    //    brouillon n'en est pas encore une. Il avancera à la revalidation.
    db.prepare(
      "UPDATE fiches_techniques SET statut = 'brouillon', revision_motif = ?, validated_at = NULL WHERE id = ?"
    ).run(o.motif || null, fiche.id);

    // 4. Contrôle de SORTIE, dans la même transaction. On ne se contente pas de l'absence
    //    d'erreur : on vérifie le résultat. S'il reste une seule production non protégée, on
    //    annule tout — mieux vaut une fiche qui refuse de s'ouvrir qu'une production qui change
    //    de nomenclature sans prévenir.
    const restantes = productionsADeproteger(db, fiche.article_id);
    if (restantes.length > 0) {
      throw new Error(
        "Modification annulée : " + restantes.length + " production(s) n'ont pas pu être protégées (" +
        restantes.map((c) => c.numero || ("id " + c.id)).join(", ") + "). La fiche reste validée."
      );
    }

    return {
      fiche_id: fiche.id,
      revision_archivee: fiche.revision,
      productions_protegees: aProteger.map((c) => ({ id: c.id, numero: c.numero, statut: c.statut })),
    };
  });
}

/**
 * Les révisions archivées d'une fiche, de la plus récente à la plus ancienne.
 * Le contenu complet n'est PAS renvoyé : il peut peser plusieurs dizaines de kilo-octets et
 * l'écran n'en a besoin que lorsqu'on ouvre une révision précise.
 */
function listRevisions(db, ficheId) {
  return db.prepare(`
    SELECT r.id, r.revision, r.motif, r.validated_at, r.archivee_le,
           LENGTH(r.contenu_json) AS taille_octets,
           (SELECT COUNT(*) FROM commandes_recette_figee f
             WHERE f.fiche_id = r.fiche_id AND f.fiche_revision = r.revision) AS productions_figees
      FROM fiches_techniques_revisions r
     WHERE r.fiche_id = ?
     ORDER BY r.revision DESC
  `).all(ficheId);
}

/** Le contenu complet d'une révision archivée, pour consultation. */
function getRevision(db, revisionId) {
  const r = db.prepare("SELECT * FROM fiches_techniques_revisions WHERE id = ?").get(revisionId);
  if (!r) throw new Error("Révision introuvable.");
  let contenu = null;
  try {
    contenu = JSON.parse(r.contenu_json);
  } catch (err) {
    // On rend la révision malgré tout, en disant que son contenu est illisible : une archive
    // abîmée doit se voir, pas disparaître.
    return Object.assign({}, r, { contenu: null, illisible: (err && err.message) || "contenu illisible" });
  }
  return Object.assign({}, r, { contenu_json: undefined, contenu });
}

module.exports = {
  apercuModification,
  rouvrirPourModification,
  listRevisions,
  getRevision,
  STATUTS_A_PROTEGER,
};
