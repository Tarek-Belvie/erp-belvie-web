// Migrations des bons de commande matières premières (BC MP) — étape MP1.
//
// TOUT EST ADDITIF : des CREATE TABLE IF NOT EXISTS et un seul ALTER TABLE ADD COLUMN. Aucune
// table reconstruite, aucune contrainte existante modifiée, aucune donnée réécrite ou supprimée.
// Relancée sur une base déjà migrée, cette fonction ne fait rien.
//
// Ce que chaque objet apporte :
//
//   achats.accessoire_catalogue_id
//       LA colonne qui débloque tout. `achats` porte déjà `matiere_catalogue_id`, mais rien pour
//       les fournitures : un achat de 500 zips ne pouvait donc se rattacher à aucun besoin, et le
//       « déjà commandé » d'une fourniture restait obstinément à zéro. Conséquence vérifiée avant
//       cette migration : on recommandait des fournitures déjà achetées. Toutes les lignes
//       existantes restent à NULL, exactement comme aujourd'hui.
//
//   compteurs_bc_mp / bc_mp / bc_mp_lignes / bc_mp_ligne_productions
//       Le document lui-même. Le schéma rappelle que « un achat = un ENGAGEMENT (BC MP, ...) » :
//       la mécanique financière attendait ce document sans jamais le créer. On ne construit donc
//       pas une seconde mécanique d'achat, on construit le document qui alimente la première.
//
// À MP1, ces tables ne servent encore à rien : aucun écran ne les remplit, aucune ligne n'est
// écrite dans `achats`. La seule chose qui change pour vous dès maintenant, c'est que le « déjà
// commandé » des fournitures devient juste.

function colonnes(db, table) {
  return db.prepare("PRAGMA table_info(" + table + ")").all().map((c) => c.name);
}

function tableExiste(db, nom) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom);
}

// ------------------------------------------------------------------------------------------------
// 1. Rattacher un achat de fourniture à son catalogue
// ------------------------------------------------------------------------------------------------
function needsAccessoireSurAchats(db) {
  return colonnes(db, "achats").indexOf("accessoire_catalogue_id") === -1;
}

function migrateAccessoireSurAchats(db) {
  db.exec(
    "ALTER TABLE achats ADD COLUMN accessoire_catalogue_id INTEGER REFERENCES accessoires_catalogue(id)"
  );
}

// ------------------------------------------------------------------------------------------------
// 2. Les tables du document
// ------------------------------------------------------------------------------------------------
function needsTablesBcMp(db) {
  return !tableExiste(db, "bc_mp");
}

function migrateTablesBcMp(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS compteurs_bc_mp (
      annee INTEGER PRIMARY KEY,
      dernier_numero INTEGER NOT NULL DEFAULT 0
    );

    -- Un bon = UN fournisseur. Les champs "fournisseur_*" et "entreprise_*" sont des COPIES
    -- figées à la validation, sur le modèle de bc_pf : un document parti chez un fournisseur ne
    -- doit pas changer rétroactivement parce qu'une fiche a été corrigée des mois plus tard.
    CREATE TABLE IF NOT EXISTS bc_mp (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      uuid TEXT NOT NULL UNIQUE,
      numero TEXT NOT NULL UNIQUE,                 -- MP001-26 — attribué à la CRÉATION, jamais réutilisé
      fournisseur_id INTEGER NOT NULL REFERENCES fournisseurs(id),

      statut TEXT NOT NULL DEFAULT 'brouillon',    -- brouillon | valide | envoye | solde | annule
      motif_annulation TEXT,

      date_commande TEXT NOT NULL DEFAULT (date('now')),
      date_livraison_souhaitee TEXT,
      conditions_paiement TEXT,
      notes TEXT,                                   -- visible sur le PDF, pour le fournisseur
      observations_internes TEXT,                   -- jamais imprimé

      fournisseur_nom TEXT, fournisseur_adresse TEXT,
      fournisseur_telephone TEXT, fournisseur_email TEXT,
      entreprise_nom_commercial TEXT, entreprise_raison_sociale TEXT,
      entreprise_matricule_fiscal TEXT, entreprise_registre_commerce TEXT,
      entreprise_adresse TEXT, entreprise_telephone TEXT, entreprise_email TEXT,
      entreprise_banque TEXT, entreprise_agence_bancaire TEXT, entreprise_rib TEXT,
      entreprise_logo_snapshot_path TEXT,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      validated_at TEXT,
      envoye_at TEXT,
      cree_par_id INTEGER REFERENCES listes_valeurs(id),
      valide_par_id INTEGER REFERENCES listes_valeurs(id)
    );

    -- Une ligne = un composant chez ce fournisseur.
    --
    -- Le CONDITIONNEMENT est un vrai multiplicateur, et non une mention décorative :
    --     quantite = nombre_conditionnements × conditionnement_quantite
    -- « 3 cartons de 500 » donne donc 1 500 pièces, calculées et non ressaisies. Quand le
    -- composant s'achète à l'unité, conditionnement_quantite vaut 1 et la quantité se saisit
    -- directement. La colonne quantite reste stockée : c'est elle qui part dans l'achat, et la
    -- recalculer à chaque lecture exposerait à une divergence silencieuse si la règle changeait.
    CREATE TABLE IF NOT EXISTS bc_mp_lignes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bc_mp_id INTEGER NOT NULL REFERENCES bc_mp(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('matiere', 'fourniture')),
      matiere_catalogue_id INTEGER REFERENCES matieres_catalogue(id),
      accessoire_catalogue_id INTEGER REFERENCES accessoires_catalogue(id),

      designation TEXT NOT NULL,
      reference TEXT,
      couleur TEXT,
      unite TEXT CHECK (unite IS NULL OR unite IN ('kg', 'm', 'piece', 'lot')),
      unite_fiche TEXT,                             -- l'unité telle que la fiche l'écrit ("bobine")

      conditionnement_libelle TEXT,                 -- "Carton de 500", "Rouleau de 100 m"
      conditionnement_quantite REAL NOT NULL DEFAULT 1
        CHECK (conditionnement_quantite > 0),
      nombre_conditionnements REAL
        CHECK (nombre_conditionnements IS NULL OR nombre_conditionnements > 0),

      quantite REAL NOT NULL CHECK (quantite > 0),
      prix_unitaire_ht REAL CHECK (prix_unitaire_ht IS NULL OR prix_unitaire_ht >= 0),

      -- Rempli à la validation : le lien vers l'engagement créé. Sert dans les deux sens —
      -- depuis un achat, retrouver le bon ; depuis un bon, savoir ce qu'il a produit.
      achat_id INTEGER REFERENCES achats(id),
      ordre INTEGER NOT NULL DEFAULT 0,
      CHECK (matiere_catalogue_id IS NULL OR accessoire_catalogue_id IS NULL)
    );

    -- Le regroupement multi-productions. achats_affectations joue ce rôle APRÈS la validation,
    -- mais il n'existe pas tant que l'achat n'est pas créé : cette table porte la répartition
    -- pendant la préparation. Après validation, les deux disent la même chose, et c'est
    -- achats_affectations qui fait foi pour tous les calculs financiers.
    CREATE TABLE IF NOT EXISTS bc_mp_ligne_productions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bc_mp_ligne_id INTEGER NOT NULL REFERENCES bc_mp_lignes(id) ON DELETE CASCADE,
      commande_id INTEGER NOT NULL REFERENCES commandes(id),
      quantite_affectee REAL NOT NULL CHECK (quantite_affectee > 0),
      achat_affectation_id INTEGER REFERENCES achats_affectations(id),
      UNIQUE (bc_mp_ligne_id, commande_id)
    );

    CREATE INDEX IF NOT EXISTS idx_bc_mp_lignes_bon ON bc_mp_lignes(bc_mp_id);
    CREATE INDEX IF NOT EXISTS idx_bc_mp_ligne_prod_commande ON bc_mp_ligne_productions(commande_id);
    CREATE INDEX IF NOT EXISTS idx_bc_mp_statut ON bc_mp(statut);
  `);
}

/**
 * Point d'entrée unique, appelé une fois au démarrage, après les autres migrations et avant les
 * contrôles de schéma. Idempotent.
 */
function migrerBonsMp(db) {
  if (needsAccessoireSurAchats(db)) {
    console.log("[migration] -> Debut : BC MP / rattachement des achats de fournitures au catalogue");
    migrateAccessoireSurAchats(db);
    console.log("[migration] OK Termine avec succes : accessoire_catalogue_id ajoutee a achats");
  }
  if (needsTablesBcMp(db)) {
    console.log("[migration] -> Debut : BC MP / tables des bons de commande matieres");
    migrateTablesBcMp(db);
    console.log("[migration] OK Termine avec succes : tables bc_mp creees (vides)");
  }
}

module.exports = {
  migrerBonsMp,
  needsAccessoireSurAchats,
  migrateAccessoireSurAchats,
  needsTablesBcMp,
  migrateTablesBcMp,
};
