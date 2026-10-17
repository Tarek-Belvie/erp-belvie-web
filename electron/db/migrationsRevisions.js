// Migrations « révisions de fiche technique et recettes figées » — étape 2a.
//
// Fichier séparé, comme migrationsApprovisionnement.js, pour la même raison : un lot = un endroit.
//
// TOUT EST ADDITIF. Des ALTER TABLE ADD COLUMN et des CREATE TABLE IF NOT EXISTS, rien d'autre.
// Aucune table reconstruite, aucune contrainte existante modifiée, aucune donnée réécrite, aucune
// ligne supprimée. Une base déjà migrée les ignore en silence.
//
// IMPORTANT — ce que cette migration NE fait PAS : elle ne fige la recette d'aucune commande.
// Les tables sont créées vides. Tant qu'aucune recette n'est figée, le moteur de calcul lit la
// fiche technique exactement comme avant, et tous les chiffres restent identiques au caractère
// près. La règle « rien ne change en silence » s'applique d'abord à la migration elle-même.
//
// Ce que chaque objet apporte :
//
//   fiches_techniques.revision / revision_motif
//       Le numéro de révision en cours et le motif de la dernière demande de modification.
//       Toutes les fiches existantes démarrent à la révision 1, ce qui décrit exactement leur
//       état : elles n'ont jamais été révisées.
//
//   fiches_techniques_revisions
//       L'historique. Une ligne par révision archivée, portant l'instantané complet de la fiche
//       telle qu'elle était au moment où quelqu'un a demandé à la modifier.
//
//   commandes_recette_figee
//       La protection. Une ligne par commande dont la recette technique a été figée. C'est elle
//       qui empêche une révision de fiche de changer les besoins d'une production déjà décidée.
//       PRIMARY KEY sur commande_id : une commande a une recette, ou aucune — jamais deux, donc
//       jamais d'ambiguïté sur celle qui fait foi.
//
//   ft_matieres / ft_accessoires : hors_approvisionnement, hors_appro_motif, hors_appro_precision
//       Le composant décrit dans la nomenclature mais qui ne fait l'objet d'aucun achat : fourni
//       par le façonnier, fourni par le client, ou purement descriptif. Le motif est contrôlé par
//       l'application au moment de la saisie (SQLite ne sait pas ajouter une contrainte CHECK à
//       une colonne existante sans reconstruire la table — ce qu'on s'interdit ici).

function colonnes(db, table) {
  return db.prepare("PRAGMA table_info(" + table + ")").all().map((c) => c.name);
}

function tableExiste(db, nom) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(nom);
}

/** Ajoute une colonne si elle manque. Rend true si quelque chose a été fait. */
function ajouterColonne(db, table, colonne, definition) {
  if (colonnes(db, table).indexOf(colonne) !== -1) return false;
  db.exec("ALTER TABLE " + table + " ADD COLUMN " + colonne + " " + definition);
  return true;
}

// ------------------------------------------------------------------------------------------------
// 1. Numéro de révision sur la fiche technique
// ------------------------------------------------------------------------------------------------
function needsRevisionFiche(db) {
  return colonnes(db, "fiches_techniques").indexOf("revision") === -1;
}

function migrateRevisionFiche(db) {
  ajouterColonne(db, "fiches_techniques", "revision", "INTEGER NOT NULL DEFAULT 1");
  ajouterColonne(db, "fiches_techniques", "revision_motif", "TEXT");
}

// ------------------------------------------------------------------------------------------------
// 2. Historique des révisions
// ------------------------------------------------------------------------------------------------
function needsTableRevisions(db) {
  return !tableExiste(db, "fiches_techniques_revisions");
}

function migrateTableRevisions(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fiches_techniques_revisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id),
      revision INTEGER NOT NULL,
      motif TEXT,
      -- Instantané complet de la fiche, tel que le produit ficheTechnique.get() : croquis,
      -- mesures, tailles, valeurs, matières, fournitures. C'est exactement l'objet que reçoit le
      -- générateur PDF, donc une révision archivée reste imprimable sans code supplémentaire.
      contenu_json TEXT NOT NULL,
      format_version INTEGER NOT NULL DEFAULT 1,
      -- Date de validation de CETTE révision, reprise de la fiche au moment de l'archivage. Sert
      -- à dire si une commande a été lancée avant ou après un changement de fiche.
      validated_at TEXT,
      archivee_le TEXT NOT NULL DEFAULT (datetime('now')),
      archivee_par_id INTEGER REFERENCES listes_valeurs(id),
      UNIQUE (fiche_id, revision)
    );
  `);
}

// ------------------------------------------------------------------------------------------------
// 3. Recette figée par commande
// ------------------------------------------------------------------------------------------------
function needsRecetteFigee(db) {
  return !tableExiste(db, "commandes_recette_figee");
}

function migrateRecetteFigee(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commandes_recette_figee (
      commande_id INTEGER PRIMARY KEY REFERENCES commandes(id) ON DELETE CASCADE,
      fiche_id INTEGER NOT NULL REFERENCES fiches_techniques(id),
      -- La révision dont provient cette recette : permet de dire à l'écran « figée depuis la
      -- révision 2, la fiche est aujourd'hui en révision 3 ».
      fiche_revision INTEGER NOT NULL,
      -- Les composants normalisés, exactement sous la forme que consomme calculBesoins.js :
      -- unités, taux de perte, modes de consommation, consommations par taille, correspondances
      -- de couleurs. On fige l'ENTRÉE du calcul, pas une interprétation de la fiche.
      composants_json TEXT NOT NULL,
      -- Le moteur REFUSE une version de format qu'il ne connaît pas et revient à la fiche en le
      -- disant, plutôt que d'interpréter de travers un instantané qu'il ne comprend plus.
      format_version INTEGER NOT NULL DEFAULT 1,
      figee_le TEXT NOT NULL DEFAULT (datetime('now')),
      -- validation_commande | revision_fiche | adoption_manuelle
      figee_motif TEXT NOT NULL,
      figee_par_id INTEGER REFERENCES listes_valeurs(id)
    );
  `);
}

// ------------------------------------------------------------------------------------------------
// 4. Composants hors approvisionnement
// ------------------------------------------------------------------------------------------------
function needsHorsAppro(db) {
  return colonnes(db, "ft_matieres").indexOf("hors_approvisionnement") === -1
    || colonnes(db, "ft_accessoires").indexOf("hors_approvisionnement") === -1;
}

function migrateHorsAppro(db) {
  ["ft_matieres", "ft_accessoires"].forEach((table) => {
    ajouterColonne(db, table, "hors_approvisionnement", "INTEGER NOT NULL DEFAULT 0");
    ajouterColonne(db, table, "hors_appro_motif", "TEXT");
    ajouterColonne(db, table, "hors_appro_precision", "TEXT");
  });
}

/**
 * Point d'entrée unique, à appeler une fois au démarrage, après migrerApprovisionnement et avant
 * les contrôles de schéma. Idempotent : relancé sur une base déjà migrée, il ne fait rien et
 * n'affiche rien.
 */
function migrerRevisions(db) {
  if (needsRevisionFiche(db)) {
    console.log("[migration] -> Debut : Revisions / numero de revision sur les fiches techniques");
    migrateRevisionFiche(db);
    console.log("[migration] OK Termine avec succes : revision ajoutee a fiches_techniques");
  }
  if (needsTableRevisions(db)) {
    console.log("[migration] -> Debut : Revisions / historique des revisions");
    migrateTableRevisions(db);
    console.log("[migration] OK Termine avec succes : table fiches_techniques_revisions creee");
  }
  if (needsRecetteFigee(db)) {
    console.log("[migration] -> Debut : Revisions / recette figee par commande");
    migrateRecetteFigee(db);
    console.log("[migration] OK Termine avec succes : table commandes_recette_figee creee (vide)");
  }
  if (needsHorsAppro(db)) {
    console.log("[migration] -> Debut : Revisions / composants hors approvisionnement");
    migrateHorsAppro(db);
    console.log("[migration] OK Termine avec succes : colonnes hors approvisionnement ajoutees");
  }
}

module.exports = {
  migrerRevisions,
  needsRevisionFiche,
  migrateRevisionFiche,
  needsTableRevisions,
  migrateTableRevisions,
  needsRecetteFigee,
  migrateRecetteFigee,
  needsHorsAppro,
  migrateHorsAppro,
};
