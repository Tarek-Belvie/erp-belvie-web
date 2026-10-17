const crypto = require("crypto");
const photos = require("./photos");

function genererNumeroBcPf(db) {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT dernier_numero FROM compteurs_bc_pf WHERE annee = ?").get(year);
  let next = row ? row.dernier_numero + 1 : 1;
  const exists = db.prepare("SELECT 1 FROM bc_pf WHERE numero = ?");
  while (exists.get("PF-" + year + "-" + String(next).padStart(4, "0"))) next += 1;
  if (!row) db.prepare("INSERT INTO compteurs_bc_pf (annee, dernier_numero) VALUES (?, ?)").run(year, next);
  else db.prepare("UPDATE compteurs_bc_pf SET dernier_numero = ? WHERE annee = ?").run(next, year);
  return "PF-" + year + "-" + String(next).padStart(4, "0");
}

function fetchSnapshotSource(db, commandeId) {
  return db.prepare(
    "SELECT c.id, c.numero, c.statut, c.type_production, c.atelier_id, c.priorite, c.date_fin_prevue, c.commentaires, c.responsable_nom, " +
    "ar.reference_principale AS article_reference_principale, p.nom AS produit, " +
    "s.nom AS saison, a.nom AS atelier, " +
    "(SELECT photo_path FROM article_photos WHERE article_id = ar.id AND est_principale = 1 LIMIT 1) AS photo_path " +
    "FROM commandes c " +
    "LEFT JOIN articles ar ON ar.id = c.article_id " +
    "LEFT JOIN listes_valeurs p ON p.id = ar.produit_id " +
    "LEFT JOIN listes_valeurs s ON s.id = ar.saison_id " +
    "LEFT JOIN listes_valeurs a ON a.id = c.atelier_id " +
    "WHERE c.id = ? AND c.deleted_at IS NULL"
  ).get(commandeId);
}

function fetchCommandeLignesNoms(db, commandeId) {
  // Alimente le taille_nom FIGÉ des lignes de BC PF. Doit lire la grille : avec
  // l'ancienne jointure sur listes_valeurs et des taille_id remappés, un document
  // officiel sortirait avec une taille vide ou fausse. COALESCE sur cl.taille_nom
  // couvre le cas d'une valeur retirée de sa grille après coup.
  return db.prepare(
    "SELECT co.nom AS couleur_nom, cl.reference_libre AS couleur_reference, " +
    "COALESCE(ta.valeur, cl.taille_nom) AS taille_nom, cl.quantite " +
    "FROM commande_lignes cl " +
    "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
    "LEFT JOIN grilles_tailles_valeurs ta ON ta.id = cl.taille_id " +
    "WHERE cl.commande_id = ?"
  ).all(commandeId);
}

function snapshotEntreprise(db) {
  const e = db.prepare("SELECT * FROM entreprise WHERE id = 1").get();
  if (!e) return { logoSnapshotPath: null, fields: {} };
  let logoSnapshotPath = null;
  try {
    logoSnapshotPath = photos.snapshotArticlePhoto(e.logo_path);
  } catch (err) {
    console.error("Snapshot du logo entreprise impossible (non bloquant) :", err);
  }
  return {
    logoSnapshotPath: logoSnapshotPath,
    fields: {
      entreprise_nom_commercial: e.nom_commercial,
      entreprise_raison_sociale: e.raison_sociale,
      entreprise_matricule_fiscal: e.matricule_fiscal,
      entreprise_registre_commerce: e.registre_commerce,
      entreprise_adresse: e.adresse,
      entreprise_telephone: e.telephone,
      entreprise_email: e.email,
      entreprise_banque: e.banque,
      entreprise_agence_bancaire: e.agence_bancaire,
      entreprise_rib: e.rib,
    },
  };
}

const STATUTS_AVEC_BC_POSSIBLE = ["validee", "en_production", "controle_qualite", "terminee", "annulee"];

function assertCommandeEligible(source) {
  if (!source) throw new Error("Commande introuvable.");
  if (STATUTS_AVEC_BC_POSSIBLE.indexOf(source.statut) === -1) {
    throw new Error("Seule une commande validée (ou à une étape ultérieure) peut avoir un bon de commande.");
  }
}

function insertDocument(db, numero, commandeId, source, photoSnapshotPath, entrepriseSnap, extra) {
  const lignes = fetchCommandeLignesNoms(db, source.id);
  const uuid = crypto.randomUUID();

  db.prepare(
    "INSERT INTO bc_pf (" +
      "uuid, numero, commande_id, atelier_id, statut, remplace_bc_pf_id, motif_remplacement, " +
      "commande_numero, article_nom, article_reference, type_production, atelier_nom, saison_nom, responsable_nom, " +
      "date_limite_production, priorite, photo_snapshot_path, " +
      "entreprise_nom_commercial, entreprise_raison_sociale, entreprise_matricule_fiscal, entreprise_registre_commerce, " +
      "entreprise_adresse, entreprise_telephone, entreprise_email, entreprise_banque, entreprise_agence_bancaire, " +
      "entreprise_rib, entreprise_logo_snapshot_path, notes_atelier, observations_internes, commande_synced_at" +
    ") VALUES (" +
      "@uuid, @numero, @commande_id, @atelier_id, 'brouillon', @remplace_bc_pf_id, @motif_remplacement, " +
      "@commande_numero, @article_nom, @article_reference, @type_production, @atelier_nom, @saison_nom, @responsable_nom, " +
      "@date_limite_production, @priorite, @photo_snapshot_path, " +
      "@entreprise_nom_commercial, @entreprise_raison_sociale, @entreprise_matricule_fiscal, @entreprise_registre_commerce, " +
      "@entreprise_adresse, @entreprise_telephone, @entreprise_email, @entreprise_banque, @entreprise_agence_bancaire, " +
      "@entreprise_rib, @entreprise_logo_snapshot_path, @notes_atelier, @observations_internes, datetime('now')" +
    ")"
  ).run(Object.assign({
    uuid: uuid,
    numero: numero,
    commande_id: commandeId,
    atelier_id: source.atelier_id,
    remplace_bc_pf_id: (extra && extra.remplace_bc_pf_id) || null,
    motif_remplacement: (extra && extra.motif_remplacement) || null,
    commande_numero: source.numero,
    article_nom: source.produit,
    article_reference: source.article_reference_principale,
    type_production: source.type_production,
    atelier_nom: source.atelier,
    saison_nom: source.saison,
    responsable_nom: source.responsable_nom,
    date_limite_production: source.date_fin_prevue,
    priorite: source.priorite,
    photo_snapshot_path: photoSnapshotPath,
    entreprise_logo_snapshot_path: entrepriseSnap.logoSnapshotPath,
    // Amorcé avec les commentaires de la commande (champ "Précision utile pour l'atelier..." du
    // formulaire de commande) — c'est l'endroit naturel où ces informations sont déjà saisies.
    // Reste ensuite modifiable indépendamment sur le BC PF lui-même, sans jamais être écrasé par
    // une resynchronisation ultérieure (voir mettreAJourDepuisCommande).
    notes_atelier: (extra && extra.notes_atelier) || source.commentaires || null,
    observations_internes: (extra && extra.observations_internes) || null,
  }, entrepriseSnap.fields));

  const bc = db.prepare("SELECT * FROM bc_pf WHERE uuid = ?").get(uuid);
  const insertLigne = db.prepare("INSERT INTO bc_pf_lignes (bc_pf_id, couleur_nom, couleur_reference, taille_nom, quantite) VALUES (?, ?, ?, ?, ?)");
  for (const l of lignes) insertLigne.run(bc.id, l.couleur_nom, l.couleur_reference, l.taille_nom, l.quantite);
  return bc.id;
}

function creerBcPf(db, commandeId) {
  const source = fetchSnapshotSource(db, commandeId);
  assertCommandeEligible(source);

  const existing = db.prepare(
    "SELECT id FROM bc_pf WHERE commande_id = ? AND atelier_id = ? AND statut NOT IN ('remplace','annule')"
  ).get(commandeId, source.atelier_id);
  if (existing) throw new Error("Un bon de commande PF existe déjà pour cette commande et cet atelier.");

  let photoSnapshotPath = null;
  try {
    photoSnapshotPath = photos.snapshotArticlePhoto(source.photo_path);
  } catch (err) {
    console.error("Snapshot de la photo impossible, le BC sera créé sans photo :", err);
  }
  const entrepriseSnap = snapshotEntreprise(db);

  const cleanup = function () {
    if (photoSnapshotPath) photos.removeSnapshotFile(photoSnapshotPath);
    if (entrepriseSnap.logoSnapshotPath) photos.removeSnapshotFile(entrepriseSnap.logoSnapshotPath);
  };

  let bcId;
  try {
    const numero = genererNumeroBcPf(db);
    const tx = db.transaction(function () {
      const stillNone = db.prepare(
        "SELECT id FROM bc_pf WHERE commande_id = ? AND atelier_id = ? AND statut NOT IN ('remplace','annule')"
      ).get(commandeId, source.atelier_id);
      if (stillNone) throw new Error("Un bon de commande PF existe déjà pour cette commande et cet atelier.");
      bcId = insertDocument(db, numero, commandeId, source, photoSnapshotPath, entrepriseSnap, null);
    });
    tx();
  } catch (err) {
    cleanup();
    throw err;
  }
  return get(db, bcId);
}

function getByCommandeId(db, commandeId) {
  return db.prepare("SELECT * FROM bc_pf WHERE commande_id = ? AND statut NOT IN ('remplace','annule')").get(commandeId) || null;
}

function listForCommande(db, commandeId) {
  const rows = db.prepare("SELECT * FROM bc_pf WHERE commande_id = ? ORDER BY id DESC").all(commandeId);
  const byId = new Map(rows.map(function (r) { return [r.id, r]; }));
  const remplacePar = new Map(); // bc_pf_id -> { id, numero } du document qui l'a remplacé
  rows.forEach(function (r) {
    if (r.remplace_bc_pf_id != null) remplacePar.set(r.remplace_bc_pf_id, { id: r.id, numero: r.numero, statut: r.statut });
  });
  return rows.map(function (r) {
    const ancien = r.remplace_bc_pf_id != null ? byId.get(r.remplace_bc_pf_id) : null;
    return Object.assign({}, r, {
      remplace_numero: ancien ? ancien.numero : null,
      remplace_par: remplacePar.get(r.id) || null,
    });
  });
}

function attachLignes(db, bc) {
  if (!bc) return null;
  const lignes = db.prepare("SELECT * FROM bc_pf_lignes WHERE bc_pf_id = ?").all(bc.id);
  return Object.assign({}, bc, { lignes: lignes });
}

function get(db, bcPfId) {
  const bc = db.prepare("SELECT * FROM bc_pf WHERE id = ?").get(bcPfId);
  if (!bc) return null;
  const remplacePar = db.prepare("SELECT id, numero, statut FROM bc_pf WHERE remplace_bc_pf_id = ?").get(bcPfId) || null;
  const remplaceQui = bc.remplace_bc_pf_id ? db.prepare("SELECT id, numero, statut FROM bc_pf WHERE id = ?").get(bc.remplace_bc_pf_id) : null;
  return Object.assign({}, attachLignes(db, bc), { remplace_par: remplacePar, remplace_qui: remplaceQui });
}

const CHAMPS_MODIFIABLES = ["notes_atelier", "observations_internes"];

function updateBrouillonDoc(db, bcPfId, patch) {
  const bc = db.prepare("SELECT * FROM bc_pf WHERE id = ?").get(bcPfId);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "brouillon") throw new Error("Ce document n'est plus modifiable.");

  const fields = CHAMPS_MODIFIABLES.filter(function (f) { return patch[f] !== undefined; });
  if (fields.length > 0) {
    const params = { id: bcPfId };
    fields.forEach(function (f) { params[f] = patch[f]; });
    const setClause = fields.map(function (f) { return f + " = @" + f; }).join(", ");
    db.prepare("UPDATE bc_pf SET " + setClause + " WHERE id = @id").run(params);
  }
  return get(db, bcPfId);
}

function mettreAJourDepuisCommande(db, bcPfId) {
  const bc = db.prepare("SELECT * FROM bc_pf WHERE id = ?").get(bcPfId);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "brouillon") {
    throw new Error("Ce document n'est plus en brouillon : utilisez « Créer un nouveau bon de commande » pour le remplacer.");
  }
  const source = fetchSnapshotSource(db, bc.commande_id);
  assertCommandeEligible(source);
  const lignes = fetchCommandeLignesNoms(db, source.id);

  const tx = db.transaction(function () {
    db.prepare(
      "UPDATE bc_pf SET commande_numero=@commande_numero, article_nom=@article_nom, article_reference=@article_reference, " +
      "type_production=@type_production, atelier_nom=@atelier_nom, saison_nom=@saison_nom, responsable_nom=@responsable_nom, " +
      "date_limite_production=@date_limite_production, " +
      "priorite=@priorite, atelier_id=@atelier_id, " +
      "notes_atelier=COALESCE(notes_atelier, @notes_atelier), " +
      "commande_synced_at=datetime('now') WHERE id=@id"
    ).run({
      id: bcPfId,
      commande_numero: source.numero, article_nom: source.produit, article_reference: source.article_reference_principale,
      type_production: source.type_production, atelier_nom: source.atelier, saison_nom: source.saison, responsable_nom: source.responsable_nom,
      date_limite_production: source.date_fin_prevue, priorite: source.priorite, atelier_id: source.atelier_id,
      notes_atelier: source.commentaires || null,
    });
    db.prepare("DELETE FROM bc_pf_lignes WHERE bc_pf_id = ?").run(bcPfId);
    const insertLigne = db.prepare("INSERT INTO bc_pf_lignes (bc_pf_id, couleur_nom, couleur_reference, taille_nom, quantite) VALUES (?, ?, ?, ?, ?)");
    for (const l of lignes) insertLigne.run(bcPfId, l.couleur_nom, l.couleur_reference, l.taille_nom, l.quantite);
  });
  tx();
  return get(db, bcPfId);
}

function validerBcPf(db, bcPfId) {
  const bc = db.prepare("SELECT * FROM bc_pf WHERE id = ?").get(bcPfId);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "brouillon") throw new Error("Seul un document en brouillon peut être validé.");
  db.prepare("UPDATE bc_pf SET statut = 'valide', validated_at = datetime('now') WHERE id = ?").run(bcPfId);
  return get(db, bcPfId);
}

function lancerBcPf(db, bcPfId) {
  const bc = db.prepare("SELECT * FROM bc_pf WHERE id = ?").get(bcPfId);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "valide") throw new Error("Seul un document déjà validé peut être lancé.");
  db.prepare("UPDATE bc_pf SET statut = 'lance', launched_at = datetime('now') WHERE id = ?").run(bcPfId);
  return get(db, bcPfId);
}

function remplacerBcPf(db, ancienBcPfId, motif) {
  if (!motif || !motif.trim()) throw new Error("Le motif du remplacement est obligatoire.");
  const ancien = db.prepare("SELECT * FROM bc_pf WHERE id = ?").get(ancienBcPfId);
  if (!ancien) throw new Error("Bon de commande introuvable.");
  if (ancien.statut !== "valide" && ancien.statut !== "lance") {
    throw new Error("Seul un document validé ou lancé peut être remplacé.");
  }
  const source = fetchSnapshotSource(db, ancien.commande_id);
  assertCommandeEligible(source);

  let photoSnapshotPath = null;
  try {
    photoSnapshotPath = photos.snapshotArticlePhoto(source.photo_path);
  } catch (err) {
    console.error("Snapshot de la photo impossible, le nouveau BC sera créé sans photo :", err);
  }
  const entrepriseSnap = snapshotEntreprise(db);

  const cleanup = function () {
    if (photoSnapshotPath) photos.removeSnapshotFile(photoSnapshotPath);
    if (entrepriseSnap.logoSnapshotPath) photos.removeSnapshotFile(entrepriseSnap.logoSnapshotPath);
  };

  let nouveauId;
  try {
    const numero = genererNumeroBcPf(db);
    const tx = db.transaction(function () {
      db.prepare("UPDATE bc_pf SET statut = 'remplace' WHERE id = ?").run(ancienBcPfId);
      nouveauId = insertDocument(db, numero, ancien.commande_id, source, photoSnapshotPath, entrepriseSnap, {
        remplace_bc_pf_id: ancienBcPfId,
        motif_remplacement: motif ? motif.trim() : null,
      });
    });
    tx();
  } catch (err) {
    cleanup();
    throw err;
  }
  return get(db, nouveauId);
}

module.exports = {
  creerBcPf: creerBcPf,
  getByCommandeId: getByCommandeId,
  listForCommande: listForCommande,
  get: get,
  updateBrouillonDoc: updateBrouillonDoc,
  mettreAJourDepuisCommande: mettreAJourDepuisCommande,
  validerBcPf: validerBcPf,
  lancerBcPf: lancerBcPf,
  remplacerBcPf: remplacerBcPf,
};
