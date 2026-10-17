// Migrations du module Approvisionnement — étape 1.
//
// Fichier séparé, et c'est délibéré : migrate.js est un gros fichier partagé par tous les
// chantiers, et y ajouter du code à chaque lot multiplie les risques de conflit entre versions.
// Ici, tout ce que l'étape 1 ajoute à la base tient en un seul endroit, et index.js n'a qu'une
// ligne à appeler.
//
// Les trois migrations sont PUREMENT ADDITIVES : trois ALTER TABLE ADD COLUMN, aucune table
// reconstruite, aucune contrainte modifiée, aucune donnée réécrite. Elles ne touchent ni aux
// tables financières, ni aux achats, ni aux commandes. Une base déjà migrée les ignore.
//
// Pourquoi elles sont nécessaires :
//
//   ft_accessoires.perte_pourcent
//       « Les pertes doivent être paramétrables par composant. » Les matières ont déjà cette
//       colonne, les fournitures non : sans elle, une perte sur un zip ou un bord-côte serait
//       impossible à exprimer.
//
//   ft_matiere_couleurs.consommation_technique
//   ft_fourniture_couleurs.consommation_par_piece
//       La consommation spécifique à une couleur, à renseigner uniquement lorsqu'elle diffère
//       (un imprimé à raccorder consomme plus que l'uni). Laissée à NULL, et c'est le cas
//       général, la consommation habituelle du composant s'applique : les fiches existantes
//       donnent donc exactement le même résultat qu'avant.

function colonnes(db, table) {
  return db.prepare("PRAGMA table_info(" + table + ")").all().map((c) => c.name);
}

function needsPerteFournitures(db) {
  return colonnes(db, "ft_accessoires").indexOf("perte_pourcent") === -1;
}

function migratePerteFournitures(db) {
  db.exec("ALTER TABLE ft_accessoires ADD COLUMN perte_pourcent REAL NOT NULL DEFAULT 0");
}

function needsConsommationParCouleur(db) {
  return colonnes(db, "ft_matiere_couleurs").indexOf("consommation_technique") === -1
    || colonnes(db, "ft_fourniture_couleurs").indexOf("consommation_par_piece") === -1;
}

function migrateConsommationParCouleur(db) {
  if (colonnes(db, "ft_matiere_couleurs").indexOf("consommation_technique") === -1) {
    db.exec("ALTER TABLE ft_matiere_couleurs ADD COLUMN consommation_technique REAL");
  }
  if (colonnes(db, "ft_fourniture_couleurs").indexOf("consommation_par_piece") === -1) {
    db.exec("ALTER TABLE ft_fourniture_couleurs ADD COLUMN consommation_par_piece REAL");
  }
}

/**
 * Point d'entrée unique, à appeler une fois au démarrage, avant les contrôles de schéma.
 * Idempotent : relancé sur une base déjà migrée, il ne fait rien et n'affiche rien.
 */
function migrerApprovisionnement(db) {
  if (needsPerteFournitures(db)) {
    console.log("[migration] -> Debut : Approvisionnement / perte_pourcent sur les fournitures");
    migratePerteFournitures(db);
    console.log("[migration] OK Termine avec succes : perte_pourcent ajoutee a ft_accessoires");
  }
  if (needsConsommationParCouleur(db)) {
    console.log("[migration] -> Debut : Approvisionnement / consommation specifique par couleur");
    migrateConsommationParCouleur(db);
    console.log("[migration] OK Termine avec succes : consommation par couleur ajoutee");
  }
}

module.exports = {
  migrerApprovisionnement,
  needsPerteFournitures,
  migratePerteFournitures,
  needsConsommationParCouleur,
  migrateConsommationParCouleur,
};
