// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — planning_articles.
//
// Adaptée de electron/ipc/planning.js pour la Phase 1 (Lot 2 — Planification).
//
// TROIS points de vigilance réels trouvés et corrigés en adaptant (tous
// vérifiés avec du code réel avant correction) :
//
//   1. La recherche (listPropre) utilisait LIKE '%...%' en SQL. SQLite : LIKE
//      est insensible à la casse PAR DÉFAUT (ASCII uniquement, jamais les
//      caractères accentués — même limitation que LOWER()). PostgreSQL : LIKE
//      est SENSIBLE à la casse par défaut — testé : une recherche "teddy" ne
//      trouvait plus "Teddy Bear". Corrigé en déplaçant le filtre de
//      recherche en JavaScript (lowerAsciiSeul, déjà utilisée pour
//      etapes.js), qui reproduit exactement le comportement ASCII-only de
//      SQLite — confirmé par test explicite avant intégration.
//
//   2. Six appels à datetime('now') intégrés directement dans le texte SQL —
//      fonction propre à SQLite, absente de PostgreSQL. Remplacés par un
//      horodatage calculé en JavaScript (new Date().toISOString()), transmis
//      comme paramètre — jamais appelé depuis le SQL.
//
//   3. db.transaction() (synchrone) remplacé par adapter.transaction(async
//      (tx) => {...}), déjà construit et testé lors du Lot 1.
//
// EXCLU DE CE LOT, volontairement (upload/suppression physique de fichiers,
// bloqué tant que Cloudflare R2 n'est pas configuré) :
//   - ajouterPhoto() : upload physique réel.
//   - nettoyerAncienneImage() / planningPhotoEstReferencee() : entièrement
//     liées à la suppression physique de fichiers, non reprises ici.
//   - Dans retirerPhoto() et supprimerProvisoire() : l'appel à
//     nettoyerAncienneImage() est omis (commentaire à l'endroit concerné) ;
//     la partie base de données (mise à NULL des chemins, suppression de la
//     ligne) EST reprise, car indépendante du stockage physique.
//
// Point observé, PAS corrigé (fidélité au comportement réel, pas au
// commentaire) : dans convertirEnProduit(), le commentaire du code original
// dit "copie physique" pour la photo transférée vers le nouvel article, mais
// le code réel ne fait qu'une copie du CHEMIN (chaîne de caractères) en
// base — aucun appel fichier à cet endroit précis. Reproduit tel quel.
//
// electron/ipc/planning.js n'est PAS modifié.
// ============================================================================

const crypto = require("crypto");
const { genererReferencePrincipale, prochainSequentiel, ABREVIATION_REGEX } = require("./references");

function lowerAsciiSeul(s) {
  return String(s).replace(/[A-Z]/g, (c) => c.toLowerCase());
}

const STATUTS_AVANT_VALIDATION = ["idee", "a_etudier", "prototype", "echantillon", "a_modifier"];
function estProtege(statut) {
  return statut !== "annule" && !STATUTS_AVANT_VALIDATION.includes(statut);
}
const CHAMPS_PROTEGES = ["produit_id", "rayon_id", "categorie_id", "saison_id", "annee_collection", "mois_prevu_production", "mois_prevu_reception", "quantite_previsionnelle", "coloris_previsionnels", "atelier_id"];
const MESSAGE_PROTECTION =
  "Cet article est déjà validé (ou à une étape ultérieure). La modification de ces données peut affecter les étapes suivantes. " +
  "Confirmez « Modifier malgré validation » pour continuer quand même.";

async function listPropre(adapter, filtres) {
  filtres = filtres || {};
  const clauses = ["p.archived = 0"];
  const params = [];
  if (filtres.mois) { clauses.push("p.mois_prevu_production = ?"); params.push(filtres.mois); }
  if (filtres.categorieId) { clauses.push("p.categorie_id = ?"); params.push(filtres.categorieId); }
  if (filtres.statut) { clauses.push("p.statut = ?"); params.push(filtres.statut); }
  if (filtres.saisonId) { clauses.push("p.saison_id = ?"); params.push(filtres.saisonId); }
  if (filtres.anneeCollection) { clauses.push("p.annee_collection = ?"); params.push(filtres.anneeCollection); }
  // La recherche (filtres.recherche) N'EST PAS traduite en SQL ici — voir en-tête de fichier :
  // filtrée en JavaScript après récupération, pour reproduire exactement le comportement
  // ASCII-only de LIKE sous SQLite, identique sur les deux moteurs.

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

  let rows = await adapter.all(sql, params);
  rows = rows.map((row) => ({
    ...row,
    nom_affiche: row.article_produit_nom || row.nom_provisoire || "Sans nom",
    reference_affichee: row.article_reference || row.reference_provisoire || null,
    photo_affichee: row.article_photo_path || row.photo_path || null,
    photo_affichee_thumb: row.article_photo_thumb_path || row.photo_thumb_path || null,
    est_provisoire: row.article_id == null ? 1 : 0,
    coloris: row.coloris_previsionnels ? row.coloris_previsionnels.split(",").map((c) => c.trim()).filter(Boolean) : [],
  }));

  if (filtres.recherche) {
    const cible = lowerAsciiSeul(filtres.recherche);
    rows = rows.filter((r) =>
      lowerAsciiSeul(r.nom_provisoire || "").includes(cible) ||
      lowerAsciiSeul(r.reference_provisoire || "").includes(cible) ||
      lowerAsciiSeul(r.article_produit_nom || "").includes(cible) ||
      lowerAsciiSeul(r.article_reference || "").includes(cible)
    );
  }
  return rows;
}

async function get(adapter, id) {
  const rows = await listPropre(adapter, {});
  return rows.find((r) => r.id === id) || null;
}

async function kpis(adapter) {
  const rows = await adapter.all("SELECT statut, COUNT(*) AS n FROM planning_articles WHERE archived = 0 GROUP BY statut", []);
  const parStatut = {};
  rows.forEach((r) => { parStatut[r.statut] = r.n; });
  const totalRow = await adapter.get("SELECT COUNT(*) AS n FROM planning_articles WHERE archived = 0", []);
  return {
    total: totalRow.n,
    en_developpement: (parStatut["a_etudier"] || 0) + (parStatut["prototype"] || 0) + (parStatut["a_modifier"] || 0),
    en_production: parStatut["en_production"] || 0,
    shooting_a_preparer: parStatut["shooting_a_preparer"] || 0,
    pret_au_lancement: parStatut["pret_au_lancement"] || 0,
    parStatut,
  };
}

function comparerMois(a, b) {
  return a.localeCompare(b);
}
function moisCourantISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
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

async function creer(adapter, payload) {
  assertValid(payload);
  const maxRow = await adapter.get("SELECT MAX(ordre) AS m FROM planning_articles WHERE mois_prevu_production = ? AND archived = 0", [payload.mois_prevu_production]);
  const maxOrdre = (maxRow && maxRow.m) || 0;
  const uuid = crypto.randomUUID();
  const info = await adapter.run(
    "INSERT INTO planning_articles " +
    "(uuid, article_id, nom_provisoire, reference_provisoire, produit_id, rayon_id, categorie_id, saison_id, annee_collection, " +
    " mois_prevu, mois_prevu_production, mois_prevu_reception, quantite_previsionnelle, coloris_previsionnels, statut, atelier_id, notes, ordre) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id",
    [
      uuid, payload.article_id || null, payload.nom_provisoire || null, payload.reference_provisoire || null,
      payload.produit_id || null, payload.rayon_id || null, payload.categorie_id || null, payload.saison_id || null,
      payload.annee_collection || null, payload.mois_prevu_production, payload.mois_prevu_production, payload.mois_prevu_reception || null,
      payload.quantite_previsionnelle || null, payload.coloris_previsionnels || null, payload.statut || "idee",
      payload.atelier_id || null, payload.notes || null, maxOrdre + 1,
    ]
  );
  return get(adapter, info.lastInsertRowid);
}

const CHAMPS_MODIFIABLES = [
  "nom_provisoire", "reference_provisoire", "produit_id", "rayon_id", "categorie_id", "saison_id", "annee_collection",
  "mois_prevu_production", "mois_prevu_reception",
  "quantite_previsionnelle", "coloris_previsionnels", "statut", "atelier_id", "notes",
];

async function mettreAJour(adapter, id, patch) {
  const current = await adapter.get("SELECT * FROM planning_articles WHERE id = ?", [id]);
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
  const valeurs = [];
  CHAMPS_MODIFIABLES.forEach((champ) => {
    if (patch[champ] !== undefined) {
      sets.push(`${champ} = ?`);
      valeurs.push(patch[champ] === "" ? null : patch[champ]);
    }
  });
  if (sets.length > 0) {
    sets.push("updated_at = ?");
    valeurs.push(new Date().toISOString());
    valeurs.push(id);
    await adapter.run(`UPDATE planning_articles SET ${sets.join(", ")} WHERE id = ?`, valeurs);
  }
  return get(adapter, id);
}

async function deplacer(adapter, id, champ, nouveauMois, orderedIds, forcer) {
  if (champ !== "mois_prevu_production" && champ !== "mois_prevu_reception") {
    throw new Error("Champ de date invalide.");
  }
  const current = await adapter.get("SELECT statut, mois_prevu_production, mois_prevu_reception FROM planning_articles WHERE id = ?", [id]);
  if (!current) throw new Error("Entrée de planification introuvable.");
  const changeReellementDeMois = nouveauMois !== current[champ];
  if (changeReellementDeMois && estProtege(current.statut) && !forcer) {
    throw new Error(MESSAGE_PROTECTION);
  }
  const productionFinale = champ === "mois_prevu_production" ? nouveauMois : current.mois_prevu_production;
  const receptionFinale = champ === "mois_prevu_reception" ? nouveauMois : current.mois_prevu_reception;
  if (champ === "mois_prevu_production") assertLancementPasDansLePasse(productionFinale);
  assertReceptionCoherente(productionFinale, receptionFinale);

  await adapter.transaction(async (tx) => {
    await tx.run(`UPDATE planning_articles SET ${champ} = ?, updated_at = ? WHERE id = ?`, [nouveauMois, new Date().toISOString(), id]);
    if (Array.isArray(orderedIds)) {
      for (let index = 0; index < orderedIds.length; index++) {
        await tx.run("UPDATE planning_articles SET ordre = ? WHERE id = ?", [index + 1, orderedIds[index]]);
      }
    }
  });
  return get(adapter, id);
}

async function reordonner(adapter, mois, orderedIds) {
  await adapter.transaction(async (tx) => {
    for (let index = 0; index < orderedIds.length; index++) {
      await tx.run("UPDATE planning_articles SET ordre = ? WHERE id = ?", [index + 1, orderedIds[index]]);
    }
  });
  return listPropre(adapter, { mois });
}

// Partie base de données de retirerPhoto() uniquement — voir en-tête de fichier : le nettoyage
// physique du fichier orphelin (nettoyerAncienneImage) est omis, différé au lot Fichiers/R2.
async function retirerPhoto(adapter, id, forcer) {
  const current = await adapter.get("SELECT * FROM planning_articles WHERE id = ?", [id]);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (estProtege(current.statut) && !forcer) throw new Error(MESSAGE_PROTECTION);
  await adapter.run("UPDATE planning_articles SET photo_path = NULL, photo_thumb_path = NULL, updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
  return get(adapter, id);
}

async function retirerDuPlanning(adapter, id) {
  await adapter.run("UPDATE planning_articles SET archived = 1, updated_at = ? WHERE id = ?", [new Date().toISOString(), id]);
}

// Partie base de données de supprimerProvisoire() uniquement — même omission que retirerPhoto()
// ci-dessus, voir en-tête de fichier.
async function supprimerProvisoire(adapter, id) {
  const current = await adapter.get("SELECT * FROM planning_articles WHERE id = ?", [id]);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (current.article_id) throw new Error("Cette entrée est liée à un produit existant — utilisez « Retirer du planning », pas « Supprimer ».");
  await adapter.run("DELETE FROM planning_articles WHERE id = ?", [id]);
}

async function convertirEnProduit(adapter, id, payloadArticle) {
  payloadArticle = payloadArticle || {};
  const current = await adapter.get("SELECT * FROM planning_articles WHERE id = ?", [id]);
  if (!current) throw new Error("Entrée de planification introuvable.");
  if (current.article_id) throw new Error("Cette entrée est déjà liée à un produit.");

  const produitId = payloadArticle.produit_id || current.produit_id;
  const rayonId = payloadArticle.rayon_id || current.rayon_id;
  const saisonId = payloadArticle.saison_id || current.saison_id;
  const annee = payloadArticle.annee_collection || current.annee_collection;
  const abreviation = (payloadArticle.abreviation || current.reference_provisoire || "").toUpperCase().trim();

  const uuid = crypto.randomUUID();

  const articleId = await adapter.transaction(async (tx) => {
    let articleId;
    const abreviationValide = ABREVIATION_REGEX.test(abreviation);
    if (saisonId && annee && rayonId && abreviationValide) {
      const MAX_TENTATIVES = 5;
      let derniereErreur = null;
      for (let i = 0; i < MAX_TENTATIVES; i++) {
        const saison = await tx.get("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'saison'", [saisonId]);
        const rayon = await tx.get("SELECT code FROM listes_valeurs WHERE id = ? AND type = 'rayon'", [rayonId]);
        if (!saison || !rayon) break;
        const sequentiel = await prochainSequentiel(tx, { saisonId, annee, rayonId, abreviation });
        const reference = genererReferencePrincipale({ saisonCode: saison.code, annee, rayonCode: rayon.code, abreviation, sequentiel });
        try {
          const info = await tx.run(
            "INSERT INTO articles (uuid, produit_id, saison_id, annee_collection, rayon_id, categorie_id, abreviation, numero_sequentiel, reference_principale, est_demo) " +
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0) RETURNING id",
            [uuid, produitId, saisonId, annee, rayonId, current.categorie_id, abreviation, sequentiel, reference]
          );
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
      const info = await tx.run(
        "INSERT INTO articles (uuid, produit_id, saison_id, annee_collection, rayon_id, categorie_id, abreviation, est_demo) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, 0) RETURNING id",
        [uuid, produitId, saisonId || null, annee || null, rayonId || null, current.categorie_id, abreviation || null]
      );
      articleId = info.lastInsertRowid;
    }

    // Copie du CHEMIN uniquement (chaîne de caractères) — voir en-tête de fichier : aucun appel
    // fichier ici dans le code réel, malgré le commentaire d'origine qui suggère une copie
    // physique. Reproduit exactement tel quel.
    if (current.photo_path) {
      await tx.run(
        "INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre) VALUES (?, ?, ?, 1, 1)",
        [articleId, current.photo_path, current.photo_thumb_path || current.photo_path]
      );
    }

    await tx.run(
      "UPDATE planning_articles SET article_id = ?, produit_cree_le = ?, updated_at = ? WHERE id = ?",
      [articleId, new Date().toISOString(), new Date().toISOString(), id]
    );

    return articleId;
  });

  return { articleId, planning: await get(adapter, id) };
}

module.exports = {
  list: listPropre, get, kpis, creer, mettreAJour, deplacer, reordonner,
  retirerPhoto, retirerDuPlanning, supprimerProvisoire, convertirEnProduit, estProtege,
};
