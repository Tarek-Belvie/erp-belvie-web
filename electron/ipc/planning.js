const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const photos = require("./photos");
const { genererReferencePrincipale, prochainSequentiel, ABREVIATION_REGEX } = require("../db/references");

function getUserDataDir() {
  return app.getPath("userData");
}

// --- Verrouillage doux à partir de "Validé" --------------------------------------------------
// Planification en cours = flexible → Validation = point de contrôle → étapes suivantes =
// données protégées. Pas un blocage absolu : un patch avec { forcer: true } passe quand même,
// après confirmation explicite côté interface ("Modifier malgré validation").
const STATUTS_AVANT_VALIDATION = ["idee", "a_etudier", "prototype", "echantillon", "a_modifier"];
function estProtege(statut) {
  // "annule" n'engage plus rien en aval : pas de raison de le protéger comme une planification active.
  return statut !== "annule" && !STATUTS_AVANT_VALIDATION.includes(statut);
}
const CHAMPS_PROTEGES = ["produit_id", "rayon_id", "categorie_id", "saison_id", "annee_collection", "mois_prevu_production", "mois_prevu_reception", "quantite_previsionnelle", "coloris_previsionnels", "atelier_id"];
const MESSAGE_PROTECTION =
  "Cet article est déjà validé (ou à une étape ultérieure). La modification de ces données peut affecter les étapes suivantes. " +
  "Confirmez « Modifier malgré validation » pour continuer quand même.";


// Les noms de fichiers générés par photos.copyIntoStore() sont uniques (UUID) : jamais partagés
// avec article_photos. On vérifie donc uniquement contre planning_articles avant de supprimer.
function planningPhotoEstReferencee(db, relPath, excludePlanningId) {
  if (!relPath) return false;
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM planning_articles WHERE id <> ? AND (photo_path = ? OR photo_thumb_path = ?)")
    .get(excludePlanningId ?? -1, relPath, relPath);
  return row.n > 0;
}

function nettoyerAncienneImage(db, oldPhotoPath, oldThumbPath, excludePlanningId) {
  [oldPhotoPath, oldThumbPath].forEach((relPath) => {
    if (!relPath) return;
    if (planningPhotoEstReferencee(db, relPath, excludePlanningId)) return;
    const abs = path.join(getUserDataDir(), relPath);
    try {
      if (abs && fs.existsSync(abs)) fs.unlinkSync(abs);
    } catch (err) {
      console.error("Impossible de supprimer l'image de planification devenue orpheline :", err);
    }
  });
}

// Reformulation propre : on a besoin du "nom" de l'article réel (celui du produit + référence),
// pas seulement de sa catégorie.
function listPropre(db, filtres) {
  filtres = filtres || {};
  const clauses = ["p.archived = 0"];
  const params = {};
  if (filtres.mois) { clauses.push("p.mois_prevu_production = @mois"); params.mois = filtres.mois; }
  if (filtres.categorieId) { clauses.push("p.categorie_id = @categorieId"); params.categorieId = filtres.categorieId; }
  if (filtres.statut) { clauses.push("p.statut = @statut"); params.statut = filtres.statut; }
  if (filtres.saisonId) { clauses.push("p.saison_id = @saisonId"); params.saisonId = filtres.saisonId; }
  if (filtres.anneeCollection) { clauses.push("p.annee_collection = @anneeCollection"); params.anneeCollection = filtres.anneeCollection; }
  if (filtres.recherche) {
    clauses.push("(p.nom_provisoire LIKE @recherche OR p.reference_provisoire LIKE @recherche OR prod.nom LIKE @recherche OR a.reference_principale LIKE @recherche)");
    params.recherche = `%${filtres.recherche}%`;
  }

  const sql =
    "SELECT p.*, " +
    "prod.nom AS article_produit_nom, a.reference_principale AS article_reference, " +
    "cat.nom AS categorie_nom, s.nom AS saison_nom, at.nom AS atelier_nom, " +
    "ar_photo.photo_path AS article_photo_path, ar_photo.photo_thumb_path AS article_photo_thumb_path " +
    "FROM planning_articles p " +
    "LEFT JOIN articles a ON a.id = p.article_id " +
    "LEFT JOIN listes_valeurs prod ON prod.id = a.produit_id " +
    "LEFT JOIN listes_valeurs cat ON cat.id = p.categorie_id " +
    "LEFT JOIN listes_valeurs s ON s.id = p.saison_id " +
    "LEFT JOIN listes_valeurs at ON at.id = p.atelier_id " +
    "LEFT JOIN article_photos ar_photo ON ar_photo.article_id = p.article_id AND ar_photo.est_principale = 1 " +
    "WHERE " + clauses.join(" AND ") + " ORDER BY p.mois_prevu_production ASC, p.ordre ASC, p.id ASC";

  return db.prepare(sql).all(params).map((row) => Object.assign({}, row, {
    nom_affiche: row.article_produit_nom || row.nom_provisoire || "Sans nom",
    reference_affichee: row.article_reference || row.reference_provisoire || null,
    photo_affichee: row.article_photo_path || row.photo_path || null,
    photo_affichee_thumb: row.article_photo_thumb_path || row.photo_thumb_path || null,
    est_provisoire: row.article_id == null ? 1 : 0,
    coloris: row.coloris_previsionnels ? row.coloris_previsionnels.split(",").map((c) => c.trim()).filter(Boolean) : [],
  }));
}

function get(db, id) {
  const rows = listPropre(db, {});
  return rows.find((r) => r.id === id) || null;
}

function kpis(db) {
  const rows = db.prepare("SELECT statut, COUNT(*) AS n FROM planning_articles WHERE archived = 0 GROUP BY statut").all();
  const parStatut = {};
  rows.forEach((r) => { parStatut[r.statut] = r.n; });
  const total = db.prepare("SELECT COUNT(*) AS n FROM planning_articles WHERE archived = 0").get().n;
  return {
    total,
    en_developpement: (parStatut["a_etudier"] || 0) + (parStatut["prototype"] || 0) + (parStatut["a_modifier"] || 0),
    en_production: parStatut["en_production"] || 0,
    shooting_a_preparer: parStatut["shooting_a_preparer"] || 0,
    pret_au_lancement: parStatut["pret_au_lancement"] || 0,
    parStatut,
  };
}

// Compare deux clés 'AAAA-MM' : négatif si a < b, positif si a > b, 0 si égales.
function comparerMois(a, b) {
  return a.localeCompare(b);
}

function moisCourantISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Deux vérifications distinctes, déclenchées indépendamment : la première ne doit jamais
// re-bloquer une date de lancement ancienne et déjà enregistrée si elle n'est pas elle-même
// modifiée (sinon, éditer juste la réception d'une entrée ancienne deviendrait impossible).
function assertLancementPasDansLePasse(production) {
  if (comparerMois(production, moisCourantISO()) < 0) {
    throw new Error("Le lancement prévu ne peut pas être dans le passé.");
  }
}
function assertReceptionCoherente(production, reception) {
  if (reception && comparerMois(reception, production) < 0) {
    throw new Error("La réception prévue ne peut pas être antérieure au lancement prévu.");
  }
}

function assertValid(payload) {
  if (!payload.mois_prevu_production || !/^\d{4}-\d{2}$/.test(payload.mois_prevu_production)) {
    throw new Error("Le lancement prévu est obligatoire (format AAAA-MM).");
  }
  if (payload.mois_prevu_reception && !/^\d{4}-\d{2}$/.test(payload.mois_prevu_reception)) {
    throw new Error("Le mois prévu de réception doit être au format AAAA-MM.");
  }
  if (!payload.article_id && !(payload.nom_provisoire && payload.nom_provisoire.trim())) {
    throw new Error("Un nom provisoire est requis pour un article qui n'existe pas encore dans le catalogue.");
  }
  assertLancementPasDansLePasse(payload.mois_prevu_production);
  assertReceptionCoherente(payload.mois_prevu_production, payload.mois_prevu_reception);
}

function creer(db, payload) {
  assertValid(payload);
  const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM planning_articles WHERE mois_prevu_production = ? AND archived = 0").get(payload.mois_prevu_production).m || 0;
  const uuid = crypto.randomUUID();
  const info = db.prepare(
    "INSERT INTO planning_articles " +
    "(uuid, article_id, nom_provisoire, reference_provisoire, produit_id, rayon_id, categorie_id, saison_id, annee_collection, " +
    " mois_prevu, mois_prevu_production, mois_prevu_reception, quantite_previsionnelle, coloris_previsionnels, statut, atelier_id, notes, ordre) " +
    "VALUES (@uuid, @article_id, @nom_provisoire, @reference_provisoire, @produit_id, @rayon_id, @categorie_id, @saison_id, @annee_collection, " +
    " @mois_prevu_production, @mois_prevu_production, @mois_prevu_reception, @quantite_previsionnelle, @coloris_previsionnels, @statut, @atelier_id, @notes, @ordre)"
  ).run({
    uuid,
    article_id: payload.article_id || null,
    nom_provisoire: payload.nom_provisoire || null,
    reference_provisoire: payload.reference_provisoire || null,
    produit_id: payload.produit_id || null,
    rayon_id: payload.rayon_id || null,
    categorie_id: payload.categorie_id || null,
    saison_id: payload.saison_id || null,
    annee_collection: payload.annee_collection || null,
    mois_prevu_production: payload.mois_prevu_production,
    mois_prevu_reception: payload.mois_prevu_reception || null,
    quantite_previsionnelle: payload.quantite_previsionnelle || null,
    coloris_previsionnels: payload.coloris_previsionnels || null,
    statut: payload.statut || "idee",
    atelier_id: payload.atelier_id || null,
    notes: payload.notes || null,
    ordre: maxOrdre + 1,
  });
  return get(db, info.lastInsertRowid);
}

const CHAMPS_MODIFIABLES = [
  "nom_provisoire", "reference_provisoire", "produit_id", "rayon_id", "categorie_id", "saison_id", "annee_collection",
  "mois_prevu_production", "mois_prevu_reception",
  "quantite_previsionnelle", "coloris_previsionnels", "statut", "atelier_id", "notes",
];

function mettreAJour(db, id, patch) {
  const current = db.prepare("SELECT * FROM planning_articles WHERE id = ?").get(id);
  if (!current) throw new Error("Entrée de planification introuvable.");

  if (estProtege(current.statut) && !patch.forcer) {
    const champsSensiblesTouches = CHAMPS_PROTEGES.filter((c) => patch[c] !== undefined);
    if (champsSensiblesTouches.length > 0) throw new Error(MESSAGE_PROTECTION);
  }

  if (patch.mois_prevu_production !== undefined || patch.mois_prevu_reception !== undefined) {
    const productionFinale = patch.mois_prevu_production !== undefined ? patch.mois_prevu_production : current.mois_prevu_production;
    const receptionFinale = patch.mois_prevu_reception !== undefined ? patch.mois_prevu_reception : current.mois_prevu_reception;
    if (patch.mois_prevu_production !== undefined) assertLancementPasDansLePasse(productionFinale);
    assertReceptionCoherente(productionFinale, receptionFinale);
  }

  const sets = [];
  const params = { id };
  CHAMPS_MODIFIABLES.forEach((champ) => {
    if (patch[champ] !== undefined) {
      sets.push(`${champ} = @${champ}`);
      params[champ] = patch[champ] === "" ? null : patch[champ];
    }
  });
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    db.prepare(`UPDATE planning_articles SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }
  return get(db, id);
}

// Déplacement drag & drop : change la date active (production OU réception, selon le mode
// d'affichage en cours) et/ou réordonne à l'intérieur d'un mois. orderedIds = tous les ids du
// mois DESTINATION, dans leur ordre final après dépose. L'autre date n'est jamais touchée.
function deplacer(db, id, champ, nouveauMois, orderedIds, forcer) {
  if (champ !== "mois_prevu_production" && champ !== "mois_prevu_reception") {
    throw new Error("Champ de date invalide.");
  }
  const current = db.prepare("SELECT statut, mois_prevu_production, mois_prevu_reception FROM planning_articles WHERE id = ?").get(id);
  if (!current) throw new Error("Entrée de planification introuvable.");
  const changeReellementDeMois = nouveauMois !== current[champ];
  if (changeReellementDeMois && estProtege(current.statut) && !forcer) {
    throw new Error(MESSAGE_PROTECTION);
  }
  const productionFinale = champ === "mois_prevu_production" ? nouveauMois : current.mois_prevu_production;
  const receptionFinale = champ === "mois_prevu_reception" ? nouveauMois : current.mois_prevu_reception;
  if (champ === "mois_prevu_production") assertLancementPasDansLePasse(productionFinale);
  assertReceptionCoherente(productionFinale, receptionFinale);
  const tx = db.transaction(() => {
    db.prepare(`UPDATE planning_articles SET ${champ} = ?, updated_at = datetime('now') WHERE id = ?`).run(nouveauMois, id);
    if (Array.isArray(orderedIds)) {
      const setOrdre = db.prepare("UPDATE planning_articles SET ordre = ? WHERE id = ?");
      orderedIds.forEach((ligneId, index) => setOrdre.run(index + 1, ligneId));
    }
  });
  tx();
  return get(db, id);
}

function reordonner(db, mois, orderedIds) {
  const tx = db.transaction(() => {
    const setOrdre = db.prepare("UPDATE planning_articles SET ordre = ? WHERE id = ?");
    orderedIds.forEach((id, index) => setOrdre.run(index + 1, id));
  });
  tx();
  return listPropre(db, { mois });
}

async function ajouterPhoto(db, id, sourcePath, forcer) {
  const current = db.prepare("SELECT * FROM planning_articles WHERE id = ?").get(id);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (estProtege(current.statut) && !forcer) throw new Error(MESSAGE_PROTECTION);
  const result = await photos.copyIntoStore(sourcePath);
  nettoyerAncienneImage(db, current.photo_path, current.photo_thumb_path, id);
  db.prepare("UPDATE planning_articles SET photo_path = ?, photo_thumb_path = ?, updated_at = datetime('now') WHERE id = ?")
    .run(result.photo_path, result.photo_thumb_path, id);
  return get(db, id);
}

function retirerPhoto(db, id, forcer) {
  const current = db.prepare("SELECT * FROM planning_articles WHERE id = ?").get(id);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (estProtege(current.statut) && !forcer) throw new Error(MESSAGE_PROTECTION);
  nettoyerAncienneImage(db, current.photo_path, current.photo_thumb_path, id);
  db.prepare("UPDATE planning_articles SET photo_path = NULL, photo_thumb_path = NULL, updated_at = datetime('now') WHERE id = ?").run(id);
  return get(db, id);
}

// "Retirer du planning" : jamais destructeur pour un produit déjà lié (juste archivé). Un article
// purement prévisionnel, lui, peut être vraiment supprimé.
function retirerDuPlanning(db, id) {
  db.prepare("UPDATE planning_articles SET archived = 1, updated_at = datetime('now') WHERE id = ?").run(id);
}

function supprimerProvisoire(db, id) {
  const current = db.prepare("SELECT * FROM planning_articles WHERE id = ?").get(id);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (current.article_id) throw new Error("Cette entrée est liée à un produit existant — utilisez « Retirer du planning », pas « Supprimer ».");
  nettoyerAncienneImage(db, current.photo_path, current.photo_thumb_path, id);
  db.prepare("DELETE FROM planning_articles WHERE id = ?").run(id);
}

// Convertit une entrée prévisionnelle en véritable article ERP — jamais de double saisie : tout
// ce qui est déjà renseigné dans la planification alimente directement la création de l'article.
// L'entrée de planification RESTE, mais se voit désormais rattachée (article_id renseigné) :
// c'est ce qui permet d'afficher "Produit créé ✓" et de garder le lien entre les deux.
function convertirEnProduit(db, id, payloadArticle) {
  payloadArticle = payloadArticle || {};
  const current = db.prepare("SELECT * FROM planning_articles WHERE id = ?").get(id);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (current.article_id) throw new Error("Cette entrée est déjà liée à un produit.");

  const produitId = payloadArticle.produit_id || current.produit_id;
  const rayonId = payloadArticle.rayon_id || current.rayon_id;
  const saisonId = payloadArticle.saison_id || current.saison_id;
  const annee = payloadArticle.annee_collection || current.annee_collection;
  const abreviation = (payloadArticle.abreviation || current.reference_provisoire || "").toUpperCase().trim();

  // Plus aucune information n'est réellement bloquante ici : produit_id est désormais facultatif
  // sur articles (voir migrateArticleProduitNullable) — l'article se crée toujours, quitte à être
  // complété plus tard normalement depuis sa fiche.

  const uuid = crypto.randomUUID();
  const tx = db.transaction(() => {
    let articleId;
    // Une vraie référence peut être générée automatiquement seulement si TOUTES les pièces
    // nécessaires sont déjà connues (saison, année, rayon, abréviation valide) — sinon l'article
    // est créé "incomplet", comme n'importe quel article créé sans passer par Planification.
    const abreviationValide = ABREVIATION_REGEX.test(abreviation);
    if (saisonId && annee && rayonId && abreviationValide) {
      const MAX_TENTATIVES = 5;
      let derniereErreur = null;
      for (let i = 0; i < MAX_TENTATIVES; i++) {
        const saison = db.prepare("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'saison'").get(saisonId);
        const rayon = db.prepare("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'rayon'").get(rayonId);
        if (!saison || !rayon) break; // codes manquants : on retombe sur la création incomplète ci-dessous
        const sequentiel = prochainSequentiel(db, { saisonId, annee, rayonId, abreviation });
        const reference = genererReferencePrincipale({ saisonCode: saison.code, annee, rayonCode: rayon.code, abreviation, sequentiel });
        try {
          const info = db.prepare(
            "INSERT INTO articles (uuid, produit_id, saison_id, annee_collection, rayon_id, categorie_id, abreviation, numero_sequentiel, reference_principale, est_demo) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)"
          ).run(uuid, produitId, saisonId, annee, rayonId, current.categorie_id, abreviation, sequentiel, reference);
          articleId = info.lastInsertRowid;
          break;
        } catch (err) {
          derniereErreur = err;
          if (!String(err.message || "").toUpperCase().includes("UNIQUE")) throw err;
        }
      }
      if (!articleId) throw new Error("Impossible de générer une référence unique." + (derniereErreur ? " " + derniereErreur.message : ""));
    }
    if (!articleId) {
      const info = db.prepare(
        "INSERT INTO articles (uuid, produit_id, saison_id, annee_collection, rayon_id, categorie_id, abreviation, est_demo) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 0)"
      ).run(uuid, produitId, saisonId || null, annee || null, rayonId || null, current.categorie_id, abreviation || null);
      articleId = info.lastInsertRowid;
    }

    // La photo de planification devient la photo principale du nouvel article — copie physique
    // (et non un simple déplacement de chemin) pour que chaque table reste maîtresse de ses propres
    // fichiers et que leurs cycles de vie (suppression, remplacement) restent indépendants ensuite.
    if (current.photo_path) {
      db.prepare(
        "INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, 1, 1)"
      ).run(articleId, current.photo_path, current.photo_thumb_path || current.photo_path);
    }

    db.prepare(
      "UPDATE planning_articles SET article_id = ?, produit_cree_le = datetime('now'), updated_at = datetime('now') WHERE id = ?"
    ).run(articleId, id);

    return articleId;
  });
  const articleId = tx();
  return { articleId, planning: get(db, id) };
}

module.exports = {
  list: listPropre,
  get,
  kpis,
  creer,
  mettreAJour,
  deplacer,
  reordonner,
  ajouterPhoto,
  retirerPhoto,
  retirerDuPlanning,
  supprimerProvisoire,
  convertirEnProduit,
  estProtege,
};
