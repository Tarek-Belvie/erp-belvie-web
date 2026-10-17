const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { normalizeNom } = require("./normalize");
const DEFAULTS = require("./defaults");
const photos = require("../ipc/photos");

function needsListesMigration(db) {
  const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  // Ancien schéma : colonnes texte "produit" présentes, nouvelles colonnes "produit_id" absentes.
  return cols.includes("produit") && !cols.includes("produit_id");
}

function migrateToListesValeurs(db) {
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS listes_valeurs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier')),
        nom TEXT NOT NULL,
        nom_normalise TEXT NOT NULL,
        actif INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(type, nom_normalise)
      );
    `);

    const findStmt = db.prepare("SELECT id, actif FROM listes_valeurs WHERE type = ? AND nom_normalise = ?");
    const insertStmt = db.prepare("INSERT INTO listes_valeurs (type, nom, nom_normalise, actif) VALUES (?, ?, ?, 1)");
    const reactivateStmt = db.prepare("UPDATE listes_valeurs SET actif = 1 WHERE id = ?");

    function upsert(type, nomRaw) {
      const nom = String(nomRaw || "").trim() || "Non renseigné";
      const norm = normalizeNom(nom);
      const found = findStmt.get(type, norm);
      if (found) {
        if (!found.actif) reactivateStmt.run(found.id);
        return found.id;
      }
      const info = insertStmt.run(type, nom, norm);
      return info.lastInsertRowid;
    }

    // On ne pré-remplit plus avec des noms d'exemple (T-shirt Essentiel, Sami...) : une base
    // réelle en cours de mise à niveau ne doit recevoir que des valeurs réellement utilisées par
    // ses propres commandes (voir la boucle ci-dessous), jamais de données fictives.
    const defaultAtelierId = upsert("atelier", "Atelier à renseigner");

    db.exec("ALTER TABLE commandes ADD COLUMN produit_id INTEGER");
    db.exec("ALTER TABLE commandes ADD COLUMN couleur_id INTEGER");
    db.exec("ALTER TABLE commandes ADD COLUMN responsable_id INTEGER");
    db.exec("ALTER TABLE commandes ADD COLUMN atelier_id INTEGER");

    const rows = db.prepare("SELECT id, produit, couleur, responsable FROM commandes").all();
    const backfillStmt = db.prepare(
      "UPDATE commandes SET produit_id = ?, couleur_id = ?, responsable_id = ?, atelier_id = ? WHERE id = ?"
    );
    for (const r of rows) {
      const pid = upsert("produit", r.produit);
      const cid = upsert("couleur", r.couleur);
      const rid = upsert("responsable", r.responsable);
      backfillStmt.run(pid, cid, rid, defaultAtelierId, r.id);
    }

    // Reconstruction de la table "commandes" pour passer aux nouvelles colonnes NOT NULL et
    // retirer les anciennes colonnes texte — méthode standard SQLite (create / copy / drop / rename)
    // car ALTER TABLE ne permet pas d'ajouter directement une contrainte NOT NULL a posteriori.
    db.exec(`
      CREATE TABLE commandes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        numero TEXT NOT NULL UNIQUE,
        produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        couleur_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        quantite INTEGER NOT NULL CHECK (quantite > 0),
        responsable_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        atelier_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        date_lancement TEXT NOT NULL,
        date_fin_prevue TEXT NOT NULL,
        etape_id INTEGER NOT NULL REFERENCES etapes(id),
        statut TEXT NOT NULL DEFAULT 'en_attente'
          CHECK (statut IN ('en_attente','en_cours','bloquee','terminee','annulee')),
        priorite TEXT NOT NULL DEFAULT 'normale'
          CHECK (priorite IN ('haute','normale','faible')),
        blocage_motif TEXT,
        commentaires TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        est_demo INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (date_fin_prevue >= date_lancement),
        CHECK (statut <> 'bloquee' OR (blocage_motif IS NOT NULL AND TRIM(blocage_motif) <> ''))
      );

      INSERT INTO commandes_new
        (id, uuid, numero, produit_id, couleur_id, quantite, responsable_id, atelier_id,
         date_lancement, date_fin_prevue, etape_id, statut, priorite, blocage_motif, commentaires,
         archived, est_demo, deleted_at, created_at, updated_at)
      SELECT
        id, uuid, numero, produit_id, couleur_id, quantite, responsable_id, atelier_id,
        date_lancement, date_fin_prevue, etape_id, statut, priorite, blocage_motif, commentaires,
        archived, est_demo, deleted_at, created_at, updated_at
      FROM commandes;

      DROP TABLE commandes;
      ALTER TABLE commandes_new RENAME TO commandes;
    `);
  });

  run();
}

function needsPhotoColumns(db) {
  const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  const hasPhotoPath = cols.includes("photo_path") && cols.includes("photo_thumb_path");
  if (hasPhotoPath) return false;
  // Ces colonnes ne servent que d'étape transitoire pour une base encore en ancien schéma
  // (avant le passage aux articles) : ni une base neuve, ni une base déjà migrée vers les
  // articles (article_id présent, produit_id absent) n'en ont besoin.
  return cols.includes("produit_id");
}

// Contrairement à la migration des listes, ces colonnes sont nullables : un simple ADD COLUMN
// suffit, pas besoin de reconstruire la table.
function migrateAddPhotoColumns(db) {
  const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  const run = db.transaction(() => {
    if (!cols.includes("photo_path")) db.exec("ALTER TABLE commandes ADD COLUMN photo_path TEXT");
    if (!cols.includes("photo_thumb_path")) db.exec("ALTER TABLE commandes ADD COLUMN photo_thumb_path TEXT");
  });
  run();
}

// --- Coordonnées bancaires de l'entreprise (banque, agence) ---
// Colonnes nullables ajoutées après la première livraison de la table "entreprise" : les bases
// déjà migrées vers cette table ne les ont pas encore. Simple ADD COLUMN, aucune reconstruction.
function needsEntrepriseBanqueColumns(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entreprise'").all();
  if (tables.length === 0) return false; // schema.sql vient de la créer avec les colonnes déjà présentes
  const cols = db.prepare("PRAGMA table_info(entreprise)").all().map((c) => c.name);
  return !cols.includes("banque") || !cols.includes("agence_bancaire");
}

function migrateAddEntrepriseBanqueColumns(db) {
  const cols = db.prepare("PRAGMA table_info(entreprise)").all().map((c) => c.name);
  const run = db.transaction(() => {
    if (!cols.includes("banque")) db.exec("ALTER TABLE entreprise ADD COLUMN banque TEXT");
    if (!cols.includes("agence_bancaire")) db.exec("ALTER TABLE entreprise ADD COLUMN agence_bancaire TEXT");
  });
  run();
}

// --- Multi-couleurs / multi-tailles ---

function needsListesOrdreMigration(db) {
  const cols = db.prepare("PRAGMA table_info(listes_valeurs)").all().map((c) => c.name);
  return !cols.includes("ordre");
}

// Ajoute la colonne "ordre" (utilisée par les tailles) et le type "taille" à la contrainte CHECK.
// SQLite ne permet pas de modifier un CHECK existant : reconstruction nécessaire, comme pour
// la migration précédente des listes.
function migrateListesOrdre(db) {
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE listes_valeurs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier','taille')),
        nom TEXT NOT NULL,
        nom_normalise TEXT NOT NULL,
        ordre INTEGER,
        actif INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(type, nom_normalise)
      );
      INSERT INTO listes_valeurs_new (id, type, nom, nom_normalise, ordre, actif, created_at)
      SELECT id, type, nom, nom_normalise, NULL, actif, created_at FROM listes_valeurs;
      DROP TABLE listes_valeurs;
      ALTER TABLE listes_valeurs_new RENAME TO listes_valeurs;
    `);
  });
  run();
}

function needsLignesMigration(db) {
  const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  // Ancien schéma : "couleur_id" encore présente sur commandes (avant l'éclatement en lignes).
  return cols.includes("couleur_id") || !cols.includes("quantite_totale");
}

// Une commande n'a plus "une" couleur et "une" quantité : ces informations deviennent des
// lignes (commande_lignes). Chaque commande existante devient une ligne unique
// (sa couleur d'origine, sans taille précisée, sa quantité d'origine) — rien n'est perdu.
function migrateToCommandeLignes(db) {
  const run = db.transaction(() => {
    // S'assure que les tailles par défaut existent, y compris sur une base déjà en usage
    // (le seed normal ne s'exécute que sur une base totalement vide).
    const findListe = db.prepare("SELECT id, actif FROM listes_valeurs WHERE type = 'taille' AND nom_normalise = ?");
    const insertListe = db.prepare(
      "INSERT INTO listes_valeurs (type, nom, nom_normalise, ordre, actif) VALUES ('taille', ?, ?, ?, 1)"
    );
    DEFAULTS.TAILLES.forEach((nom, index) => {
      const norm = normalizeNom(nom);
      const found = findListe.get(norm);
      if (!found) insertListe.run(nom, norm, index + 1);
    });

    // Capture des anciennes données AVANT de reconstruire la table (couleur_id va disparaître).
    const hasCouleurId = db.prepare("PRAGMA table_info(commandes)").all().some((c) => c.name === "couleur_id");
    const hasQuantite = db.prepare("PRAGMA table_info(commandes)").all().some((c) => c.name === "quantite");
    const oldRows = hasCouleurId
      ? db.prepare(`SELECT id, couleur_id, ${hasQuantite ? "quantite" : "quantite_totale"} AS quantite FROM commandes`).all()
      : [];

    db.exec(`
      CREATE TABLE IF NOT EXISTS commande_lignes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
        couleur_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        taille_id INTEGER REFERENCES listes_valeurs(id),
        quantite INTEGER NOT NULL CHECK (quantite > 0)
      );

      CREATE TABLE commandes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        numero TEXT NOT NULL UNIQUE,
        produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        responsable_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        atelier_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        quantite_totale INTEGER NOT NULL DEFAULT 0,
        date_lancement TEXT NOT NULL,
        date_fin_prevue TEXT NOT NULL,
        etape_id INTEGER NOT NULL REFERENCES etapes(id),
        statut TEXT NOT NULL DEFAULT 'en_attente'
          CHECK (statut IN ('en_attente','en_cours','bloquee','terminee','annulee')),
        priorite TEXT NOT NULL DEFAULT 'normale'
          CHECK (priorite IN ('haute','normale','faible')),
        blocage_motif TEXT,
        commentaires TEXT,
        photo_path TEXT,
        photo_thumb_path TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        est_demo INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (date_fin_prevue >= date_lancement),
        CHECK (statut <> 'bloquee' OR (blocage_motif IS NOT NULL AND TRIM(blocage_motif) <> ''))
      );

      INSERT INTO commandes_new
        (id, uuid, numero, produit_id, responsable_id, atelier_id, quantite_totale,
         date_lancement, date_fin_prevue, etape_id, statut, priorite, blocage_motif, commentaires,
         photo_path, photo_thumb_path, archived, est_demo, deleted_at, created_at, updated_at)
      SELECT
        id, uuid, numero, produit_id, responsable_id, atelier_id, ${hasQuantite ? "quantite" : "quantite_totale"},
        date_lancement, date_fin_prevue, etape_id, statut, priorite, blocage_motif, commentaires,
        photo_path, photo_thumb_path, archived, est_demo, deleted_at, created_at, updated_at
      FROM commandes;

      DROP TABLE commandes;
      ALTER TABLE commandes_new RENAME TO commandes;
    `);

    const insertLigne = db.prepare(
      "INSERT INTO commande_lignes (commande_id, couleur_id, taille_id, quantite) VALUES (?, ?, NULL, ?)"
    );
    for (const r of oldRows) {
      if (r.couleur_id && r.quantite > 0) insertLigne.run(r.id, r.couleur_id, r.quantite);
    }
  });
  run();
}

// --- BC PF : passage au modèle "un document = une ligne", sans notion de version. Remplace
// l'ancienne structure "BC logique + versions" : chaque ancienne version devient un document BC
// PF à part entière, chaîné via remplace_bc_pf_id (celle qui a été remplacée passe au statut
// 'remplace'). Gère aussi le cas d'une base encore plus ancienne (table bc_pf unique, sans
// bc_pf_versions du tout) : elle est alors simplement complétée avec les nouvelles colonnes.
function needsBcPfSingleDocMigration(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bc_pf'").all();
  if (tables.length === 0) return false; // schema.sql vient de la créer directement dans sa forme finale
  const cols = db.prepare("PRAGMA table_info(bc_pf)").all().map((c) => c.name);
  return !cols.includes("remplace_bc_pf_id"); // présent uniquement dans la forme finale : marqueur fiable
}

function migrateToBcPfSingleDoc(db) {
  const aBcPfVersions = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bc_pf_versions'").all().length > 0;
  const anciensLogiques = db.prepare("SELECT * FROM bc_pf").all();
  console.log("[migration]   BC PF logiques à convertir : " + anciensLogiques.length + " (forme précédente : " + (aBcPfVersions ? "BC logique + versions" : "document unique") + ")");

  const run = db.transaction(() => {
    db.exec("ALTER TABLE bc_pf RENAME TO bc_pf_old");
    if (aBcPfVersions) db.exec("ALTER TABLE bc_pf_versions RENAME TO bc_pf_versions_old");
    // bc_pf_lignes a pu déjà être créée vide par schema.sql avant cette migration (référençant
    // "bc_pf" par son nom) : ALTER TABLE RENAME réécrit silencieusement cette référence vers
    // "bc_pf_old", donc on la supprime (sans risque, garantie vide) et on la recrée après.
    db.exec("DROP TABLE IF EXISTS bc_pf_lignes");

    db.exec(
      "CREATE TABLE bc_pf (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, uuid TEXT NOT NULL UNIQUE, numero TEXT NOT NULL UNIQUE, " +
        "commande_id INTEGER NOT NULL REFERENCES commandes(id), atelier_id INTEGER REFERENCES listes_valeurs(id), " +
        "statut TEXT NOT NULL DEFAULT 'brouillon', remplace_bc_pf_id INTEGER REFERENCES bc_pf(id), motif_remplacement TEXT, " +
        "commande_numero TEXT, article_nom TEXT, article_reference TEXT, type_production TEXT, " +
        "atelier_nom TEXT, saison_nom TEXT, date_limite_production TEXT, priorite TEXT, photo_snapshot_path TEXT, " +
        "entreprise_nom_commercial TEXT, entreprise_raison_sociale TEXT, entreprise_matricule_fiscal TEXT, " +
        "entreprise_registre_commerce TEXT, entreprise_adresse TEXT, entreprise_telephone TEXT, entreprise_email TEXT, " +
        "entreprise_banque TEXT, entreprise_agence_bancaire TEXT, entreprise_rib TEXT, entreprise_logo_snapshot_path TEXT, " +
        "notes_atelier TEXT, observations_internes TEXT, commande_synced_at TEXT, " +
        "created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), " +
        "validated_at TEXT, launched_at TEXT);"
    );
    db.exec(
      "CREATE TABLE bc_pf_lignes (" +
        "id INTEGER PRIMARY KEY AUTOINCREMENT, bc_pf_id INTEGER NOT NULL REFERENCES bc_pf(id) ON DELETE CASCADE, " +
        "couleur_nom TEXT NOT NULL, taille_nom TEXT, quantite INTEGER NOT NULL);"
    );

    const insertBcPf = db.prepare(
      "INSERT INTO bc_pf (" +
        "id, uuid, numero, commande_id, atelier_id, statut, remplace_bc_pf_id, motif_remplacement, " +
        "commande_numero, article_nom, article_reference, type_production, atelier_nom, saison_nom, " +
        "date_limite_production, priorite, photo_snapshot_path, " +
        "entreprise_nom_commercial, entreprise_raison_sociale, entreprise_matricule_fiscal, entreprise_registre_commerce, " +
        "entreprise_adresse, entreprise_telephone, entreprise_email, entreprise_banque, entreprise_agence_bancaire, " +
        "entreprise_rib, entreprise_logo_snapshot_path, notes_atelier, observations_internes, commande_synced_at, " +
        "created_at, updated_at, validated_at, launched_at" +
      ") VALUES (" +
        "@id, @uuid, @numero, @commande_id, @atelier_id, @statut, @remplace_bc_pf_id, @motif_remplacement, " +
        "@commande_numero, @article_nom, @article_reference, @type_production, @atelier_nom, @saison_nom, " +
        "@date_limite_production, @priorite, @photo_snapshot_path, " +
        "@entreprise_nom_commercial, @entreprise_raison_sociale, @entreprise_matricule_fiscal, @entreprise_registre_commerce, " +
        "@entreprise_adresse, @entreprise_telephone, @entreprise_email, @entreprise_banque, @entreprise_agence_bancaire, " +
        "@entreprise_rib, @entreprise_logo_snapshot_path, @notes_atelier, @observations_internes, @commande_synced_at, " +
        "@created_at, @updated_at, @validated_at, @launched_at)"
    );
    const insertLigne = db.prepare("INSERT INTO bc_pf_lignes (bc_pf_id, couleur_nom, taille_nom, quantite) VALUES (?, ?, ?, ?)");

    let nextId = (db.prepare("SELECT MAX(id) AS m FROM bc_pf_old").get().m || 0) + 1;
    let compteurDocuments = 0;

    for (const ancien of anciensLogiques) {
      if (!aBcPfVersions) {
        // Forme la plus ancienne : bc_pf était déjà un document unique avec ses champs figés
        // directement dessus (pas de bc_pf_versions du tout). On la reprend telle quelle.
        insertBcPf.run({
          id: ancien.id, uuid: ancien.uuid, numero: ancien.numero, commande_id: ancien.commande_id,
          atelier_id: ancien.atelier_id != null ? ancien.atelier_id : null,
          statut: ancien.statut || "brouillon", remplace_bc_pf_id: null, motif_remplacement: null,
          commande_numero: ancien.commande_numero, article_nom: ancien.article_nom, article_reference: ancien.article_reference,
          type_production: ancien.type_production, atelier_nom: ancien.atelier_nom, saison_nom: ancien.saison_nom,
          date_limite_production: ancien.date_production_prevue || null, priorite: null,
          photo_snapshot_path: ancien.photo_snapshot_path,
          entreprise_nom_commercial: null, entreprise_raison_sociale: null, entreprise_matricule_fiscal: null,
          entreprise_registre_commerce: null, entreprise_adresse: null, entreprise_telephone: null, entreprise_email: null,
          entreprise_banque: null, entreprise_agence_bancaire: null, entreprise_rib: null, entreprise_logo_snapshot_path: null,
          notes_atelier: ancien.notes_atelier, observations_internes: ancien.observations_internes, commande_synced_at: null,
          created_at: ancien.created_at, updated_at: ancien.updated_at, validated_at: null, launched_at: null,
        });
        // Cette migration s'exécute AVANT migrateGrillesTailles (index.js : 195 puis 215),
        // donc taille_id désigne alors encore listes_valeurs. La résolution ci-dessous reste
        // néanmoins valable dans les deux sens : sur une base déjà remappée, taille_nom ou la
        // grille prennent le relais. listes_valeurs est restreint aux types taille/pointure
        // pour qu'un identifiant de grille ne résolve jamais vers un nom de couleur.
        const lignes = db.prepare(
          "SELECT co.nom AS couleur_nom, COALESCE(cl.taille_nom, gtv.valeur, ta.nom) AS taille_nom, cl.quantite " +
          "FROM commande_lignes cl " +
          "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
          "LEFT JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id " +
          "LEFT JOIN listes_valeurs ta ON ta.id = cl.taille_id AND ta.type IN ('taille','pointure') " +
          "WHERE cl.commande_id = ?"
        ).all(ancien.commande_id);
        for (const l of lignes) insertLigne.run(ancien.id, l.couleur_nom, l.taille_nom, l.quantite);
        compteurDocuments += 1;
        continue;
      }

      // Forme "BC logique + versions" : chaque version devient un document séparé, chaîné.
      const versions = db.prepare("SELECT * FROM bc_pf_versions_old WHERE bc_pf_id = ? ORDER BY version ASC").all(ancien.id);
      const lignesParVersion = {};
      for (const v of versions) {
        lignesParVersion[v.id] = db.prepare("SELECT couleur_nom, taille_nom, quantite FROM bc_pf_version_lignes WHERE bc_pf_version_id = ?").all(v.id);
      }

      let precedentNouvelId = null;
      versions.forEach((v, index) => {
        const estLaDerniere = index === versions.length - 1;
        const nouvelId = nextId; nextId += 1;
        // La dernière version garde le numéro d'origine (c'est le document réellement identifié
        // par ce numéro aujourd'hui) ; les précédentes, désormais remplacées, reçoivent un
        // repère distinct pour rester uniques sans jamais consommer le compteur séquentiel.
        const numero = estLaDerniere ? ancien.numero : ancien.numero + "-ANC-V" + v.version;
        const statut = estLaDerniere ? (v.statut || "brouillon") : "remplace";

        insertBcPf.run({
          id: nouvelId, uuid: index === 0 ? ancien.uuid : crypto.randomUUID(),
          numero: numero, commande_id: ancien.commande_id, atelier_id: ancien.atelier_id,
          statut: statut, remplace_bc_pf_id: precedentNouvelId,
          motif_remplacement: v.motif_correction || null,
          commande_numero: v.commande_numero, article_nom: v.article_nom, article_reference: v.article_reference,
          type_production: v.type_production, atelier_nom: v.atelier_nom, saison_nom: v.saison_nom,
          date_limite_production: v.date_limite_production, priorite: v.priorite, photo_snapshot_path: v.photo_snapshot_path,
          entreprise_nom_commercial: v.entreprise_nom_commercial, entreprise_raison_sociale: v.entreprise_raison_sociale,
          entreprise_matricule_fiscal: v.entreprise_matricule_fiscal, entreprise_registre_commerce: v.entreprise_registre_commerce,
          entreprise_adresse: v.entreprise_adresse, entreprise_telephone: v.entreprise_telephone, entreprise_email: v.entreprise_email,
          entreprise_banque: v.entreprise_banque, entreprise_agence_bancaire: v.entreprise_agence_bancaire, entreprise_rib: v.entreprise_rib,
          entreprise_logo_snapshot_path: v.entreprise_logo_snapshot_path,
          notes_atelier: v.notes_atelier, observations_internes: v.observations_internes,
          commande_synced_at: v.commande_synced_at, created_at: v.created_at, updated_at: v.updated_at,
          validated_at: v.validated_at, launched_at: v.launched_at,
        });
        for (const l of (lignesParVersion[v.id] || [])) insertLigne.run(nouvelId, l.couleur_nom, l.taille_nom, l.quantite);
        precedentNouvelId = nouvelId;
        compteurDocuments += 1;
      });
    }

    db.exec("DROP TABLE bc_pf_old");
    if (aBcPfVersions) {
      db.exec("DROP TABLE bc_pf_version_lignes");
      db.exec("DROP TABLE bc_pf_versions_old");
    }

    const apres = db.prepare("SELECT COUNT(*) AS n FROM bc_pf").get().n;
    if (apres !== compteurDocuments) {
      throw new Error("Contrôle de cohérence échoué : " + compteurDocuments + " documents attendus, " + apres + " trouvés.");
    }
    console.log("[migration]   Contrôle : " + apres + " document(s) BC PF après conversion.");
  });
  run();
}

// --- Déclinaisons : ajout de affichage_couleur (déjà livré sans cette colonne) ---
function needsDeclinaisonAffichageCouleurColumn(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='declinaison_types'").all();
  if (tables.length === 0) return false; // schema.sql vient de la créer avec la colonne déjà présente
  const cols = db.prepare("PRAGMA table_info(declinaison_types)").all().map((c) => c.name);
  return !cols.includes("affichage_couleur");
}

function migrateAddDeclinaisonAffichageCouleurColumn(db) {
  db.exec("ALTER TABLE declinaison_types ADD COLUMN affichage_couleur INTEGER NOT NULL DEFAULT 0");
}

// Le module Fiche Technique a évolué plusieurs fois pendant sa conception (colonnes d'annotation
// renommées, tailles reliées aux Déclinaisons, statut ajouté...) via des éditions directes de
// schema.sql plutôt que des migrations, sur la base d'un raisonnement "rien n'a encore été livré"
// qui s'est révélé faux : l'utilisateur relance l'app entre chaque échange, donc sa base locale
// peut être restée bloquée sur une forme antérieure d'une de ces tables — CREATE TABLE IF NOT
// EXISTS ne fait rien si la table existe déjà, même sous une forme obsolète. On détecte ce cas via
// la présence de "statut" (ajoutée avec toutes les autres colonnes de la grande révision) et, si
// absente, on reconstruit tout le module à partir de zéro : ces tables n'ont jamais contenu de
// données de production, seulement des essais pendant la mise au point.
function needsFicheTechniqueRebuild(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fiches_techniques'").all();
  if (tables.length === 0) return false; // schema.sql vient de tout créer avec la forme actuelle
  const cols = db.prepare("PRAGMA table_info(fiches_techniques)").all().map((c) => c.name);
  return !cols.includes("statut") || !cols.includes("mesures_etat") || !cols.includes("tailles_confirmees");
}

function migrateRebuildFicheTechnique(db) {
  db.exec(`
    DROP TABLE IF EXISTS ft_mesures_valeurs;
    DROP TABLE IF EXISTS ft_accessoires;
    DROP TABLE IF EXISTS ft_mesures_lignes;
    DROP TABLE IF EXISTS ft_tailles;
    DROP TABLE IF EXISTS ft_types_gradation;
    DROP TABLE IF EXISTS ft_annotations;
    DROP TABLE IF EXISTS ft_croquis;
    DROP TABLE IF EXISTS fiches_techniques;
  `);
  // mesures_catalogue et accessoires_catalogue ne sont volontairement PAS supprimées ici : leur
  // forme n'a pas changé dans cette révision, et mesures_catalogue est maintenant aussi référencée
  // par modeles_mesures_lignes (table préservée par une autre migration) — la vider casserait ces
  // références. schema.sql (CREATE TABLE IF NOT EXISTS) ne les touchera pas puisqu'elles existent déjà.
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
}

// needsAtelierResponsableTable / migrateAddAtelierResponsableTable ont existé un temps, avant la
// simplification du responsable (voir migrateResponsableSimplification, qui supprime cette table
// devenue inutile). Retirées définitivement pour ne jamais la recréer.

function needsArticleCategorieColumn(db) {
  const cols = db.prepare("PRAGMA table_info(articles)").all().map((c) => c.name);
  return !cols.includes("categorie_id");
}

function migrateAddArticleCategorieColumn(db) {
  db.exec("ALTER TABLE articles ADD COLUMN categorie_id INTEGER REFERENCES listes_valeurs(id)");
}

function needsPlanningArticlesTable(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planning_articles'").all();
  return tables.length === 0;
}

function migrateAddPlanningArticlesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS planning_articles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      article_id INTEGER REFERENCES articles(id),
      nom_provisoire TEXT,
      reference_provisoire TEXT,
      photo_path TEXT,
      photo_thumb_path TEXT,
      categorie_id INTEGER REFERENCES listes_valeurs(id),
      saison_id INTEGER REFERENCES listes_valeurs(id),
      annee_collection INTEGER,
      mois_prevu TEXT NOT NULL,
      quantite_previsionnelle INTEGER,
      coloris_previsionnels TEXT,
      statut TEXT NOT NULL DEFAULT 'idee' CHECK (statut IN (
        'idee', 'a_etudier', 'prototype', 'echantillon', 'a_modifier', 'valide',
        'a_produire', 'en_production', 'production_terminee', 'shooting_a_preparer',
        'pret_au_lancement', 'lance', 'annule'
      )),
      atelier_id INTEGER REFERENCES listes_valeurs(id),
      notes TEXT,
      ordre INTEGER NOT NULL DEFAULT 0,
      produit_cree_le TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function needsPosteCoutAjoutAutoColumn(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='postes_cout_predefinis'").get();
  if (tables.n === 0) return false;
  const cols = db.prepare("PRAGMA table_info(postes_cout_predefinis)").all().map((c) => c.name);
  return !cols.includes("ajouter_automatiquement");
}

function migrateAjouterPosteCoutAjoutAutoColumn(db) {
  const cols = db.prepare("PRAGMA table_info(postes_cout_predefinis)").all().map((c) => c.name);
  if (!cols.includes("ajouter_automatiquement")) {
    db.exec("ALTER TABLE postes_cout_predefinis ADD COLUMN ajouter_automatiquement INTEGER NOT NULL DEFAULT 0");
  }
}

function needsAchatMatiereColonnesStock(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='achats'").get();
  if (tables.n === 0) return false;
  const cols = db.prepare("PRAGMA table_info(achats)").all().map((c) => c.name);
  return !cols.includes("matiere_catalogue_id") || !cols.includes("couleur");
}

function migrateAjouterAchatMatiereColonnesStock(db) {
  const cols = db.prepare("PRAGMA table_info(achats)").all().map((c) => c.name);
  if (!cols.includes("matiere_catalogue_id")) {
    db.exec("ALTER TABLE achats ADD COLUMN matiere_catalogue_id INTEGER REFERENCES matieres_catalogue(id)");
  }
  if (!cols.includes("couleur")) {
    db.exec("ALTER TABLE achats ADD COLUMN couleur TEXT"); // NULL par défaut, jamais retroactif ni obligatoire
  }
}

function needsPostesCoutPredefinisTable(db) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='postes_cout_predefinis'").get().n;
  return n === 0;
}

function migrateAjouterPostesCoutPredefinisTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS postes_cout_predefinis (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      categorie TEXT NOT NULL CHECK (categorie IN (
        'matiere', 'fourniture', 'habillage', 'emballage', 'transport', 'confection', 'impression', 'retouche', 'autre'
      )),
      designation TEXT NOT NULL,
      unite_defaut TEXT CHECK (unite_defaut IN ('kg', 'm', 'piece', 'lot')),
      mode_calcul_defaut TEXT NOT NULL CHECK (mode_calcul_defaut IN ('consommation_prix', 'unitaire_direct', 'montant_global')),
      quantite_defaut REAL,
      ordre INTEGER NOT NULL DEFAULT 0,
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function needsEstimationsTables(db) {
  const n = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN ('estimations', 'estimation_lignes')").get().n;
  return n !== 2;
}

function migrateAjouterEstimationsTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS estimations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      article_id INTEGER NOT NULL UNIQUE REFERENCES articles(id) ON DELETE CASCADE,
      quantite_prevue INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS estimation_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      estimation_id INTEGER NOT NULL REFERENCES estimations(id) ON DELETE CASCADE,
      categorie TEXT NOT NULL CHECK (categorie IN (
        'matiere', 'fourniture', 'habillage', 'emballage', 'transport', 'confection', 'impression', 'retouche', 'autre'
      )),
      designation TEXT NOT NULL,
      mode_calcul TEXT NOT NULL CHECK (mode_calcul IN ('consommation_prix', 'unitaire_direct', 'montant_global')),
      quantite REAL,
      unite TEXT CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
      prix_unitaire_ht REAL,
      montant_global_ht REAL,
      taux_tva REAL,
      ordre INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function needsEcheanceFactureId(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='echeances'").get();
  if (tables.n === 0) return false; // pas encore de module Finance, géré par needsModuleFinance
  const cols = db.prepare("PRAGMA table_info(echeances)").all().map((c) => c.name);
  return !cols.includes("achat_facture_id");
}

function migrateAjouterEcheanceFactureId(db) {
  const cols = db.prepare("PRAGMA table_info(echeances)").all().map((c) => c.name);
  if (!cols.includes("achat_facture_id")) {
    db.exec("ALTER TABLE echeances ADD COLUMN achat_facture_id INTEGER REFERENCES achats_factures(id)");
  }
}

function needsFournisseurChampsStructures(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='fournisseurs'").get();
  if (tables.n === 0) return false; // pas encore de module Finance du tout, géré par needsModuleFinance
  const cols = db.prepare("PRAGMA table_info(fournisseurs)").all().map((c) => c.name);
  return !cols.includes("activite");
}

function migrateAjouterFournisseurChampsStructures(db) {
  const cols = db.prepare("PRAGMA table_info(fournisseurs)").all().map((c) => c.name);
  if (!cols.includes("activite")) db.exec("ALTER TABLE fournisseurs ADD COLUMN activite TEXT");
  if (!cols.includes("delai_paiement_jours")) db.exec("ALTER TABLE fournisseurs ADD COLUMN delai_paiement_jours INTEGER");
  if (!cols.includes("delai_fin_de_mois")) db.exec("ALTER TABLE fournisseurs ADD COLUMN delai_fin_de_mois INTEGER NOT NULL DEFAULT 0");
  if (!cols.includes("mode_paiement_defaut")) db.exec("ALTER TABLE fournisseurs ADD COLUMN mode_paiement_defaut TEXT");
  if (!cols.includes("notes")) db.exec("ALTER TABLE fournisseurs ADD COLUMN notes TEXT");
}

function needsModuleFinance(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN " +
    "('fournisseurs','matieres_catalogue','prix_fournisseurs','achats','achats_receptions','achats_factures'," +
    "'achats_affectations','echeances','paiements','paiement_affectations','receptions_production'," +
    "'commande_cout_previsionnel_lignes')").get();
  return tables.n !== 12; // toutes présentes, ou aucune (jamais un état intermédiaire)
}

function migrateAjouterModuleFinance(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fournisseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      contact TEXT, telephone TEXT, email TEXT, adresse TEXT,
      conditions_paiement_defaut TEXT,
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS matieres_catalogue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      nom_normalise TEXT NOT NULL UNIQUE,
      unite_defaut TEXT NOT NULL DEFAULT 'kg' CHECK (unite_defaut IN ('kg', 'm', 'piece', 'lot')),
      ordre INTEGER DEFAULT 0,
      actif INTEGER DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS prix_fournisseurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
      matiere_catalogue_id INTEGER REFERENCES matieres_catalogue(id),
      accessoire_catalogue_id INTEGER REFERENCES accessoires_catalogue(id),
      designation TEXT NOT NULL,
      unite TEXT NOT NULL CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
      prix_ht REAL NOT NULL,
      date_debut_validite TEXT NOT NULL DEFAULT (date('now')),
      date_fin_validite TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (matiere_catalogue_id IS NULL OR accessoire_catalogue_id IS NULL)
    );
    CREATE TABLE IF NOT EXISTS achats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
      commande_id INTEGER REFERENCES commandes(id),
      categorie TEXT NOT NULL CHECK (categorie IN (
        'matiere', 'fourniture', 'confection', 'impression', 'transport', 'retouche', 'emballage', 'autre'
      )),
      designation TEXT NOT NULL,
      quantite REAL,
      unite TEXT CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
      montant_engage REAL NOT NULL,
      date_engagement TEXT NOT NULL DEFAULT (date('now')),
      reference TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS achats_receptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
      date_reception TEXT NOT NULL DEFAULT (date('now')),
      quantite_recue REAL,
      reference_bl TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS achats_factures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
      date_facture TEXT NOT NULL DEFAULT (date('now')),
      montant_ht REAL NOT NULL,
      montant_tva REAL,
      reference_facture TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS achats_affectations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
      commande_id INTEGER NOT NULL REFERENCES commandes(id),
      quantite_affectee REAL NOT NULL,
      date_affectation TEXT NOT NULL DEFAULT (date('now')),
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS echeances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      achat_id INTEGER NOT NULL REFERENCES achats(id) ON DELETE CASCADE,
      date_echeance TEXT NOT NULL,
      montant REAL NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS paiements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),
      date_paiement TEXT NOT NULL DEFAULT (date('now')),
      montant REAL NOT NULL,
      mode TEXT, reference TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS paiement_affectations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paiement_id INTEGER NOT NULL REFERENCES paiements(id) ON DELETE CASCADE,
      achat_facture_id INTEGER NOT NULL REFERENCES achats_factures(id),
      montant_affecte REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS receptions_production (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
      date_reception TEXT NOT NULL DEFAULT (date('now')),
      quantite_recue INTEGER NOT NULL,
      quantite_conforme INTEGER NOT NULL DEFAULT 0,
      quantite_a_retoucher INTEGER NOT NULL DEFAULT 0,
      quantite_retouchee_recuperee INTEGER NOT NULL DEFAULT 0,
      quantite_rebut INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (quantite_conforme + quantite_a_retoucher + quantite_rebut <= quantite_recue)
    );
    CREATE TABLE IF NOT EXISTS commande_cout_previsionnel_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
      categorie TEXT NOT NULL CHECK (categorie IN (
        'matiere', 'fourniture', 'confection', 'impression', 'transport', 'retouche', 'emballage', 'autre'
      )),
      designation TEXT NOT NULL,
      quantite REAL,
      unite TEXT CHECK (unite IN ('kg', 'm', 'piece', 'lot')),
      prix_unitaire_ht REAL,
      montant_ht REAL NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}

function needsEntrepriseTauxTvaDefautColumn(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='entreprise'").get();
  if (tables.n === 0) return false;
  const cols = db.prepare("PRAGMA table_info(entreprise)").all().map((c) => c.name);
  return !cols.includes("taux_tva_defaut");
}

function migrateAjouterEntrepriseTauxTvaDefautColumn(db) {
  const cols = db.prepare("PRAGMA table_info(entreprise)").all().map((c) => c.name);
  if (!cols.includes("taux_tva_defaut")) {
    db.exec("ALTER TABLE entreprise ADD COLUMN taux_tva_defaut REAL"); // NULL par défaut, jamais imposé rétroactivement
  }
}

function needsPaiementTypeColumn(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='paiements'").get();
  if (tables.n === 0) return false;
  const cols = db.prepare("PRAGMA table_info(paiements)").all().map((c) => c.name);
  return !cols.includes("type");
}

function migrateAjouterPaiementTypeColumn(db) {
  const cols = db.prepare("PRAGMA table_info(paiements)").all().map((c) => c.name);
  if (!cols.includes("type")) {
    // Tous les paiements existants deviennent des "règlement" par défaut — jamais réinterprétés
    // en avance rétroactivement, cette information n'existait simplement pas encore.
    db.exec("ALTER TABLE paiements ADD COLUMN type TEXT NOT NULL DEFAULT 'reglement'");
  }
}

function needsArticlePrixVenteEnvisageColumn(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='articles'").get();
  if (tables.n === 0) return false;
  const cols = db.prepare("PRAGMA table_info(articles)").all().map((c) => c.name);
  return !cols.includes("prix_vente_envisage");
}

function migrateAjouterArticlePrixVenteEnvisageColumn(db) {
  const cols = db.prepare("PRAGMA table_info(articles)").all().map((c) => c.name);
  if (!cols.includes("prix_vente_envisage")) {
    db.exec("ALTER TABLE articles ADD COLUMN prix_vente_envisage REAL"); // NULL par défaut, aucune donnée existante modifiée
  }
}

function needsListesValeursFournisseurIdColumn(db) {
  const tables = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='listes_valeurs'").get();
  if (tables.n === 0) return false;
  const cols = db.prepare("PRAGMA table_info(listes_valeurs)").all().map((c) => c.name);
  return !cols.includes("fournisseur_id");
}

function migrateAjouterListesValeursFournisseurIdColumn(db) {
  const cols = db.prepare("PRAGMA table_info(listes_valeurs)").all().map((c) => c.name);
  if (!cols.includes("fournisseur_id")) {
    db.exec("ALTER TABLE listes_valeurs ADD COLUMN fournisseur_id INTEGER REFERENCES fournisseurs(id)");
  }
}

function needsArticleProduitNullable(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'").all();
  if (tables.length === 0) return false; // ne devrait jamais arriver en usage normal
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='articles'").get().sql;
  return sql.includes("produit_id INTEGER NOT NULL");
}

// Reconstruction complète (même technique que migrateResponsableSimplification) : SQLite ne
// permet pas de retirer une contrainte NOT NULL autrement. Nécessaire pour que "Convertir en
// produit" depuis Planification puisse créer un article sans exiger un type de produit —
// l'information reste modifiable normalement ensuite dans la fiche article si besoin.
//
// Rendue idempotente et sûre contre une exécution précédente interrompue (fermeture forcée de
// l'app en plein milieu) : avant toute chose, on vérifie l'état RÉEL du schéma plutôt que de
// supposer qu'on part d'une base propre. Toute la partie normale s'exécute dans une transaction
// explicite, pour ne jamais laisser d'état intermédiaire si elle est interrompue à nouveau.
function migrateArticleProduitNullable(db) {
  const articlesExiste = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles'").all().length > 0;
  const articlesNewExiste = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='articles_new'").all().length > 0;

  if (articlesNewExiste) {
    if (articlesExiste) {
      // "articles" (l'originale) existe TOUJOURS : le DROP TABLE d'une exécution précédente n'a
      // jamais eu lieu. "articles_new" n'est donc qu'une copie de travail, jamais la source de
      // vérité — mais on vérifie son contenu avant de la supprimer, par sécurité : si elle contient
      // plus de lignes que l'originale, quelque chose d'anormal s'est produit et on s'arrête plutôt
      // que de risquer une perte de données silencieuse.
      const countOriginal = db.prepare("SELECT COUNT(*) AS n FROM articles").get().n;
      const countNew = db.prepare("SELECT COUNT(*) AS n FROM articles_new").get().n;
      console.log(
        `[migration] "articles_new" résiduelle détectée (exécution précédente interrompue) : ` +
        `${countNew} ligne(s) contre ${countOriginal} dans "articles" (l'originale, toujours intacte).`
      );
      if (countNew > countOriginal) {
        throw new Error(
          `Migration articles : la table temporaire "articles_new" contient ${countNew} ligne(s), contre ${countOriginal} ` +
          `dans "articles". Situation inattendue pouvant indiquer des données à récupérer — migration arrêtée par sécurité, ` +
          `aucune suppression effectuée. Contactez le support avant de relancer l'application.`
        );
      }
      console.log('[migration] "articles_new" est une copie de travail incomplète ou redondante — suppression sûre, aucune donnée perdue.');
      db.exec("DROP TABLE articles_new");
    } else {
      // "articles" n'existe plus mais "articles_new" si : le DROP a eu lieu mais pas le RENAME
      // final. "articles_new" contient alors les VRAIES données — on termine simplement la
      // migration au lieu de la recommencer depuis zéro.
      console.log('[migration] Reprise : "articles_new" contient déjà les données migrées, finalisation du renommage.');
      db.exec("ALTER TABLE articles_new RENAME TO articles");
      return;
    }
  }

  const tx = () => {
    db.exec(`
      CREATE TABLE articles_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        produit_id INTEGER REFERENCES listes_valeurs(id),
        saison_id INTEGER REFERENCES listes_valeurs(id),
        annee_collection INTEGER,
        rayon_id INTEGER REFERENCES listes_valeurs(id),
        categorie_id INTEGER REFERENCES listes_valeurs(id),
        abreviation TEXT,
        numero_sequentiel INTEGER,
        reference_principale TEXT UNIQUE,
        est_demo INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (abreviation IS NULL OR (abreviation = UPPER(abreviation) AND LENGTH(abreviation) BETWEEN 2 AND 5))
      );
    `);
    db.exec(`
      INSERT INTO articles_new (
        id, uuid, produit_id, saison_id, annee_collection, rayon_id, categorie_id,
        abreviation, numero_sequentiel, reference_principale, est_demo, created_at, updated_at
      )
      SELECT
        id, uuid, produit_id, saison_id, annee_collection, rayon_id, categorie_id,
        abreviation, numero_sequentiel, reference_principale, est_demo, created_at, updated_at
      FROM articles;
    `);
    db.exec("DROP TABLE articles");
    db.exec("ALTER TABLE articles_new RENAME TO articles");
  };
  tx();
}

function needsPlanningDatesSeparees(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planning_articles'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(planning_articles)").all().map((c) => c.name);
  return !cols.includes("mois_prevu_production");
}

function migrateAddPlanningDatesSeparees(db) {
  db.exec("ALTER TABLE planning_articles ADD COLUMN mois_prevu_production TEXT");
  db.exec("ALTER TABLE planning_articles ADD COLUMN mois_prevu_reception TEXT");
  // Backfill : la production hérite de l'ancienne date unique, la réception reste vide (à préciser
  // individuellement — jamais devinée automatiquement).
  db.exec("UPDATE planning_articles SET mois_prevu_production = mois_prevu WHERE mois_prevu_production IS NULL");
}

function needsPlanningProduitRayonColumns(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='planning_articles'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(planning_articles)").all().map((c) => c.name);
  return !cols.includes("produit_id");
}

function migrateAddPlanningProduitRayonColumns(db) {
  db.exec("ALTER TABLE planning_articles ADD COLUMN produit_id INTEGER REFERENCES listes_valeurs(id)");
  db.exec("ALTER TABLE planning_articles ADD COLUMN rayon_id INTEGER REFERENCES listes_valeurs(id)");
}

function needsCommandeLigneReferenceColumn(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commande_lignes'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(commande_lignes)").all().map((c) => c.name);
  return !cols.includes("reference_libre");
}

function migrateAddCommandeLigneReferenceColumn(db) {
  db.exec("ALTER TABLE commande_lignes ADD COLUMN reference_libre TEXT");
}

function needsBcPfLigneReferenceColumn(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bc_pf_lignes'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(bc_pf_lignes)").all().map((c) => c.name);
  return !cols.includes("couleur_reference");
}

function migrateAddBcPfLigneReferenceColumn(db) {
  db.exec("ALTER TABLE bc_pf_lignes ADD COLUMN couleur_reference TEXT");
}

function needsBcPfResponsableColumn(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='bc_pf'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(bc_pf)").all().map((c) => c.name);
  return !cols.includes("responsable_nom");
}

// Ajoute responsable_nom (jamais capturé jusqu'ici) et rattrape, au mieux, les documents déjà
// existants avec le responsable ACTUEL de leur commande — approximatif pour les commandes dont le
// responsable a changé depuis, mais bien plus utile que de laisser un vide permanent sur les
// bons de commande déjà émis.
function migrateAddBcPfResponsableColumn(db) {
  db.exec("ALTER TABLE bc_pf ADD COLUMN responsable_nom TEXT");
  db.exec(`
    UPDATE bc_pf
    SET responsable_nom = (
      SELECT lv.nom FROM commandes c JOIN listes_valeurs lv ON lv.id = c.responsable_id
      WHERE c.id = bc_pf.commande_id
    )
    WHERE responsable_nom IS NULL
  `);
}

function needsEntrepriseFooterColumns(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='entreprise'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(entreprise)").all().map((c) => c.name);
  return !cols.includes("ville") || !cols.includes("swift_bic");
}

function migrateAddEntrepriseFooterColumns(db) {
  const cols = db.prepare("PRAGMA table_info(entreprise)").all().map((c) => c.name);
  const toAdd = [
    ["identifiant_tva", "TEXT"], ["ville", "TEXT"], ["code_postal", "TEXT"], ["pays", "TEXT"],
    ["site_web", "TEXT"], ["swift_bic", "TEXT"],
  ];
  toAdd.forEach(([name, type]) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE entreprise ADD COLUMN ${name} ${type}`);
  });
}

function needsFicheTechniqueCoupeColumn(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fiches_techniques'").all();
  if (tables.length === 0) return false; // schema.sql vient de la créer avec la colonne déjà présente
  const cols = db.prepare("PRAGMA table_info(fiches_techniques)").all().map((c) => c.name);
  return !cols.includes("coupe_id");
}

function migrateAddFicheTechniqueCoupeColumn(db) {
  db.exec("ALTER TABLE fiches_techniques ADD COLUMN coupe_id INTEGER REFERENCES listes_valeurs(id)");
}

// Contrairement aux tables ft_* (données d'essai jetables pendant la mise au point), les modèles
// de mesures représentent un vrai travail d'administration déjà effectué — cette migration
// préserve les données existantes plutôt que de tout reconstruire à vide.
function needsModelesMesuresMultipleColumn(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='modeles_mesures'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(modeles_mesures)").all().map((c) => c.name);
  return !cols.includes("nom");
}

function migrateModelesMesuresMultiple(db) {
  const anciensModeles = db.prepare("SELECT * FROM modeles_mesures").all();
  const anciennesLignes = db.prepare("SELECT * FROM modeles_mesures_lignes").all();
  const produits = db.prepare("SELECT id, nom FROM listes_valeurs WHERE type = 'produit'").all();
  const nomProduit = Object.fromEntries(produits.map((p) => [p.id, p.nom]));

  db.exec(`
    DROP TABLE IF EXISTS modeles_mesures_lignes;
    DROP TABLE IF EXISTS modeles_mesures;
    CREATE TABLE modeles_mesures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
      declinaison_type_id INTEGER NOT NULL REFERENCES declinaison_types(id),
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE modeles_mesures_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modele_id INTEGER NOT NULL REFERENCES modeles_mesures(id) ON DELETE CASCADE,
      mesure_catalogue_id INTEGER NOT NULL REFERENCES mesures_catalogue(id),
      repere TEXT, unite TEXT, tolerance_plus TEXT, tolerance_moins TEXT, commentaire TEXT,
      ordre INTEGER DEFAULT 0,
      UNIQUE(modele_id, mesure_catalogue_id)
    );
  `);

  const insertModele = db.prepare(
    "INSERT INTO modeles_mesures (id, nom, produit_id, declinaison_type_id, actif, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)"
  );
  anciensModeles.forEach((m) => {
    const nom = nomProduit[m.produit_id] || `Modèle #${m.id}`;
    insertModele.run(m.id, nom, m.produit_id, m.declinaison_type_id, m.created_at, m.updated_at);
  });

  const insertLigne = db.prepare(
    "INSERT INTO modeles_mesures_lignes (id, modele_id, mesure_catalogue_id, repere, unite, tolerance_plus, tolerance_moins, commentaire, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  anciennesLignes.forEach((l) => {
    insertLigne.run(l.id, l.modele_id, l.mesure_catalogue_id, l.repere, l.unite, l.tolerance_plus, l.tolerance_moins, l.commentaire, l.ordre);
  });
}

// Les tailles ne dépendent plus des Déclinaisons de l'article (architecture révisée) : un modèle
// de mesures n'a donc plus besoin d'axe de gradation, seulement d'un ensemble de lignes par
// défaut. Préserve les modèles déjà configurés (nom, produit, actif, lignes) — seul l'axe,
// devenu sans objet, disparaît.
function needsModelesMesuresSansAxeMigration(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='modeles_mesures'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(modeles_mesures)").all().map((c) => c.name);
  return cols.includes("declinaison_type_id");
}

function migrateModelesMesuresSansAxe(db) {
  const anciensModeles = db.prepare("SELECT * FROM modeles_mesures").all();
  const anciennesLignes = db.prepare("SELECT * FROM modeles_mesures_lignes").all();

  db.exec(`
    DROP TABLE IF EXISTS modeles_mesures_lignes;
    DROP TABLE IF EXISTS modeles_mesures;
    CREATE TABLE modeles_mesures (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      produit_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE modeles_mesures_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      modele_id INTEGER NOT NULL REFERENCES modeles_mesures(id) ON DELETE CASCADE,
      mesure_catalogue_id INTEGER NOT NULL REFERENCES mesures_catalogue(id),
      repere TEXT, unite TEXT, tolerance_plus TEXT, tolerance_moins TEXT, commentaire TEXT,
      ordre INTEGER DEFAULT 0,
      UNIQUE(modele_id, mesure_catalogue_id)
    );
  `);

  const insertModele = db.prepare(
    "INSERT INTO modeles_mesures (id, nom, produit_id, actif, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
  );
  anciensModeles.forEach((m) => {
    insertModele.run(m.id, m.nom, m.produit_id, m.actif, m.created_at, m.updated_at);
  });

  const insertLigne = db.prepare(
    "INSERT INTO modeles_mesures_lignes (id, modele_id, mesure_catalogue_id, repere, unite, tolerance_plus, tolerance_moins, commentaire, ordre) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  anciennesLignes.forEach((l) => {
    insertLigne.run(l.id, l.modele_id, l.mesure_catalogue_id, l.repere, l.unite, l.tolerance_plus, l.tolerance_moins, l.commentaire, l.ordre);
  });
}

module.exports = {
  needsListesMigration,
  migrateToListesValeurs,
  needsPhotoColumns,
  migrateAddPhotoColumns,
  needsEntrepriseBanqueColumns,
  migrateAddEntrepriseBanqueColumns,
  needsListesOrdreMigration,
  migrateListesOrdre,
  needsLignesMigration,
  migrateToCommandeLignes,
  needsListesCodeMigration,
  migrateListesCode,
  needsArticlesCycleMigration,
  migrateToArticlesCycleDeVie,
  needsBcPfSingleDocMigration,
  migrateToBcPfSingleDoc,
  needsDeclinaisonAffichageCouleurColumn,
  migrateAddDeclinaisonAffichageCouleurColumn,
  needsListesCoupeTypeMigration,
  migrateListesCoupeType,
  needsResponsableSimplification,
  migrateResponsableSimplification,
  needsListesPointureCategorieTypeMigration,
  migrateListesPointureCategorieType,
  needsGrillesTaillesMigration,
  migrateGrillesTailles,
  needsFicheTechniqueRebuild,
  migrateRebuildFicheTechnique,
  needsFicheTechniqueCoupeColumn,
  migrateAddFicheTechniqueCoupeColumn,
  needsModelesMesuresMultipleColumn,
  migrateModelesMesuresMultiple,
  needsModelesMesuresSansAxeMigration,
  migrateModelesMesuresSansAxe,
  needsArticleCategorieColumn,
  migrateAddArticleCategorieColumn,
  needsPlanningArticlesTable,
  migrateAddPlanningArticlesTable,
  needsPosteCoutAjoutAutoColumn,
  migrateAjouterPosteCoutAjoutAutoColumn,
  needsAchatMatiereColonnesStock,
  migrateAjouterAchatMatiereColonnesStock,
  needsPostesCoutPredefinisTable,
  migrateAjouterPostesCoutPredefinisTable,
  needsEstimationsTables,
  migrateAjouterEstimationsTables,
  needsEcheanceFactureId,
  migrateAjouterEcheanceFactureId,
  needsFournisseurChampsStructures,
  migrateAjouterFournisseurChampsStructures,
  needsModuleFinance,
  migrateAjouterModuleFinance,
  needsEntrepriseTauxTvaDefautColumn,
  migrateAjouterEntrepriseTauxTvaDefautColumn,
  needsPaiementTypeColumn,
  migrateAjouterPaiementTypeColumn,
  needsArticlePrixVenteEnvisageColumn,
  migrateAjouterArticlePrixVenteEnvisageColumn,
  needsListesValeursFournisseurIdColumn,
  migrateAjouterListesValeursFournisseurIdColumn,
  needsArticleProduitNullable,
  migrateArticleProduitNullable,
  needsPlanningDatesSeparees,
  migrateAddPlanningDatesSeparees,
  needsPlanningProduitRayonColumns,
  migrateAddPlanningProduitRayonColumns,
  needsCommandeLigneReferenceColumn,
  migrateAddCommandeLigneReferenceColumn,
  needsBcPfLigneReferenceColumn,
  migrateAddBcPfLigneReferenceColumn,
  needsBcPfResponsableColumn,
  migrateAddBcPfResponsableColumn,
  needsEntrepriseFooterColumns,
  migrateAddEntrepriseFooterColumns,
};

// --- Saisons / Rayons / Opérateurs : colonne "code" + nouveaux types sur listes_valeurs ---

function needsListesCodeMigration(db) {
  const cols = db.prepare("PRAGMA table_info(listes_valeurs)").all().map((c) => c.name);
  return !cols.includes("code");
}

// Ajoute la colonne "code" (utilisée par saison/rayon) et les types saison/rayon/operateur à la
// contrainte CHECK. Reconstruction nécessaire (SQLite ne permet pas de modifier un CHECK existant),
// comme pour la migration précédente de "ordre".
function migrateListesCode(db) {
  const run = db.transaction(() => {
    db.exec(`
      CREATE TABLE listes_valeurs_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier','taille','saison','rayon','operateur')),
        nom TEXT NOT NULL,
        nom_normalise TEXT NOT NULL,
        code TEXT,
        ordre INTEGER,
        actif INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(type, nom_normalise)
      );
      INSERT INTO listes_valeurs_new (id, type, nom, nom_normalise, code, ordre, actif, created_at)
      SELECT id, type, nom, nom_normalise, NULL, ordre, actif, created_at FROM listes_valeurs;
      DROP TABLE listes_valeurs;
      ALTER TABLE listes_valeurs_new RENAME TO listes_valeurs;
    `);

    // Pré-remplit saisons et rayons (avec leurs codes), y compris sur une base déjà en usage
    // (le seed normal ne s'exécute que sur une base totalement vide).
    const findListe = db.prepare("SELECT id, actif FROM listes_valeurs WHERE type = ? AND nom_normalise = ?");
    const insertListe = db.prepare(
      "INSERT INTO listes_valeurs (type, nom, nom_normalise, code, ordre, actif) VALUES (?, ?, ?, ?, ?, 1)"
    );
    function upsertWithCode(type, nom, code, ordre) {
      const norm = normalizeNom(nom);
      const found = findListe.get(type, norm);
      if (found) {
        if (!found.actif) db.prepare("UPDATE listes_valeurs SET actif = 1 WHERE id = ?").run(found.id);
        return;
      }
      insertListe.run(type, nom, norm, code, ordre);
    }
    DEFAULTS.SAISONS.forEach((s, i) => upsertWithCode("saison", s.nom, s.code, i + 1));
    DEFAULTS.RAYONS.forEach((r, i) => upsertWithCode("rayon", r.nom, r.code, i + 1));
  });
  run();
}

function needsListesCoupeTypeMigration(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='listes_valeurs'").get().sql;
  return !sql.includes("'coupe'");
}

// Ajoute 'coupe' à la contrainte CHECK de listes_valeurs (reconstruction nécessaire, SQLite ne
// permet pas de modifier un CHECK existant — même technique que la migration précédente).
function migrateListesCoupeType(db) {
  db.exec(`
    CREATE TABLE listes_valeurs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier','taille','saison','rayon','operateur','coupe')),
      nom TEXT NOT NULL,
      nom_normalise TEXT NOT NULL,
      code TEXT,
      ordre INTEGER,
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, nom_normalise)
    );
    INSERT INTO listes_valeurs_new SELECT * FROM listes_valeurs;
    DROP TABLE listes_valeurs;
    ALTER TABLE listes_valeurs_new RENAME TO listes_valeurs;
  `);
}

// --- Articles + cycle de vie des commandes (brouillon → validée → en_production → ... ) ---

// Migration vers l'architecture "Grilles de tailles" — remplace l'ancien catalogue plat
// listes_valeurs(type='taille'/'pointure') utilisé directement par commande_lignes.taille_id.
// Procédure volontairement prudente : le libellé historique de chaque ligne de commande est figé
// AVANT tout remappage d'identifiant, pour qu'aucune commande existante ne puisse jamais perdre
// son affichage, quel que soit le sort ultérieur des valeurs de taille (renommées, désactivées,
// retirées d'une grille). L'ancien système (listes_valeurs) n'est ni supprimé ni modifié — la
// migration se contente de construire le nouveau système à côté et de faire pointer les données
// existantes vers lui.
const MARQUEUR_GRILLES_CLE = "migration_grilles_tailles_version";
const MARQUEUR_GRILLES_VALEUR = "2";

// Marqueur explicite, et NON inspection des données. Deux raisons.
//
// 1. La garde d'origine testait la présence de la colonne taille_nom. Créée par
//    schema.sql, celle-ci désarmait la migration avant qu'elle n'ait travaillé :
//    les libellés n'ont jamais été figés et les taille_id jamais remappés.
// 2. Un test du type « taille_id absent de grilles_tailles_valeurs » serait faux
//    sur une base où un ancien id listes_valeurs collisionne numériquement avec
//    un id de grille : la ligne paraîtrait conforme tout en désignant la mauvaise
//    taille. Aucune inspection des données ne distingue ce cas ; seul un marqueur
//    le peut. commande_lignes.taille_nom ne peut pas non plus servir de signal :
//    insertLignes() ne l'écrivait pas, il est donc NULL même sur les lignes récentes.
function needsGrillesTaillesMigration(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commande_lignes'").all();
  if (tables.length === 0) return false; // schema.sql vient de tout créer avec la forme actuelle
  const params = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='parametres'").all();
  if (params.length === 0) return true; // base très ancienne : laisser la migration s'exécuter
  const m = db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(MARQUEUR_GRILLES_CLE);
  return !m || m.valeur !== MARQUEUR_GRILLES_VALEUR;
}

function migrateGrillesTailles(db) {
  // 1) Colonne de secours, seulement si absente : la garde ne la teste plus, cette
  // fonction peut donc s'exécuter sur une base où schema.sql l'a déjà créée.
  const colsInit = db.prepare("PRAGMA table_info(commande_lignes)").all().map((c) => c.name);
  if (!colsInit.includes("taille_nom")) db.exec("ALTER TABLE commande_lignes ADD COLUMN taille_nom TEXT");

  // 1bis) GARDE D'AMBIGUÏTÉ, avant toute écriture. Un identifiant référencé par
  // commande_lignes et présent des DEUX côtés est indécidable : impossible de
  // savoir à quel référentiel il appartient. Mieux vaut échouer — runRebuildMigration
  // restaure alors la sauvegarde — que remapper au hasard.
  const gtvExiste = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='grilles_tailles_valeurs'").all();
  if (gtvExiste.length > 0) {
    const ambigus = db.prepare(`
      SELECT COUNT(*) AS n FROM listes_valeurs lv
      JOIN grilles_tailles_valeurs gtv ON gtv.id = lv.id
      WHERE lv.type IN ('taille','pointure')
        AND EXISTS (SELECT 1 FROM commande_lignes cl WHERE cl.taille_id = lv.id)
    `).get().n;
    if (ambigus > 0) {
      throw new Error(
        "Migration Grilles de tailles : " + ambigus + " identifiant(s) ambigu(s), présents à la fois " +
        "dans listes_valeurs (type taille/pointure) et dans grilles_tailles_valeurs, et référencés par " +
        "des lignes de commande. Remappage automatique impossible — arbitrage manuel requis."
      );
    }
  }

  // 2) Fige IMMÉDIATEMENT le libellé historique de chaque ligne, avant tout remappage. C'est la
  // garantie centrale de cette migration : même si l'étape 6 échouait à mi-chemin, aucune
  // commande n'aurait perdu son texte affiché.
  //
  // ORDRE DE RÉSOLUTION CRITIQUE : la grille d'abord, puis listes_valeurs RESTREINT aux types
  // taille/pointure. Sans cette restriction, une ligne déjà conforme pointant vers la valeur de
  // grille n° 3 résoudrait vers listes_valeurs n° 3 — qui peut être une couleur — et figerait un
  // libellé faux, définitivement.
  db.exec(`
    UPDATE commande_lignes
    SET taille_nom = COALESCE(
          (SELECT gtv.valeur FROM grilles_tailles_valeurs gtv WHERE gtv.id = commande_lignes.taille_id),
          (SELECT lv.nom FROM listes_valeurs lv
             WHERE lv.id = commande_lignes.taille_id AND lv.type IN ('taille','pointure')))
    WHERE taille_id IS NOT NULL AND taille_nom IS NULL
  `);

  // 3) Crée les nouvelles tables si elles n'existent pas déjà (base ancienne, schema.sql pas
  // encore rechargé avec la forme actuelle).
  db.exec(`
    CREATE TABLE IF NOT EXISTS grilles_tailles (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nom TEXT NOT NULL, nom_normalise TEXT NOT NULL UNIQUE,
      actif INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS grilles_tailles_valeurs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, grille_id INTEGER NOT NULL REFERENCES grilles_tailles(id) ON DELETE CASCADE,
      valeur TEXT NOT NULL, valeur_normalisee TEXT NOT NULL, ordre INTEGER NOT NULL DEFAULT 0,
      actif INTEGER NOT NULL DEFAULT 1, UNIQUE(grille_id, valeur_normalisee)
    );
    CREATE TABLE IF NOT EXISTS produit_grille_taille (
      produit_id INTEGER PRIMARY KEY REFERENCES listes_valeurs(id) ON DELETE CASCADE,
      grille_id INTEGER NOT NULL REFERENCES grilles_tailles(id)
    );
  `);

  // 4) Inventaire complet de l'ancien catalogue — pas seulement ce qui est utilisé dans des
  // commandes, TOUTES les valeurs existantes, pour ne rien laisser de côté.
  const anciennesTailles = db.prepare(
    "SELECT id, nom FROM listes_valeurs WHERE type IN ('taille','pointure') ORDER BY (ordre IS NULL), ordre, nom"
  ).all();

  if (anciennesTailles.length > 0) {
    // 5) Seule heuristique : séparer alphabétique / numérique, uniquement pour ranger dans une
    // grille de départ migratoire. Un humain doit ensuite vérifier, renommer, scinder — exactement
    // comme demandé, jamais une affectation automatique définitive de type Pantalons/Chaussures.
    const estNumerique = (nom) => /^\d+([.,]\d+)?$/.test(String(nom).trim());
    const alpha = anciennesTailles.filter((t) => !estNumerique(t.nom));
    const numerique = anciennesTailles.filter((t) => estNumerique(t.nom));

    function creerGrilleEtValeurs(nomGrille, valeurs) {
      if (valeurs.length === 0) return {};
      const norm = (s) => normalizeNom(s);
      const infoGrille = db.prepare("INSERT INTO grilles_tailles (nom, nom_normalise) VALUES (?, ?)").run(nomGrille, norm(nomGrille));
      const grilleId = infoGrille.lastInsertRowid;
      const insertValeur = db.prepare(
        "INSERT INTO grilles_tailles_valeurs (grille_id, valeur, valeur_normalisee, ordre) VALUES (?, ?, ?, ?)"
      );
      const mapping = {};
      valeurs.forEach((t, i) => {
        const info = insertValeur.run(grilleId, t.nom, norm(t.nom), i);
        mapping[t.id] = info.lastInsertRowid;
      });
      return mapping;
    }

    const mappingAlpha = creerGrilleEtValeurs("Vêtements", alpha);
    const mappingNum = creerGrilleEtValeurs("Tailles numériques (à vérifier)", numerique);
    const mapping = Object.assign({}, mappingAlpha, mappingNum);

    // 6) Remappe les lignes de commande vers les nouveaux identifiants. Le libellé (étape 2) est
    // déjà en sécurité, indépendamment de ce qui suit.
    const updateLigne = db.prepare("UPDATE commande_lignes SET taille_id = ? WHERE id = ?");
    const lignes = db.prepare("SELECT id, taille_id FROM commande_lignes WHERE taille_id IS NOT NULL").all();
    lignes.forEach((l) => {
      const nouvelId = mapping[l.taille_id];
      if (nouvelId) updateLigne.run(nouvelId, l.id);
      // Si aucune correspondance (cas anormal), taille_id garde son ancienne valeur, mais
      // taille_nom (déjà figé) affiche toujours le bon texte — rien n'est perdu à l'écran.
    });
  }

  // 7) ft_tailles : l'ancienne colonne pointait vers tailles_catalogue (système désormais
  // remplacé). On la renomme pour coller au nouveau modèle et on vide les références, qui ne
  // correspondent plus à rien de valide — "nom" reste la copie figée, donc l'affichage des
  // fiches déjà existantes n'est jamais impacté.
  const ftTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='ft_tailles'").all();
  if (ftTables.length > 0) {
    const ftCols = db.prepare("PRAGMA table_info(ft_tailles)").all().map((c) => c.name);
    if (ftCols.includes("taille_catalogue_id") && !ftCols.includes("grille_valeur_id")) {
      db.exec("ALTER TABLE ft_tailles RENAME COLUMN taille_catalogue_id TO grille_valeur_id");
      db.exec("UPDATE ft_tailles SET grille_valeur_id = NULL");
    }
  }

  // 8) Marqueur d'achèvement, en TOUT DERNIER : il n'est posé que si l'intégralité
  // de ce qui précède a réussi. Toute exception laisse le marqueur absent, donc
  // needsGrillesTaillesMigration() redemandera la migration au prochain démarrage.
  // C'est ce qui rend la migration idempotente sans jamais inspecter les données.
  db.prepare(
    "INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur"
  ).run(MARQUEUR_GRILLES_CLE, MARQUEUR_GRILLES_VALEUR);
}

function needsResponsableSimplification(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='commandes'").all();
  if (tables.length === 0) return false;
  const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  return !cols.includes("responsable_nom");
}

// Simplifie le responsable : de "liste dédiée + clé étrangère" à un simple texte libre par
// commande (suggéré depuis le champ Responsable de l'atelier, lui aussi devenu texte libre).
// Reconstruction de "commandes" nécessaire : responsable_id était NOT NULL avec contrainte de clé
// étrangère, SQLite ne permet pas de la retirer par un simple ALTER TABLE. Le libellé de chaque
// commande existante est figé AVANT toute reconstruction, à partir de l'ancien système — aucune
// commande historique ne perd son responsable affiché.
function migrateResponsableSimplification(db) {
  // 1) listes_valeurs : nouveau champ texte libre (utilisé uniquement par les ateliers).
  const lvCols = db.prepare("PRAGMA table_info(listes_valeurs)").all().map((c) => c.name);
  if (!lvCols.includes("responsable_nom")) {
    db.exec("ALTER TABLE listes_valeurs ADD COLUMN responsable_nom TEXT");
  }
  // Rattrape ce qui avait été lié via atelier_responsable (construit juste avant cette
  // simplification) avant de supprimer cette table.
  const atTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='atelier_responsable'").all();
  if (atTables.length > 0) {
    db.exec(`
      UPDATE listes_valeurs
      SET responsable_nom = (
        SELECT lv.nom FROM atelier_responsable ar JOIN listes_valeurs lv ON lv.id = ar.responsable_id
        WHERE ar.atelier_id = listes_valeurs.id
      )
      WHERE type = 'atelier' AND responsable_nom IS NULL
    `);
  }

  // 2) commandes : reconstruction complète, responsable_id (FK NOT NULL) -> responsable_nom (texte NOT NULL).
  db.exec(`
    CREATE TABLE commandes_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      numero TEXT UNIQUE,
      article_id INTEGER NOT NULL REFERENCES articles(id),
      type_production TEXT NOT NULL DEFAULT 'nouveau' CHECK (type_production IN ('nouveau','reassort')),
      numero_reassort INTEGER,
      reference_production TEXT,
      responsable_nom TEXT NOT NULL,
      atelier_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
      quantite_totale INTEGER NOT NULL DEFAULT 0,
      date_lancement TEXT NOT NULL,
      date_fin_prevue TEXT NOT NULL,
      etape_id INTEGER NOT NULL REFERENCES etapes(id),
      statut TEXT NOT NULL DEFAULT 'brouillon'
        CHECK (statut IN ('brouillon','validee','en_production','controle_qualite','terminee','annulee')),
      priorite TEXT NOT NULL DEFAULT 'normale'
        CHECK (priorite IN ('haute','normale','faible')),
      bloquee INTEGER NOT NULL DEFAULT 0,
      blocage_motif TEXT,
      bloquee_le TEXT, bloquee_par_id INTEGER REFERENCES listes_valeurs(id),
      debloquee_le TEXT, debloquee_par_id INTEGER REFERENCES listes_valeurs(id),
      valide_le TEXT, valide_par_id INTEGER REFERENCES listes_valeurs(id),
      lance_le TEXT, lance_par_id INTEGER REFERENCES listes_valeurs(id),
      controle_qualite_le TEXT, controle_qualite_par_id INTEGER REFERENCES listes_valeurs(id),
      terminee_le TEXT, terminee_par_id INTEGER REFERENCES listes_valeurs(id),
      annulee_le TEXT, annulee_par_id INTEGER REFERENCES listes_valeurs(id), annulation_motif TEXT,
      archived_le TEXT, archived_par_id INTEGER REFERENCES listes_valeurs(id),
      desarchive_le TEXT, desarchive_par_id INTEGER REFERENCES listes_valeurs(id),
      commentaires TEXT,
      archived INTEGER NOT NULL DEFAULT 0,
      est_demo INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      CHECK (date_fin_prevue >= date_lancement),
      CHECK (bloquee = 0 OR (blocage_motif IS NOT NULL AND TRIM(blocage_motif) <> ''))
    );
    INSERT INTO commandes_new (
      id, uuid, numero, article_id, type_production, numero_reassort, reference_production,
      responsable_nom, atelier_id, quantite_totale, date_lancement, date_fin_prevue, etape_id,
      statut, priorite, bloquee, blocage_motif, bloquee_le, bloquee_par_id, debloquee_le, debloquee_par_id,
      valide_le, valide_par_id, lance_le, lance_par_id, controle_qualite_le, controle_qualite_par_id,
      terminee_le, terminee_par_id, annulee_le, annulee_par_id, annulation_motif,
      archived_le, archived_par_id, desarchive_le, desarchive_par_id, commentaires,
      archived, est_demo, deleted_at, created_at, updated_at
    )
    SELECT
      c.id, c.uuid, c.numero, c.article_id, c.type_production, c.numero_reassort, c.reference_production,
      COALESCE((SELECT nom FROM listes_valeurs WHERE id = c.responsable_id), 'Non renseigné'),
      c.atelier_id, c.quantite_totale, c.date_lancement, c.date_fin_prevue, c.etape_id,
      c.statut, c.priorite, c.bloquee, c.blocage_motif, c.bloquee_le, c.bloquee_par_id, c.debloquee_le, c.debloquee_par_id,
      c.valide_le, c.valide_par_id, c.lance_le, c.lance_par_id, c.controle_qualite_le, c.controle_qualite_par_id,
      c.terminee_le, c.terminee_par_id, c.annulee_le, c.annulee_par_id, c.annulation_motif,
      c.archived_le, c.archived_par_id, c.desarchive_le, c.desarchive_par_id, c.commentaires,
      c.archived, c.est_demo, c.deleted_at, c.created_at, c.updated_at
    FROM commandes c;
    DROP TABLE commandes;
    ALTER TABLE commandes_new RENAME TO commandes;
  `);

  // 3) La table de liaison créée juste avant cette simplification n'est plus nécessaire.
  db.exec("DROP TABLE IF EXISTS atelier_responsable");
}

function needsListesPointureCategorieTypeMigration(db) {
  const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='listes_valeurs'").get().sql;
  return !sql.includes("'pointure'") || !sql.includes("'categorie'");
}

// Ajoute 'pointure' et 'categorie' à la contrainte CHECK de listes_valeurs — même technique que
// la migration précédente (SQLite ne permet pas de modifier un CHECK existant).
function migrateListesPointureCategorieType(db) {
  db.exec(`
    CREATE TABLE listes_valeurs_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK (type IN ('produit','couleur','responsable','atelier','taille','saison','rayon','operateur','coupe','pointure','categorie')),
      nom TEXT NOT NULL,
      nom_normalise TEXT NOT NULL,
      code TEXT,
      ordre INTEGER,
      responsable_nom TEXT,
      actif INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(type, nom_normalise)
    );
    INSERT INTO listes_valeurs_new (id, type, nom, nom_normalise, code, ordre, responsable_nom, actif, created_at)
    SELECT id, type, nom, nom_normalise, code, ordre, responsable_nom, actif, created_at FROM listes_valeurs;
    DROP TABLE listes_valeurs;
    ALTER TABLE listes_valeurs_new RENAME TO listes_valeurs;
  `);
}

function needsArticlesCycleMigration(db) {
  const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  return cols.includes("produit_id") || !cols.includes("article_id");
}

function mapAncienStatut(ancien) {
  switch (ancien) {
    case "en_attente": return "validee";
    case "en_cours": return "en_production";
    case "bloquee": return "en_production";
    case "terminee": return "terminee";
    case "annulee": return "annulee";
    default: return "validee";
  }
}

// Une commande n'a plus de "produit" directement : elle référence un article (modèle stable,
// réutilisable pour les réassorts). Chaque produit déjà utilisé devient un article, SANS
// référence principale fabriquée (elle reste NULL, à générer manuellement plus tard — voir
// electron/ipc/articles.js). Les photos des commandes migrent vers l'article correspondant.
// Le statut se transforme aussi : ancien "en_attente/en_cours/bloquée/terminée/annulée" devient
// le nouveau cycle de vie (brouillon/validée/en_production/controle_qualite/terminee/annulee),
// "bloquée" devenant l'indicateur séparé "bloquee" plutôt qu'un statut à part.
function migrateToArticlesCycleDeVie(db) {
  const run = db.transaction(() => {
    const cols = db.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
    const hasProduitId = cols.includes("produit_id");
    if (!hasProduitId) return; // rien à migrer depuis cet état (ne devrait pas arriver en pratique

    const hasPhoto = cols.includes("photo_path");
    const fullOldRows = db.prepare("SELECT * FROM commandes ORDER BY created_at ASC").all();

    // 1. Un article par produit_id distinct, sans référence fabriquée.
    const articleIdByProduit = new Map();
    const insertArticle = db.prepare("INSERT INTO articles (uuid, produit_id) VALUES (?, ?)");
    const insertPhoto = db.prepare(`
      INSERT INTO article_photos (article_id, photo_path, photo_thumb_path, est_principale, ordre)
      VALUES (?, ?, ?, 0, ?)
    `);
    const photosVuesParArticle = new Map(); // article_id -> Set(photo_path), pour ne pas dupliquer

    for (const r of fullOldRows) {
      if (!r.produit_id) continue;
      let articleId = articleIdByProduit.get(r.produit_id);
      if (!articleId) {
        const info = insertArticle.run(crypto.randomUUID(), r.produit_id);
        articleId = info.lastInsertRowid;
        articleIdByProduit.set(r.produit_id, articleId);
        photosVuesParArticle.set(articleId, new Set());
      }
      if (hasPhoto && r.photo_path) {
        const vues = photosVuesParArticle.get(articleId);
        if (!vues.has(r.photo_path)) {
          vues.add(r.photo_path);
          insertPhoto.run(articleId, r.photo_path, r.photo_thumb_path || r.photo_path, vues.size);
        }
      }
    }
    // La photo la plus récemment ajoutée pour chaque article devient la photo principale.
    for (const articleId of articleIdByProduit.values()) {
      const derniere = db.prepare("SELECT id FROM article_photos WHERE article_id = ? ORDER BY ordre DESC LIMIT 1").get(articleId);
      if (derniere) db.prepare("UPDATE article_photos SET est_principale = 1 WHERE id = ?").run(derniere.id);
    }

    // 2. Reconstruction de "commandes" avec le nouveau cycle de vie.
    db.exec(`
      CREATE TABLE commandes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        uuid TEXT NOT NULL UNIQUE,
        numero TEXT UNIQUE,
        article_id INTEGER NOT NULL REFERENCES articles(id),
        type_production TEXT NOT NULL DEFAULT 'nouveau' CHECK (type_production IN ('nouveau','reassort')),
        numero_reassort INTEGER,
        reference_production TEXT,
        responsable_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        atelier_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        quantite_totale INTEGER NOT NULL DEFAULT 0,
        date_lancement TEXT NOT NULL,
        date_fin_prevue TEXT NOT NULL,
        etape_id INTEGER NOT NULL REFERENCES etapes(id),
        statut TEXT NOT NULL DEFAULT 'brouillon'
          CHECK (statut IN ('brouillon','validee','en_production','controle_qualite','terminee','annulee')),
        priorite TEXT NOT NULL DEFAULT 'normale'
          CHECK (priorite IN ('haute','normale','faible')),
        bloquee INTEGER NOT NULL DEFAULT 0,
        blocage_motif TEXT,
        bloquee_le TEXT, bloquee_par_id INTEGER REFERENCES listes_valeurs(id),
        debloquee_le TEXT, debloquee_par_id INTEGER REFERENCES listes_valeurs(id),
        valide_le TEXT, valide_par_id INTEGER REFERENCES listes_valeurs(id),
        lance_le TEXT, lance_par_id INTEGER REFERENCES listes_valeurs(id),
        controle_qualite_le TEXT, controle_qualite_par_id INTEGER REFERENCES listes_valeurs(id),
        terminee_le TEXT, terminee_par_id INTEGER REFERENCES listes_valeurs(id),
        annulee_le TEXT, annulee_par_id INTEGER REFERENCES listes_valeurs(id), annulation_motif TEXT,
        archived_le TEXT, archived_par_id INTEGER REFERENCES listes_valeurs(id),
        desarchive_le TEXT, desarchive_par_id INTEGER REFERENCES listes_valeurs(id),
        commentaires TEXT,
        archived INTEGER NOT NULL DEFAULT 0,
        est_demo INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        CHECK (date_fin_prevue >= date_lancement),
        CHECK (bloquee = 0 OR (blocage_motif IS NOT NULL AND TRIM(blocage_motif) <> ''))
      );
    `);

    const insertNew = db.prepare(`
      INSERT INTO commandes_new
        (id, uuid, numero, article_id, type_production, numero_reassort, reference_production,
         responsable_id, atelier_id, quantite_totale, date_lancement, date_fin_prevue, etape_id,
         statut, priorite, bloquee, blocage_motif, commentaires,
         archived, est_demo, deleted_at, created_at, updated_at)
      VALUES
        (@id, @uuid, @numero, @article_id, 'nouveau', NULL, NULL,
         @responsable_id, @atelier_id, @quantite_totale, @date_lancement, @date_fin_prevue, @etape_id,
         @statut, @priorite, @bloquee, @blocage_motif, @commentaires,
         @archived, @est_demo, @deleted_at, @created_at, @updated_at)
    `);

    for (const r of fullOldRows) {
      insertNew.run({
        id: r.id,
        uuid: r.uuid,
        numero: r.numero,
        article_id: articleIdByProduit.get(r.produit_id),
        responsable_id: r.responsable_id,
        atelier_id: r.atelier_id,
        quantite_totale: r.quantite_totale,
        date_lancement: r.date_lancement,
        date_fin_prevue: r.date_fin_prevue,
        etape_id: r.etape_id,
        statut: mapAncienStatut(r.statut),
        priorite: r.priorite,
        bloquee: r.statut === "bloquee" ? 1 : 0,
        blocage_motif: r.blocage_motif,
        commentaires: r.commentaires,
        archived: r.archived,
        est_demo: r.est_demo,
        deleted_at: r.deleted_at,
        created_at: r.created_at,
        updated_at: r.updated_at,
      });
    }

    db.exec("DROP TABLE commandes; ALTER TABLE commandes_new RENAME TO commandes;");
  });
  run();
}
