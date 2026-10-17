const crypto = require("crypto");
const photos = require("./photos");
const { genererReferencePrincipale, prochainSequentiel, ABREVIATION_REGEX } = require("../db/references");

function assertAbreviationValide(abreviation) {
  if (!ABREVIATION_REGEX.test(abreviation)) {
    throw new Error("L'abréviation doit contenir de 2 à 5 lettres majuscules, sans espace ni accent.");
  }
}

function assertAnneeValide(annee) {
  if (!Number.isInteger(annee) || String(Math.abs(annee)).length !== 4) {
    throw new Error("L'année de collection doit être un entier à 4 chiffres, ex: 2026.");
  }
}

// Génère la référence et l'applique (INSERT ou UPDATE, fourni par l'appelant) au sein d'une
// boucle de nouvelle tentative : si la contrainte UNIQUE(reference_principale) est violée
// (générations concurrentes), on recalcule le numéro séquentiel suivant et on réessaie.
function genererReferenceAvecRetry(db, params, appliquer) {
  const saisonId = params.saisonId;
  const annee = params.annee;
  const rayonId = params.rayonId;
  const abreviation = params.abreviation;
  // produitId : indispensable depuis les series par famille — sans lui, prochainSequentiel ne
  // peut pas determiner la categorie et donc la plage a utiliser.
  const produitId = params.produitId;
  const MAX_TENTATIVES = 5;
  let derniereErreur = null;
  for (let i = 0; i < MAX_TENTATIVES; i++) {
    const saison = db.prepare("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'saison'").get(saisonId);
    const rayon = db.prepare("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'rayon'").get(rayonId);
    if (!saison) throw new Error("Saison introuvable.");
    if (!rayon) throw new Error("Rayon introuvable.");

    const sequentiel = prochainSequentiel(db, { saisonId, annee, rayonId, abreviation, produitId: produitId });
    const reference = genererReferencePrincipale({
      saisonCode: saison.code, annee, rayonCode: rayon.code, abreviation, sequentiel,
    });
    try {
      appliquer(reference, sequentiel);
      return reference;
    } catch (err) {
      derniereErreur = err;
      const estConflitUnicite = String(err.message || "").toUpperCase().includes("UNIQUE");
      if (!estConflitUnicite) throw err;
      // Un autre article a pris ce numéro entre-temps : on retente avec le suivant.
    }
  }
  throw new Error(
    "Impossible de générer une référence unique après plusieurs tentatives." +
    (derniereErreur ? " Dernière erreur : " + derniereErreur.message : "")
  );
}

const SELECT_BASE =
  "SELECT " +
  "ar.id, ar.uuid, ar.produit_id, COALESCE(p.nom, 'Non catégorisé') AS produit, " +
  // Nom affiche d'un article : sa designation propre, sinon le nom du produit. Le COALESCE rend
  // l'ajout de la colonne totalement transparent pour les donnees anterieures.
  "ar.designation, COALESCE(NULLIF(TRIM(ar.designation), ''), p.nom, 'Non categorise') AS nom_affiche, " +
  "ar.saison_id, s.nom AS saison, s.code AS saison_code, " +
  "ar.annee_collection, ar.rayon_id, r.nom AS rayon, r.code AS rayon_code, " +
  "ar.categorie_id, cat.nom AS categorie_historique, " +
  // La categorie AFFICHEE vient du parent du TYPE (listes_valeurs.parent_id), jamais de
  // articles.categorie_id : une seule verite, aucune divergence possible. categorie_id reste
  // expose sous categorie_historique pour la compatibilite, et n'est plus lu par l'interface.
  "p.parent_id AS categorie_id_type, ctype.nom AS categorie, " +
  "ar.abreviation, ar.numero_sequentiel, ar.reference_principale, ar.prix_vente_envisage, " +
  "(SELECT COUNT(*) FROM commandes WHERE article_id = ar.id AND type_production = 'nouveau' AND deleted_at IS NULL) AS nb_commandes_nouveau, " +
  "(SELECT COUNT(*) FROM commandes WHERE article_id = ar.id AND deleted_at IS NULL) AS nb_productions, " +
  "(SELECT reference_production FROM commandes WHERE article_id = ar.id AND deleted_at IS NULL ORDER BY id DESC LIMIT 1) AS derniere_reference_production, " +
  "(SELECT MAX(numero_reassort) FROM commandes WHERE article_id = ar.id AND type_production = 'reassort' AND deleted_at IS NULL) AS max_numero_reassort, " +
  "ar.created_at, ar.updated_at " +
  "FROM articles ar " +
  "LEFT JOIN listes_valeurs p ON p.id = ar.produit_id " +
  "LEFT JOIN listes_valeurs s ON s.id = ar.saison_id " +
  "LEFT JOIN listes_valeurs r ON r.id = ar.rayon_id " +
  "LEFT JOIN listes_valeurs cat ON cat.id = ar.categorie_id " +
  "LEFT JOIN listes_valeurs ctype ON ctype.id = p.parent_id ";

function fetchPhotos(db, articleId) {
  return db
    .prepare("SELECT id, photo_path, photo_thumb_path, est_principale, ordre FROM article_photos WHERE article_id = ? ORDER BY ordre ASC")
    .all(articleId);
}

function attachPhotos(db, article) {
  if (!article) return article;
  article.photos = fetchPhotos(db, article.id);
  return article;
}

function list(db, opts) {
  const includeIncomplete = !opts || opts.includeIncomplete !== false;
  const where = includeIncomplete ? "" : "WHERE ar.reference_principale IS NOT NULL";
  const rows = db.prepare(SELECT_BASE + where + " ORDER BY ar.created_at DESC").all();
  rows.forEach((a) => attachPhotos(db, a));
  return rows;
}

function get(db, id) {
  return attachPhotos(db, db.prepare(SELECT_BASE + " WHERE ar.id = ?").get(id));
}

function photoPrincipale(db, articleId) {
  const row = db
    .prepare("SELECT photo_path, photo_thumb_path FROM article_photos WHERE article_id = ? AND est_principale = 1 LIMIT 1")
    .get(articleId);
  return row || null;
}

// Crée un nouvel article COMPLET (pas un article issu d'une migration) : la référence est
// générée immédiatement, dans la même transaction que l'insertion.
function create(db, payload) {
  if (!payload.produit_id) throw new Error("Sélectionnez un produit.");
  if (!payload.saison_id) throw new Error("Sélectionnez une saison.");
  if (!payload.rayon_id) throw new Error("Sélectionnez un rayon.");
  const annee = Number(payload.annee_collection);
  assertAnneeValide(annee);
  const abreviation = String(payload.abreviation || "").trim().toUpperCase();
  assertAbreviationValide(abreviation);

  const uuid = crypto.randomUUID();
  const saisonId = Number(payload.saison_id);
  const rayonId = Number(payload.rayon_id);
  let articleId;

  const tx = db.transaction(() => {
    genererReferenceAvecRetry(db, { saisonId: saisonId, annee: annee, rayonId: rayonId, abreviation: abreviation, produitId: Number(payload.produit_id) }, (reference, sequentiel) => {
      const info = db
        .prepare(
          "INSERT INTO articles (uuid, produit_id, saison_id, annee_collection, rayon_id, abreviation, numero_sequentiel, reference_principale, designation) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(uuid, Number(payload.produit_id), saisonId, annee, rayonId, abreviation, sequentiel, reference,
          payload.designation != null && String(payload.designation).trim() ? String(payload.designation).trim() : null);
      articleId = info.lastInsertRowid;
    });
  });
  tx();

  return get(db, articleId);
}

// Complète un article issu d'une migration (sans référence) et génère définitivement sa
// référence principale. Ne peut être fait qu'une fois : un article déjà référencé ne se
// régénère jamais (référence stable, potentiellement déjà imprimée/communiquée).
function completerReference(db, id, payload) {
  const current = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!current) throw new Error("Article introuvable.");
  if (current.reference_principale) {
    throw new Error("Cet article a déjà une référence principale : elle ne peut pas être régénérée.");
  }
  if (!payload.saison_id) throw new Error("Sélectionnez une saison.");
  if (!payload.rayon_id) throw new Error("Sélectionnez un rayon.");
  const annee = Number(payload.annee_collection);
  assertAnneeValide(annee);
  const abreviation = String(payload.abreviation || "").trim().toUpperCase();
  assertAbreviationValide(abreviation);

  const saisonId = Number(payload.saison_id);
  const rayonId = Number(payload.rayon_id);

  const tx = db.transaction(() => {
    genererReferenceAvecRetry(db, { saisonId: saisonId, annee: annee, rayonId: rayonId, abreviation: abreviation, produitId: current.produit_id }, (reference, sequentiel) => {
      db.prepare(
        "UPDATE articles SET saison_id = ?, annee_collection = ?, rayon_id = ?, abreviation = ?, numero_sequentiel = ?, reference_principale = ? " +
        "WHERE id = ?"
      ).run(saisonId, annee, rayonId, abreviation, sequentiel, reference, id);
    });
  });
  tx();

  return get(db, id);
}

// Modification d'un article EXISTANT. Ne touche JAMAIS a reference_principale ni a
// numero_sequentiel : genererReferenceAvecRetry n'est pas appelee ici, donc une reference deja
// attribuee ne peut structurellement pas etre regeneree, meme si le type, la designation, la
// saison ou le rayon changent.
const CHAMPS_MODIFIABLES = ["produit_id", "designation", "saison_id", "annee_collection", "rayon_id", "prix_vente_envisage"];

// Effet d'un changement de reference, calcule SANS rien modifier. Sert a construire la
// confirmation : nombre de commandes concernees, ancienne et nouvelle valeur, disponibilite.
// Les commandes conservent leur reference_production : c'est un SNAPSHOT fige a l'emission,
// jamais relu depuis l'article. Un document deja emis ne se reecrit pas.
function verifierChangementReference(db, id, nouvelleReference) {
  const article = db.prepare("SELECT id, reference_principale FROM articles WHERE id = ?").get(id);
  if (!article) throw new Error("Article introuvable.");
  const nouvelle = String(nouvelleReference || "").trim().toUpperCase();
  const ancienne = article.reference_principale;

  const prise = nouvelle
    ? db.prepare("SELECT id, reference_principale FROM articles WHERE UPPER(reference_principale) = ? AND id <> ?").get(nouvelle, id)
    : null;
  const commandes = ancienne
    ? db.prepare("SELECT COUNT(*) AS n FROM commandes WHERE article_id = ? AND deleted_at IS NULL").get(id).n
    : 0;

  return {
    ancienne: ancienne,
    nouvelle: nouvelle || null,
    inchangee: !nouvelle || nouvelle === String(ancienne || "").toUpperCase(),
    disponible: !prise,
    prise_par: prise ? prise.reference_principale : null,
    nb_commandes: commandes,
  };
}

// Donnees de depart pour un NOUVEL article, copiees depuis un existant. Ne cree rien : renvoie
// un payload que le formulaire prerempli, l'utilisateur ajuste, puis cree normalement.
// id, uuid, reference_principale, numero_sequentiel, commandes, quantites et donnees financieres
// ne sont JAMAIS repris : le nouvel article est totalement independant.
function preparerDuplication(db, id) {
  const a = get(db, id);
  if (!a) throw new Error("Article introuvable.");
  return {
    produit_id: a.produit_id,
    categorie_id_type: a.categorie_id_type,
    designation: a.designation ? a.designation + " (copie)" : null,
    saison_id: a.saison_id,
    annee_collection: a.annee_collection,
    rayon_id: a.rayon_id,
    abreviation: a.abreviation,
    source: { id: a.id, reference: a.reference_principale, designation: a.designation },
  };
}

function update(db, id, patch) {
  const current = db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
  if (!current) throw new Error("Article introuvable.");
  const p = patch || {};

  if (p.produit_id !== undefined && !p.produit_id) throw new Error("Sélectionnez un type d'article.");
  if (p.annee_collection !== undefined) assertAnneeValide(Number(p.annee_collection));
  if (p.designation !== undefined && !String(p.designation || "").trim()) {
    throw new Error("La désignation est obligatoire.");
  }

  // La reference n'est modifiee QUE si elle est explicitement fournie et differente. Changer le
  // type, la designation, la saison ou le rayon ne la touche jamais : genererReferenceAvecRetry
  // n'est pas appelee ici.
  if (p.reference_principale !== undefined) {
    const v = verifierChangementReference(db, id, p.reference_principale);
    if (!v.nouvelle) throw new Error("La référence principale ne peut pas être vidée.");
    if (!v.inchangee) {
      if (!v.disponible) throw new Error("La référence « " + v.nouvelle + " » est déjà utilisée par un autre article.");
      db.prepare("UPDATE articles SET reference_principale = ? WHERE id = ?").run(v.nouvelle, id);
    }
  }

  const champs = CHAMPS_MODIFIABLES.filter((f) => p[f] !== undefined);
  if (champs.length === 0) return get(db, id);

  const params = { id: id };
  champs.forEach((f) => {
    if (f === "designation") params[f] = String(p[f]).trim();
    else if (f === "prix_vente_envisage") params[f] = p[f] == null || p[f] === "" ? null : Number(p[f]);
    else params[f] = Number(p[f]);
  });
  db.prepare("UPDATE articles SET " + champs.map((f) => f + " = @" + f).join(", ") + " WHERE id = @id").run(params);
  return get(db, id);
}

async function ajouterPhoto(db, articleId, sourcePath) {
  const article = db.prepare("SELECT id FROM articles WHERE id = ?").get(articleId);
  if (!article) throw new Error("Article introuvable.");

  const result = await photos.copyIntoStore(sourcePath);
  const dejaPrincipale = db.prepare("SELECT COUNT(*) AS n FROM article_photos WHERE article_id = ? AND est_principale = 1").get(articleId).n;
  const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM article_photos WHERE article_id = ?").get(articleId).m || 0;

  const info = db
    .prepare("INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, ?, ?)")
    .run(articleId, result.photo_path, result.photo_thumb_path, dejaPrincipale > 0 ? 0 : 1, maxOrdre + 1);

  return db.prepare("SELECT * FROM article_photos WHERE id = ?").get(info.lastInsertRowid);
}

function definirPhotoPrincipale(db, photoId) {
  const photo = db.prepare("SELECT * FROM article_photos WHERE id = ?").get(photoId);
  if (!photo) throw new Error("Photo introuvable.");
  const tx = db.transaction(() => {
    db.prepare("UPDATE article_photos SET est_principale = 0 WHERE article_id = ?").run(photo.article_id);
    db.prepare("UPDATE article_photos SET est_principale = 1 WHERE id = ?").run(photoId);
  });
  tx();
  return fetchPhotos(db, photo.article_id);
}

function retirerPhoto(db, photoId) {
  const photo = db.prepare("SELECT * FROM article_photos WHERE id = ?").get(photoId);
  if (!photo) throw new Error("Photo introuvable.");
  db.prepare("DELETE FROM article_photos WHERE id = ?").run(photoId);
  photos.cleanupOldPhoto(db, photo.photo_path, photo.photo_thumb_path, photoId);
  const restantes = fetchPhotos(db, photo.article_id);
  if (photo.est_principale && restantes.length > 0 && !restantes.some((p) => p.est_principale)) {
    db.prepare("UPDATE article_photos SET est_principale = 1 WHERE id = ?").run(restantes[0].id);
  }
  return fetchPhotos(db, photo.article_id);
}

module.exports = {
  list: list,
  get: get,
  create: create,
  update: update,
  verifierChangementReference: verifierChangementReference,
  preparerDuplication: preparerDuplication,
  completerReference: completerReference,
  photoPrincipale: photoPrincipale,
  ajouterPhoto: ajouterPhoto,
  definirPhotoPrincipale: definirPhotoPrincipale,
  retirerPhoto: retirerPhoto,
  assertAbreviationValide: assertAbreviationValide,
};
