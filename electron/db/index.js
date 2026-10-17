const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const { app } = require("electron");
const { seedIfEmpty } = require("./seed");
const { normalizeNom } = require("./normalize");
const { backupBeforeMigration, restoreBackup } = require("./migrationSafety");
const {
  needsListesMigration, migrateToListesValeurs,
  needsPhotoColumns, migrateAddPhotoColumns,
  needsEntrepriseBanqueColumns, migrateAddEntrepriseBanqueColumns,
  needsListesOrdreMigration, migrateListesOrdre,
  needsLignesMigration, migrateToCommandeLignes,
  needsListesCodeMigration, migrateListesCode,
  needsArticlesCycleMigration, migrateToArticlesCycleDeVie,
  needsBcPfSingleDocMigration, migrateToBcPfSingleDoc,
  needsDeclinaisonAffichageCouleurColumn, migrateAddDeclinaisonAffichageCouleurColumn,
  needsListesCoupeTypeMigration, migrateListesCoupeType,
  needsResponsableSimplification, migrateResponsableSimplification,
  needsListesPointureCategorieTypeMigration, migrateListesPointureCategorieType,
  needsGrillesTaillesMigration, migrateGrillesTailles,
  needsFicheTechniqueRebuild, migrateRebuildFicheTechnique,
  needsFicheTechniqueCoupeColumn, migrateAddFicheTechniqueCoupeColumn,
  needsModelesMesuresMultipleColumn, migrateModelesMesuresMultiple,
  needsModelesMesuresSansAxeMigration, migrateModelesMesuresSansAxe,
  needsArticleCategorieColumn, migrateAddArticleCategorieColumn,
  needsPlanningArticlesTable, migrateAddPlanningArticlesTable,
  needsModuleFinance, migrateAjouterModuleFinance,
  needsEntrepriseTauxTvaDefautColumn, migrateAjouterEntrepriseTauxTvaDefautColumn,
  needsPaiementTypeColumn, migrateAjouterPaiementTypeColumn,
  needsArticlePrixVenteEnvisageColumn, migrateAjouterArticlePrixVenteEnvisageColumn,
  needsListesValeursFournisseurIdColumn, migrateAjouterListesValeursFournisseurIdColumn,
  needsPosteCoutAjoutAutoColumn, migrateAjouterPosteCoutAjoutAutoColumn,
  needsAchatMatiereColonnesStock, migrateAjouterAchatMatiereColonnesStock,
  needsPostesCoutPredefinisTable, migrateAjouterPostesCoutPredefinisTable,
  needsEstimationsTables, migrateAjouterEstimationsTables,
  needsEcheanceFactureId, migrateAjouterEcheanceFactureId,
  needsFournisseurChampsStructures, migrateAjouterFournisseurChampsStructures,
  needsArticleProduitNullable, migrateArticleProduitNullable,
  needsPlanningDatesSeparees, migrateAddPlanningDatesSeparees,
  needsPlanningProduitRayonColumns, migrateAddPlanningProduitRayonColumns,
  needsCommandeLigneReferenceColumn, migrateAddCommandeLigneReferenceColumn,
  needsBcPfLigneReferenceColumn, migrateAddBcPfLigneReferenceColumn,
  needsBcPfResponsableColumn, migrateAddBcPfResponsableColumn,
  needsEntrepriseFooterColumns, migrateAddEntrepriseFooterColumns,
  needsFtMatieresTables, migrateAjouterFtMatieresTables,
  needsFournituresEvolution, migrateEvolutionFournitures, seedFournituresCatalogue,
  needsFicheGrilleColumn, migrateAddFicheGrilleColumn,
  needsFtGradationsTable, migrateAjouterFtGradationsTable,
  needsMesureNomLocalColumn, migrateAddMesureNomLocalColumn,
  needsArticleDesignationColumn, migrateAddArticleDesignation, rapportContradictionsCategorie,
  needsFtTaillesFkRepair, migrateReparerFtTaillesFk,
  needsD2TypesArticles, migrateD2TypesArticles,
  needsModelesParType, migrateRattacherModelesParType,
  needsMesureGroupeColumns, migrateAjouterMesureGroupe,
  needsRepartitionRatiosTables, migrateAjouterRepartitionRatiosTables,
  needsFicheDescriptionTechniqueColumn, migrateAddFicheDescriptionTechniqueColumn,
} = require("./migrate");
// Module Approvisionnement : ses migrations vivent dans leur propre fichier plutôt que dans
// migrate.js, qui est partagé par tous les chantiers. Un lot, un fichier, aucun conflit de
// version lors des copies.
const migrationsApprovisionnement = require("./migrationsApprovisionnement");
const migrationsRevisions = require("./migrationsRevisions");
const migrationsBonsMp = require("./migrationsBonsMp");
const { migrerApprovisionnement } = migrationsApprovisionnement;
const { migrerRevisions } = migrationsRevisions;
const { migrerBonsMp } = migrationsBonsMp;
const sauvegarde = require("../ipc/sauvegarde");

/** Lecture seule, pour que la sauvegarde prealable puisse se verifier elle-meme. */
function ouvrirBaseLectureSeule(chemin) {
  const Database = require("better-sqlite3");
  return new Database(chemin, { readonly: true, fileMustExist: true });
}

function versionApplication() {
  try { return require("../../package.json").version; } catch (_) { return null; }
}

/** L'emplacement externe choisi par l'utilisateur, s'il en a choisi un. Lu directement ici : a ce
 *  stade du demarrage, les modules IPC ne sont pas encore charges. */
function lireDossierExterneAuDemarrage(db) {
  try {
    const row = db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get("sauvegarde_dossier_externe");
    return row && row.valeur ? row.valeur : null;
  } catch (_) { return null; }
}

let db = null;

function getDbPath() {
  return path.join(app.getPath("userData"), "belvie.db");
}

function assertCommandesSchema(database) {
  const cols = database.prepare("PRAGMA table_info(commandes)").all().map((c) => c.name);
  const required = [
    "article_id", "type_production", "reference_production", "responsable_nom", "atelier_id", "quantite_totale",
    "statut", "bloquee", "valide_le", "lance_le", "controle_qualite_le", "terminee_le",
    "annulee_le", "archived_le", "desarchive_le",
  ];
  const missing = required.filter((c) => !cols.includes(c));
  const tables = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((t) => t.name);
  ["commande_lignes", "articles", "article_photos", "historique_transitions"].forEach((t) => {
    if (!tables.includes(t)) missing.push(`(table) ${t}`);
  });
  if (missing.length) {
    throw new Error(
      `Initialisation interrompue : colonnes manquantes après migration (${missing.join(", ")}). ` +
      `Le fichier de base de données n'a pas été modifié ni supprimé.`
    );
  }
}

// Exécute une migration qui RECONSTRUIT une table (CREATE ... _new / INSERT / DROP / RENAME).
// Ce type de migration est dangereux si des clés étrangères pointent vers (ou depuis) la table
// reconstruite : SQLite exécute un DELETE FROM implicite avant tout DROP TABLE dès que
// "foreign_keys = ON", ce qui déclenche soit un blocage ("FOREIGN KEY constraint failed") pour
// les relations NO ACTION, soit — plus grave — une suppression EN CASCADE silencieuse pour les
// relations ON DELETE CASCADE (ex: commande_lignes). D'où la procédure stricte ci-dessous.
function runRebuildMigration(name, migrationFn) {
  const dbPath = getDbPath();
  console.log(`[migration] -> Debut : ${name}`);

  const backupPath = backupBeforeMigration(db, dbPath);
  console.log(`[migration]   Sauvegarde de securite creee : ${backupPath}`);

  // IMPORTANT : la (des)activation de "foreign_keys" est un no-op si elle est executee a
  // l'interieur d'une transaction active. Nous sommes ici au niveau racine (aucun BEGIN en
  // cours) : c'est le seul moment sur pour ce PRAGMA.
  db.pragma("foreign_keys = OFF");

  try {
    migrationFn(db);
  } catch (err) {
    db.pragma("foreign_keys = ON");
    console.error(`[migration] ECHEC pendant "${name}" :`, err.message);
    throw new Error(
      `La migration "${name}" a echoue : ${err.message}\n` +
      `La transaction de cette migration a ete annulee automatiquement par SQLite : aucune donnee n'a ete perdue. ` +
      `Une sauvegarde de securite supplementaire existe aussi ici : ${backupPath}`
    );
  }

  const violations = db.prepare("PRAGMA foreign_key_check").all();
  if (violations.length > 0) {
    console.error(`[migration] ANOMALIES detectees apres "${name}" :`, violations);

    db.close();
    restoreBackup(backupPath, dbPath);
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");

    const detail = violations
      .map((v) => `table "${v.table}", ligne ${v.rowid}, reference invalide vers "${v.parent}" (cle etrangere #${v.fkid})`)
      .join(" ; ");
    throw new Error(
      `La migration "${name}" a produit des incoherences de cles etrangeres et a ete annulee. ` +
      `Votre base de donnees a ete restauree automatiquement a son etat d'avant cette migration : ` +
      `aucune donnee n'a ete perdue. Detail des anomalies detectees : ${detail}`
    );
  }

  db.pragma("foreign_keys = ON");
  console.log(`[migration] OK Termine avec succes : ${name}`);
}

function declinaisonsTablesPresentes(database) {
  const row = database.prepare(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name IN " +
    "('declinaison_types','declinaison_valeurs','article_declinaison_types','article_declinaison_valeurs','article_variantes','article_variante_valeurs')"
  ).get();
  return row.n === 6; // toutes présentes, ou aucune (jamais un état intermédiaire avec IF NOT EXISTS)
}

function openDatabase() {
  const dbPath = getDbPath();
  db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Cas rare mais réel : une exécution précédente de la migration "produit_id nullable" s'est
  // arrêtée pile entre le DROP TABLE articles et le RENAME final. À ce stade, "articles" n'existe
  // plus du tout — si on laisse schema.sql s'exécuter maintenant, son "CREATE TABLE IF NOT EXISTS
  // articles" la recréerait VIDE, masquant silencieusement les vraies données restées dans
  // "articles_new". Il faut donc terminer ce renommage AVANT toute chose.
  const articlesManquante = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='articles'").get().n === 0;
  const articlesNewPresente = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name='articles_new'").get().n === 1;
  if (articlesManquante && articlesNewPresente) {
    console.log('[init]   Reprise avant schema.sql : "articles_new" contient les données réelles (migration interrompue juste avant le renommage final) — finalisation immédiate.');
    db.exec("ALTER TABLE articles_new RENAME TO articles");
  }

  // Vérifié AVANT schema.sql, pour que le journal ci-dessous distingue vraiment "ces tables
  // viennent d'apparaître sur cette base" de "elles étaient déjà là" — une preuve auditable
  // d'idempotence, pas seulement une garantie implicite du IF NOT EXISTS.
  const declinaisonsDejaPresentes = declinaisonsTablesPresentes(db);

  console.log("[init] -> Creation des tables de base (schema.sql)...");
  const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  db.exec(schema);
  console.log("[init] OK Tables de base pretes.");

  if (!declinaisonsDejaPresentes) {
    console.log("[migration] -> Debut : Module Declinaisons (creation initiale, purement additive, aucune donnee existante affectee)");
    console.log("[migration] OK Termine avec succes : declinaison_types, declinaison_valeurs, article_declinaison_types, article_declinaison_valeurs, article_variantes, article_variante_valeurs");
  } else {
    console.log("[init]   Module Declinaisons : tables deja presentes, rien a faire (idempotent).");
  }

  if (needsListesMigration(db)) {
    runRebuildMigration("Conversion texte vers listes administrables", (database) => migrateToListesValeurs(database));
  }
  if (needsPhotoColumns(db)) {
    console.log("[migration] -> Debut : Ajout des colonnes photo (ALTER TABLE ADD COLUMN)");
    migrateAddPhotoColumns(db);
    console.log("[migration] OK Termine avec succes : Ajout des colonnes photo");
  }
  if (needsEntrepriseBanqueColumns(db)) {
    console.log("[migration] -> Debut : Ajout des colonnes bancaires entreprise (ALTER TABLE ADD COLUMN)");
    migrateAddEntrepriseBanqueColumns(db);
    console.log("[migration] OK Termine avec succes : Ajout des colonnes bancaires entreprise");
  }
  if (needsListesOrdreMigration(db)) {
    runRebuildMigration("Ajout de l'ordre et du type taille sur les listes administrables", (database) => migrateListesOrdre(database));
  }
  if (needsLignesMigration(db)) {
    runRebuildMigration("Passage au modele multi-couleurs / multi-tailles", (database) => migrateToCommandeLignes(database));
  }
  if (needsListesCodeMigration(db)) {
    runRebuildMigration("Ajout des codes et des types saison/rayon/operateur sur les listes", (database) => migrateListesCode(database));
  }
  if (needsArticlesCycleMigration(db)) {
    runRebuildMigration("Passage aux articles et au cycle de vie des commandes", (database) => migrateToArticlesCycleDeVie(database));
  }
  if (needsBcPfSingleDocMigration(db)) {
    runRebuildMigration("BC PF : passage au modèle un document = une ligne (suppression des versions)", (database) => migrateToBcPfSingleDoc(database));
  }
  if (needsDeclinaisonAffichageCouleurColumn(db)) {
    console.log("[migration] -> Debut : Ajout de affichage_couleur sur declinaison_types (ALTER TABLE ADD COLUMN)");
    migrateAddDeclinaisonAffichageCouleurColumn(db);
    console.log("[migration] OK Termine avec succes : Ajout de affichage_couleur");
  }
  if (needsListesCoupeTypeMigration(db)) {
    runRebuildMigration("Ajout du type 'coupe' sur les listes", (database) => migrateListesCoupeType(database));
  }
  if (needsResponsableSimplification(db)) {
    runRebuildMigration(
      "Simplification du responsable : texte libre par commande et par atelier, plus de liste dédiée",
      (database) => migrateResponsableSimplification(database)
    );
  }
  if (needsListesPointureCategorieTypeMigration(db)) {
    runRebuildMigration("Ajout des types 'pointure' et 'categorie' sur les listes", (database) => migrateListesPointureCategorieType(database));
  }
  if (needsGrillesTaillesMigration(db)) {
    runRebuildMigration(
      "Architecture Grilles de tailles : migration des tailles existantes, préservation des libellés historiques de commande",
      (database) => migrateGrillesTailles(database)
    );
  }
  if (needsModelesMesuresMultipleColumn(db)) {
    runRebuildMigration(
      "Modèles de mesures : plusieurs modèles nommés par type de produit (préserve les modèles déjà configurés)",
      (database) => migrateModelesMesuresMultiple(database)
    );
  }
  if (needsModelesMesuresSansAxeMigration(db)) {
    runRebuildMigration(
      "Modèles de mesures : suppression de l'axe de gradation, devenu sans objet (préserve les modèles déjà configurés)",
      (database) => migrateModelesMesuresSansAxe(database)
    );
  }
  if (needsFicheTechniqueRebuild(db)) {
    runRebuildMigration(
      "Fiche Technique : mise à niveau vers la forme actuelle des tables (aucune donnée de production concernée, module en cours de mise au point)",
      (database) => migrateRebuildFicheTechnique(database)
    );
  }
  // Placé APRÈS le rebuild ci-dessus, jamais avant : ce rebuild supprime ft_matieres et ses filles
  // puis réexécute schema.sql, qui les recrée. Les créer d'abord ne servirait donc à rien, et
  // needsFtMatieresTables serait de toute façon rappelé ici sur une forme déjà correcte.
  // Migration purement additive (quatre CREATE TABLE IF NOT EXISTS, aucune table existante
  // touchée) : pas de runRebuildMigration, comme pour les autres ajouts de tables.
  if (needsFtMatieresTables(db)) {
    console.log("[migration] -> Debut : Fiche Technique / Matieres (creation des tables matiere_couleurs, ft_matieres, ft_matiere_couleurs, ft_matiere_consommations_taille — purement additif)");
    migrateAjouterFtMatieresTables(db);
    console.log("[migration] OK Termine avec succes : tables Matieres de la fiche technique");
  }

  // Fournitures (ex-Accessoires). Uniquement des ALTER TABLE : aucune table reconstruite, aucune
  // copie ligne a ligne, les photo_path sont donc conserves tels quels. accessoires_catalogue
  // recoit une colonne mais n'est jamais renommee ni reconstruite (FK prix_fournisseurs).
  if (needsFournituresEvolution(db)) {
    console.log("[migration] -> Debut : Fiche Technique / Fournitures (familles habillage-composant, references fusionnees, colonnes obsoletes retirees)");
    migrateEvolutionFournitures(db);
    console.log("[migration] OK Termine avec succes : evolution Fournitures de la fiche technique");
  }
  // Grille de tailles au niveau de la fiche. Un seul ADD COLUMN nullable : aucune donnee
  // existante n'est lue ni reecrite, les fiches anterieures gardent NULL.
  if (needsFicheGrilleColumn(db)) {
    console.log("[migration] -> Debut : Fiche Technique / colonne grille_id (grille de tailles propre a la fiche)");
    migrateAddFicheGrilleColumn(db);
    console.log("[migration] OK Termine avec succes : colonne grille_id ajoutee");
  }

  // Gradations du tableau de mesures. Table neuve, purement additive.
  if (needsFtGradationsTable(db)) {
    console.log("[migration] -> Debut : Fiche Technique / table des gradations (ecart entre deux tailles consecutives)");
    migrateAjouterFtGradationsTable(db);
    console.log("[migration] OK Termine avec succes : table ft_mesures_gradations creee");
  }

  // Libelle de mesure propre a la fiche. Un seul ADD COLUMN nullable, purement additif.
  if (needsMesureNomLocalColumn(db)) {
    console.log("[migration] -> Debut : Fiche Technique / colonne nom_local (libelle de mesure propre a la fiche)");
    migrateAddMesureNomLocalColumn(db);
    console.log("[migration] OK Termine avec succes : colonne nom_local ajoutee");
  }

  // REPARATION ft_tailles : la cle etrangere grille_valeur_id pointait tailles_catalogue au lieu
  // de grilles_tailles_valeurs sur les bases anciennes, rendant impossible l'ajout d'une taille
  // de grille. SQLite ne sachant pas changer la cible d'une FK, la table est reconstruite.
  // runRebuildMigration fournit la sauvegarde prealable, foreign_keys = OFF et la restauration
  // automatique en cas d'echec — les id sont recopies explicitement (voir migrate.js).
  if (needsFtTaillesFkRepair(db)) {
    runRebuildMigration(
      "Fiche Technique : reparation de la cle etrangere ft_tailles.grille_valeur_id (pointait tailles_catalogue au lieu de grilles_tailles_valeurs)",
      (database) => migrateReparerFtTaillesFk(database)
    );
  }

  // [D1] Designation commerciale de l'article. Purement additif : ADD COLUMN + recopie du nom du
  // produit actuel. Aucun produit_id n'est repointe ici.
  if (needsArticleDesignationColumn(db)) {
    console.log("[migration] -> Debut : Articles / colonne designation (nom commercial propre a l'article)");
    migrateAddArticleDesignation(db);
    console.log("[migration] OK Termine avec succes : designation ajoutee et reprise");
  }
  // [D2] Categorie -> Type d'article -> Article. produit_id designe desormais un TYPE generique ;
  // le nom commercial vit dans articles.designation (rempli par D1). Controles avant/apres
  // bloquants : toute divergence annule la migration et restaure la sauvegarde.
  if (needsD2TypesArticles(db)) {
    const modelesMesuresApi = require("../ipc/modelesMesures");
    const avant = {
      articles: db.prepare("SELECT COUNT(*) AS n FROM articles").get().n,
      designations: db.prepare("SELECT COUNT(*) AS n FROM articles WHERE designation IS NOT NULL AND TRIM(designation) <> ''").get().n,
      references: db.prepare("SELECT id, reference_principale, numero_sequentiel, abreviation FROM articles ORDER BY id").all(),
      fiches: db.prepare("SELECT COUNT(*) AS n FROM fiches_techniques").get().n,
      commandes: db.prepare("SELECT COUNT(*) AS n FROM commandes").get().n,
      lignes: db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes").get().n,
      valeurs: db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_valeurs").get().n,
      produits: db.prepare("SELECT COUNT(*) AS n FROM listes_valeurs WHERE type='produit'").get().n,
    };

    runRebuildMigration(
      "D2 : Categorie -> Type d'article -> Article (repointage des produit_id vers les types generiques)",
      (database) => {
        const rapport = migrateD2TypesArticles(database, normalizeNom, modelesMesuresApi);

        console.log("[migration]    --- MAPPING REEL : ancienne valeur -> type -> designation conservee ---");
        rapport.articles.forEach((a) => console.log("[migration]      article " + a.id + " " +
          (a.reference || "sans ref.") + " : « " + a.ancien + " » -> type « " + a.type + " » | designation « " + a.designation + " »"));
        if (rapport.articles.length === 0) console.log("[migration]      (aucun article repointe)");
        console.log("[migration]    Anciennes valeurs desactivees : " +
          (rapport.desactivees.length ? rapport.desactivees.join(", ") : "aucune"));
        rapport.retenues.forEach((r) => console.log("[migration]      « " + r.nom +
          " » RESTE ACTIVE : encore referencee par " + r.par));

        // --- Controles APRES, tous bloquants ---
        const apres = {
          articles: database.prepare("SELECT COUNT(*) AS n FROM articles").get().n,
          designations: database.prepare("SELECT COUNT(*) AS n FROM articles WHERE designation IS NOT NULL AND TRIM(designation) <> ''").get().n,
          references: database.prepare("SELECT id, reference_principale, numero_sequentiel, abreviation FROM articles ORDER BY id").all(),
          fiches: database.prepare("SELECT COUNT(*) AS n FROM fiches_techniques").get().n,
          commandes: database.prepare("SELECT COUNT(*) AS n FROM commandes").get().n,
          lignes: database.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes").get().n,
          valeurs: database.prepare("SELECT COUNT(*) AS n FROM ft_mesures_valeurs").get().n,
          produits: database.prepare("SELECT COUNT(*) AS n FROM listes_valeurs WHERE type='produit'").get().n,
        };
        const exiger = (libelle, a, b) => {
          if (a !== b) throw new Error("D2 : " + libelle + " — " + a + " avant, " + b + " apres. Abandon.");
        };
        exiger("nombre d'articles", avant.articles, apres.articles);
        exiger("fiches techniques", avant.fiches, apres.fiches);
        exiger("commandes", avant.commandes, apres.commandes);
        exiger("lignes de mesures", avant.lignes, apres.lignes);
        exiger("valeurs de mesures", avant.valeurs, apres.valeurs);
        if (apres.designations < avant.designations) {
          throw new Error("D2 : une designation a ete perdue. Abandon.");
        }
        if (apres.designations < apres.articles) {
          console.log("[controle]  " + (apres.articles - apres.designations) + " article(s) sans designation (aucun produit d'origine).");
        }
        avant.references.forEach((r, k) => {
          const b = apres.references[k];
          if (!b || b.id !== r.id || b.reference_principale !== r.reference_principale ||
              b.numero_sequentiel !== r.numero_sequentiel || b.abreviation !== r.abreviation) {
            throw new Error("D2 : la reference de l'article " + r.id + " a ete modifiee. Abandon.");
          }
        });
        if (apres.produits < avant.produits) throw new Error("D2 : une valeur produit a ete SUPPRIMEE. Abandon.");
        const fkc = database.prepare("PRAGMA foreign_key_check").all();
        if (fkc.length > 0) throw new Error("D2 : " + fkc.length + " violation(s) de cle etrangere. Abandon.");
        console.log("[migration]    Controles OK : references, designations, fiches, commandes et mesures intactes.");
      }
    );
  }

  // Groupes de mesures : deux ADD COLUMN nullables, aucune fiche existante modifiee.
  if (needsMesureGroupeColumns(db)) {
    console.log("[migration] -> Debut : groupes de mesures (principale / detail)");
    migrateAjouterMesureGroupe(db, require("../ipc/modelesMesures"));
    console.log("[migration] OK Termine avec succes : colonnes groupe ajoutees");
  }

  // Rattachement des modeles de mesures aux Types d'article. Independant de D2 et idempotent :
  // un type qui possede deja un modele n'est jamais touche.
  if (needsModelesParType(db, normalizeNom)) {
    const modelesMesuresApi = require("../ipc/modelesMesures");
    console.log("[migration] -> Debut : rattachement des modeles de mesures aux Types d'article");
    const r = migrateRattacherModelesParType(db, normalizeNom, modelesMesuresApi);
    r.crees.forEach((c) => console.log("[migration]    modele cree : " + c.type + " -> jeu « " + c.cle + " » (" + c.lignes + " mesures)"));
    if (r.ignores.length) console.log("[migration]    deja configures, NON touches : " + r.ignores.join(", "));
    if (r.types_absents.length) console.log("[migration]    types absents du referentiel, ignores : " + r.types_absents.join(", "));
    console.log("[migration] OK Termine avec succes : " + r.crees.length + " modele(s) rattache(s)");
  }

  // Rapport de controle, sans correction. Ne produit rien tant que D2 n'est pas installe.
  const contradictions = rapportContradictionsCategorie(db);
  if (contradictions.length > 0) {
    console.log("[controle] " + contradictions.length + " article(s) dont la categorie historique differe de celle du type :");
    contradictions.forEach((c) => console.log("[controle]    article " + c.id + " " + (c.reference_principale || "sans ref.") +
      " : historique=" + c.categorie_historique + " / type=" + (c.categorie_du_type || "aucune")));
    console.log("[controle] Aucune correction automatique : categorie_id reste une donnee historique.");
  }

  // Prereglage des designations courantes : insertion conditionnelle, jamais d'ecrasement.
  seedFournituresCatalogue(db, normalizeNom);
  if (needsArticleCategorieColumn(db)) {
    migrateAddArticleCategorieColumn(db);
  }
  if (needsModuleFinance(db)) {
    migrateAjouterModuleFinance(db);
  }
  if (needsEntrepriseTauxTvaDefautColumn(db)) {
    migrateAjouterEntrepriseTauxTvaDefautColumn(db);
  }
  if (needsPaiementTypeColumn(db)) {
    migrateAjouterPaiementTypeColumn(db);
  }
  if (needsArticlePrixVenteEnvisageColumn(db)) {
    migrateAjouterArticlePrixVenteEnvisageColumn(db);
  }
  if (needsListesValeursFournisseurIdColumn(db)) {
    migrateAjouterListesValeursFournisseurIdColumn(db);
  }
  if (needsFournisseurChampsStructures(db)) {
    migrateAjouterFournisseurChampsStructures(db);
  }
  if (needsAchatMatiereColonnesStock(db)) {
    migrateAjouterAchatMatiereColonnesStock(db);
  }
  if (needsPostesCoutPredefinisTable(db)) {
    migrateAjouterPostesCoutPredefinisTable(db);
  }
  if (needsPosteCoutAjoutAutoColumn(db)) {
    migrateAjouterPosteCoutAjoutAutoColumn(db);
  }
  if (needsEstimationsTables(db)) {
    migrateAjouterEstimationsTables(db);
  }
  if (needsEcheanceFactureId(db)) {
    migrateAjouterEcheanceFactureId(db);
  }
  if (needsArticleProduitNullable(db)) {
    runRebuildMigration(
      "Rendre produit_id facultatif sur articles (conversion Planification sans ressaisie)",
      (database) => migrateArticleProduitNullable(database)
    );
  }
  if (needsPlanningArticlesTable(db)) {
    migrateAddPlanningArticlesTable(db);
  }
  if (needsPlanningDatesSeparees(db)) {
    migrateAddPlanningDatesSeparees(db);
  }
  if (needsPlanningProduitRayonColumns(db)) {
    migrateAddPlanningProduitRayonColumns(db);
  }
  if (needsCommandeLigneReferenceColumn(db)) {
    migrateAddCommandeLigneReferenceColumn(db);
  }
  if (needsBcPfLigneReferenceColumn(db)) {
    migrateAddBcPfLigneReferenceColumn(db);
  }
  if (needsBcPfResponsableColumn(db)) {
    console.log("[migration] -> Debut : Ajout du responsable sur les bons de commande PF (+ rattrapage des documents existants)");
    migrateAddBcPfResponsableColumn(db);
    console.log("[migration] OK Termine avec succes : responsable_nom ajoute");
  }
  if (needsEntrepriseFooterColumns(db)) {
    console.log("[migration] -> Debut : Ajout des champs de pied de page sur entreprise (ville, code_postal, pays, site_web, identifiant_tva, swift_bic)");
    migrateAddEntrepriseFooterColumns(db);
    console.log("[migration] OK Termine avec succes : champs de pied de page ajoutes");
  }
  if (needsFicheTechniqueCoupeColumn(db)) {
    console.log("[migration] -> Debut : Ajout de coupe_id sur fiches_techniques (ALTER TABLE ADD COLUMN)");
    migrateAddFicheTechniqueCoupeColumn(db);
    console.log("[migration] OK Termine avec succes : Ajout de coupe_id");
  }

  // Description technique de la fiche : un seul ADD COLUMN nullable, purement additif.
  // Les fiches existantes gardent NULL et restent strictement inchangees.
  if (needsFicheDescriptionTechniqueColumn(db)) {
    console.log("[migration] -> Debut : Fiche Technique / colonne description_technique");
    migrateAddFicheDescriptionTechniqueColumn(db);
    console.log("[migration] OK Termine avec succes : colonne description_technique ajoutee");
  }

  // Ratios de repartition. Deux tables neuves, purement additives : aucune donnee existante
  // n'est lue ni reecrite, et rejouer cette migration n'a aucun effet.
  if (needsRepartitionRatiosTables(db)) {
    console.log("[migration] -> Debut : Ajout des tables de ratios de repartition (purement additif)");
    migrateAjouterRepartitionRatiosTables(db);
    console.log("[migration] OK Termine avec succes : repartition_ratios, repartition_ratios_lignes");
  }

  // ----------------------------------------------------------------------------------------
  // SAUVEGARDE COMPLÈTE AVANT MIGRATION — lot 2, exigence n° 3
  // ----------------------------------------------------------------------------------------
  // Elle ne se déclenche QUE si une migration est réellement en attente : sans cela, chaque
  // démarrage recopierait les images pour rien. La question « faut-il migrer ? » est posée aux
  // modules de migration eux-mêmes (leurs fonctions needsXxx), et non réimplémentée ici — deux
  // définitions finiraient par diverger, et la sauvegarde se ferait au mauvais moment.
  //
  // Si la sauvegarde échoue, LA MIGRATION N'A PAS LIEU et le démarrage s'interrompt avec un
  // message explicite. C'est volontaire : migrer sans sauvegarde est pire que ne pas démarrer.
  const enAttente = sauvegarde.migrationsEnAttente(db, [
    { nom: "approvisionnement", module: migrationsApprovisionnement },
    { nom: "revisions", module: migrationsRevisions },
    { nom: "bons-mp", module: migrationsBonsMp },
  ]);
  if (enAttente.length > 0) {
    console.log("[migration] -> " + enAttente.length + " migration(s) en attente : sauvegarde complete prealable...");
    let r;
    try {
      r = sauvegarde.sauvegardeAvantOperationSync(db, app.getPath("userData"), "migration", {
        dossierExterne: lireDossierExterneAuDemarrage(db),
        version: versionApplication(),
        ouvrirBase: ouvrirBaseLectureSeule,
      });
    } catch (err) {
      throw new Error(
        "La sauvegarde complete prealable a echoue, la migration n'a donc PAS ete executee et vos "
        + "donnees sont intactes.\n\nCause : " + (err && err.message)
        + "\n\nLiberez de la place sur le disque, ou choisissez un autre emplacement de "
        + "sauvegarde, puis relancez l'application."
      );
    }
    if (!r.verification.ok) {
      throw new Error(
        "La sauvegarde complete prealable n'a pas passe la verification, la migration n'a donc PAS "
        + "ete executee et vos donnees sont intactes.\n\nSauvegarde : " + r.dossier
        + "\nControles en echec : "
        + r.verification.controles.filter((c) => c.etat === "echec").map((c) => c.nom).join(" ; ")
      );
    }
    console.log("[migration] OK Sauvegarde complete ecrite : " + r.dossier);
    if (r.avertissement) console.log("[migration] !! " + r.avertissement);
  }

  // Approvisionnement — etape 1. Trois ALTER TABLE ADD COLUMN : perte_pourcent sur les
  // fournitures, et la consommation specifique par couleur sur les deux tables de
  // correspondance. Purement additif, idempotent, aucune table reconstruite, aucune donnee
  // existante lue ni reecrite.
  migrerApprovisionnement(db);
  // Étape 2a : tables et colonnes des révisions et des recettes figées. Purement additif, et
  // surtout : les tables sont créées VIDES. Aucune recette n'est figée par la migration, donc le
  // calcul des besoins continue de lire la fiche technique et rend exactement les mêmes chiffres.
  migrerRevisions(db);
  // MP1 : la colonne qui rattache un achat de fourniture à son catalogue, et les tables du
  // document. Les tables sont créées VIDES et rien n'écrit encore dedans ; le seul effet visible
  // dès ce démarrage est que le « déjà commandé » des fournitures cesse d'être faux.
  migrerBonsMp(db);

  assertCommandesSchema(db);

  const indexes = fs.readFileSync(path.join(__dirname, "indexes.sql"), "utf-8");
  db.exec(indexes);

  seedIfEmpty(db);

  return db;
}

function getDb() {
  if (!db) throw new Error("La base de donnees n'est pas initialisee.");
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
  }
}

function reopenDatabase() {
  closeDatabase();
  return openDatabase();
}

module.exports = { openDatabase, getDb, closeDatabase, reopenDatabase, getDbPath };
