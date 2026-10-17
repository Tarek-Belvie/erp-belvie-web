const { normalizeNom } = require("../db/normalize");

// Ratios de répartition réutilisables : un jeu de poids par taille (ex. S=1, M=2, L=3,
// XL=2, 2XL=1), enregistré une fois et réapplicable sur toutes les commandes suivantes.
//
// Un ratio appartient TOUJOURS à une grille de tailles, et ses lignes référencent
// grilles_tailles_valeurs(id) par clé étrangère. C'est le point essentiel de cette table :
// aucune correspondance par libellé n'est jamais faite. Un ratio créé sur la grille
// "Vêtements" ne peut donc pas être appliqué à une grille numérique, et ne peut pas non
// plus pointer silencieusement vers une mauvaise taille — exactement le défaut historique
// qui avait causé la confusion entre listes_valeurs et grilles_tailles_valeurs.
//
// Ce module ne touche ni aux commandes, ni à commande_lignes : il ne fait que décrire des
// proportions. Le calcul des quantités, lui, vit côté interface (repartitionRatio.ts) et
// son résultat est saisi dans la grille comme n'importe quelle valeur manuelle.

function assertGrille(db, grilleId) {
  const grille = db.prepare("SELECT id, nom FROM grilles_tailles WHERE id = ?").get(grilleId);
  if (!grille) throw new Error("Grille de tailles introuvable.");
  return grille;
}

function listLignes(db, ratioId) {
  return db
    .prepare(
      "SELECT l.id, l.taille_id, l.poids, v.valeur AS taille_nom, v.ordre, v.actif AS taille_active " +
        "FROM repartition_ratios_lignes l " +
        "JOIN grilles_tailles_valeurs v ON v.id = l.taille_id " +
        "WHERE l.ratio_id = ? ORDER BY v.ordre"
    )
    .all(ratioId);
}

function get(db, ratioId) {
  const ratio = db.prepare("SELECT * FROM repartition_ratios WHERE id = ?").get(ratioId);
  if (!ratio) return null;
  return Object.assign({}, ratio, { lignes: listLignes(db, ratioId) });
}

// Ratios disponibles pour une grille donnée. Renvoie une liste vide plutôt qu'une erreur
// si aucune grille n'est encore connue : l'interface doit pouvoir s'afficher sans ratio.
function listPourGrille(db, grilleId) {
  if (grilleId == null) return [];
  const ratios = db
    .prepare("SELECT * FROM repartition_ratios WHERE grille_id = ? AND actif = 1 ORDER BY nom COLLATE NOCASE ASC")
    .all(Number(grilleId));
  return ratios.map((r) => Object.assign({}, r, { lignes: listLignes(db, r.id) }));
}

// Enregistre (ou remplace, à nom identique dans la même grille) un ratio.
// Toutes les validations sont faites avant la moindre écriture : un ratio incohérent est
// refusé avec un message explicite, jamais enregistré partiellement.
function enregistrer(db, payload) {
  const nom = String((payload && payload.nom) || "").trim();
  if (!nom) throw new Error("Le nom du ratio est obligatoire.");

  const grilleId = Number(payload && payload.grille_id);
  if (!Number.isInteger(grilleId)) throw new Error("Grille de tailles manquante.");
  assertGrille(db, grilleId);

  const toutesLignes = (payload && payload.lignes) || [];
  const lignes = toutesLignes.filter((l) => Number(l.poids) > 0);
  if (lignes.length === 0) {
    throw new Error("Renseignez au moins un poids supérieur à 0 avant d'enregistrer ce ratio.");
  }

  const appartient = db.prepare("SELECT valeur FROM grilles_tailles_valeurs WHERE id = ? AND grille_id = ?");
  for (const ligne of lignes) {
    const poids = Number(ligne.poids);
    if (!Number.isFinite(poids) || poids <= 0) {
      throw new Error("Un poids de ratio doit être un nombre strictement supérieur à 0.");
    }
    if (!appartient.get(Number(ligne.taille_id), grilleId)) {
      // Garde-fou volontairement bloquant : plutôt refuser que d'enregistrer un ratio
      // dont une taille viendrait d'un autre référentiel.
      throw new Error("Une taille de ce ratio n'appartient pas à la grille sélectionnée — enregistrement refusé.");
    }
  }

  const norm = normalizeNom(nom);
  const tx = db.transaction(() => {
    const existant = db
      .prepare("SELECT id FROM repartition_ratios WHERE grille_id = ? AND nom_normalise = ?")
      .get(grilleId, norm);

    let ratioId;
    if (existant) {
      ratioId = existant.id;
      db.prepare("UPDATE repartition_ratios SET nom = ?, actif = 1, updated_at = datetime('now') WHERE id = ?").run(nom, ratioId);
      db.prepare("DELETE FROM repartition_ratios_lignes WHERE ratio_id = ?").run(ratioId);
    } else {
      const info = db
        .prepare("INSERT INTO repartition_ratios (nom, nom_normalise, grille_id) VALUES (?, ?, ?)")
        .run(nom, norm, grilleId);
      ratioId = info.lastInsertRowid;
    }

    const insert = db.prepare("INSERT INTO repartition_ratios_lignes (ratio_id, taille_id, poids) VALUES (?, ?, ?)");
    lignes.forEach((ligne) => insert.run(ratioId, Number(ligne.taille_id), Number(ligne.poids)));
    return ratioId;
  });

  return get(db, tx());
}

// Suppression définitive : un ratio n'est référencé par aucune commande (il ne sert qu'au
// calcul, dont le résultat est copié dans les quantités), sa suppression ne peut donc
// jamais rendre une commande incohérente.
function supprimer(db, ratioId) {
  const ratio = db.prepare("SELECT id FROM repartition_ratios WHERE id = ?").get(ratioId);
  if (!ratio) throw new Error("Ratio introuvable.");
  db.prepare("DELETE FROM repartition_ratios WHERE id = ?").run(ratioId); // cascade sur les lignes
  return { deleted: true };
}

module.exports = { listPourGrille, get, enregistrer, supprimer };
