// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — articles.
//
// Adaptée de electron/ipc/articles.js pour la Phase 1 (Lot 1 — Articles).
//
// EXCLU DE CE LOT, volontairement (voir présentation du Lot 1) :
//   - ajouterPhoto() : upload physique réel (fs.copyFileSync via photos.js),
//     bloqué tant que Cloudflare R2 n'est pas configuré.
//   - retirerPhoto() : la partie base de données (suppression de
//     l'enregistrement, réassignation de la photo principale) EST reprise
//     ici, mais l'appel à photos.cleanupOldPhoto() (suppression physique du
//     fichier orphelin) est omis — commentaire explicite à l'endroit concerné.
//
// Point d'adaptation réel : create() et completerReference() utilisaient
// db.transaction() (mécanisme SYNCHRONE propre à better-sqlite3). Remplacé
// par adapter.transaction(async (tx) => {...}), ajouté à shared/db-adapter.js
// et testé indépendamment (succès + rollback, sur les deux moteurs) avant
// d'être utilisé ici.
//
// electron/ipc/articles.js n'est PAS modifié.
// ============================================================================

const crypto = require("crypto");
const { genererReferencePrincipale, prochainSequentiel, ABREVIATION_REGEX } = require("./references");

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

async function genererReferenceAvecRetry(adapter, params, appliquer) {
  const { saisonId, annee, rayonId, abreviation } = params;
  const MAX_TENTATIVES = 5;
  let derniereErreur = null;
  for (let i = 0; i < MAX_TENTATIVES; i++) {
    const saison = await adapter.get("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'saison'", [saisonId]);
    const rayon = await adapter.get("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'rayon'", [rayonId]);
    if (!saison) throw new Error("Saison introuvable.");
    if (!rayon) throw new Error("Rayon introuvable.");

    const sequentiel = await prochainSequentiel(adapter, { saisonId, annee, rayonId, abreviation });
    const reference = genererReferencePrincipale({ saisonCode: saison.code, annee, rayonCode: rayon.code, abreviation, sequentiel });
    try {
      await appliquer(reference, sequentiel);
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
  "ar.saison_id, s.nom AS saison, s.code AS saison_code, " +
  "ar.annee_collection, ar.rayon_id, r.nom AS rayon, r.code AS rayon_code, " +
  "ar.categorie_id, cat.nom AS categorie, " +
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
  "LEFT JOIN listes_valeurs cat ON cat.id = ar.categorie_id ";

async function fetchPhotos(adapter, articleId) {
  return adapter.all("SELECT id, photo_path, photo_thumb_path, est_principale, ordre FROM article_photos WHERE article_id = ? ORDER BY ordre ASC", [articleId]);
}

async function attachPhotos(adapter, article) {
  if (!article) return article;
  article.photos = await fetchPhotos(adapter, article.id);
  return article;
}

async function list(adapter, opts) {
  const includeIncomplete = !opts || opts.includeIncomplete !== false;
  const where = includeIncomplete ? "" : "WHERE ar.reference_principale IS NOT NULL";
  const rows = await adapter.all(SELECT_BASE + where + " ORDER BY ar.created_at DESC", []);
  for (const a of rows) await attachPhotos(adapter, a);
  return rows;
}

async function get(adapter, id) {
  return attachPhotos(adapter, await adapter.get(SELECT_BASE + " WHERE ar.id = ?", [id]));
}

async function photoPrincipale(adapter, articleId) {
  const row = await adapter.get("SELECT photo_path, photo_thumb_path FROM article_photos WHERE article_id = ? AND est_principale = 1 LIMIT 1", [articleId]);
  return row || null;
}

async function create(adapter, payload) {
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

  await adapter.transaction(async (tx) => {
    await genererReferenceAvecRetry(tx, { saisonId, annee, rayonId, abreviation }, async (reference, sequentiel) => {
      const info = await tx.run(
        "INSERT INTO articles (uuid, produit_id, saison_id, annee_collection, rayon_id, abreviation, numero_sequentiel, reference_principale) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
        [uuid, Number(payload.produit_id), saisonId, annee, rayonId, abreviation, sequentiel, reference]
      );
      articleId = info.lastInsertRowid;
    });
  });

  return get(adapter, articleId);
}

async function completerReference(adapter, id, payload) {
  const current = await adapter.get("SELECT * FROM articles WHERE id = ?", [id]);
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

  await adapter.transaction(async (tx) => {
    await genererReferenceAvecRetry(tx, { saisonId, annee, rayonId, abreviation }, async (reference, sequentiel) => {
      await tx.run(
        "UPDATE articles SET saison_id = ?, annee_collection = ?, rayon_id = ?, abreviation = ?, numero_sequentiel = ?, reference_principale = ? WHERE id = ?",
        [saisonId, annee, rayonId, abreviation, sequentiel, reference, id]
      );
    });
  });

  return get(adapter, id);
}

async function definirPhotoPrincipale(adapter, photoId) {
  const photo = await adapter.get("SELECT * FROM article_photos WHERE id = ?", [photoId]);
  if (!photo) throw new Error("Photo introuvable.");
  await adapter.transaction(async (tx) => {
    await tx.run("UPDATE article_photos SET est_principale = 0 WHERE article_id = ?", [photo.article_id]);
    await tx.run("UPDATE article_photos SET est_principale = 1 WHERE id = ?", [photoId]);
  });
  return fetchPhotos(adapter, photo.article_id);
}

// Partie base de données de retirerPhoto() uniquement — voir en-tête de fichier : le nettoyage
// physique du fichier orphelin (photos.cleanupOldPhoto) est omis, différé au lot Fichiers/R2.
async function retirerPhoto(adapter, photoId) {
  const photo = await adapter.get("SELECT * FROM article_photos WHERE id = ?", [photoId]);
  if (!photo) throw new Error("Photo introuvable.");
  await adapter.run("DELETE FROM article_photos WHERE id = ?", [photoId]);
  const restantes = await fetchPhotos(adapter, photo.article_id);
  if (photo.est_principale && restantes.length > 0 && !restantes.some((p) => p.est_principale)) {
    await adapter.run("UPDATE article_photos SET est_principale = 1 WHERE id = ?", [restantes[0].id]);
    return fetchPhotos(adapter, photo.article_id);
  }
  return restantes;
}

module.exports = {
  list, get, create, completerReference, photoPrincipale,
  definirPhotoPrincipale, retirerPhoto, assertAbreviationValide,
};
