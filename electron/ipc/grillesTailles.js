const { normalizeNom } = require("../db/normalize");

// --- Grilles ---

function listGrilles(db, options) {
  const seulementActives = !options || options.activesSeulement !== false;
  const grilles = db.prepare(
    "SELECT * FROM grilles_tailles" + (seulementActives ? " WHERE actif = 1" : "") + " ORDER BY nom"
  ).all();
  return grilles.map((g) => Object.assign({}, g, { valeurs: listValeurs(db, g.id) }));
}

function getGrille(db, grilleId) {
  const grille = db.prepare("SELECT * FROM grilles_tailles WHERE id = ?").get(grilleId);
  if (!grille) return null;
  return Object.assign({}, grille, { valeurs: listValeurs(db, grilleId) });
}

function listValeurs(db, grilleId, options) {
  const seulementActives = !options || options.activesSeulement !== false;
  return db.prepare(
    "SELECT * FROM grilles_tailles_valeurs WHERE grille_id = ?" + (seulementActives ? " AND actif = 1" : "") + " ORDER BY ordre"
  ).all(grilleId);
}

function creerGrille(db, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la grille est obligatoire.");
  const info = db.prepare("INSERT INTO grilles_tailles (nom, nom_normalise) VALUES (?, ?)").run(nomTrim, normalizeNom(nomTrim));
  return getGrille(db, info.lastInsertRowid);
}

function renommerGrille(db, grilleId, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la grille est obligatoire.");
  db.prepare("UPDATE grilles_tailles SET nom = ?, nom_normalise = ? WHERE id = ?").run(nomTrim, normalizeNom(nomTrim), grilleId);
  return getGrille(db, grilleId);
}

function setGrilleActive(db, grilleId, actif) {
  db.prepare("UPDATE grilles_tailles SET actif = ? WHERE id = ?").run(actif ? 1 : 0, grilleId);
  return getGrille(db, grilleId);
}

// Suppression bloquée si la grille est utilisée (par une commande passée, une fiche technique, ou
// associée à un type de produit) — la désactivation (setGrilleActive) reste toujours possible et
// n'efface jamais rien.
function supprimerGrille(db, grilleId) {
  const utiliseeCommande = db.prepare(
    "SELECT COUNT(*) AS n FROM commande_lignes cl JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id WHERE gtv.grille_id = ?"
  ).get(grilleId).n;
  const utiliseeFiche = db.prepare(
    "SELECT COUNT(*) AS n FROM ft_tailles ft JOIN grilles_tailles_valeurs gtv ON gtv.id = ft.grille_valeur_id WHERE gtv.grille_id = ?"
  ).get(grilleId).n;
  const utiliseeProduit = db.prepare("SELECT COUNT(*) AS n FROM produit_grille_taille WHERE grille_id = ?").get(grilleId).n;
  if (utiliseeCommande > 0 || utiliseeFiche > 0 || utiliseeProduit > 0) {
    throw new Error("Cette grille est déjà utilisée (commande, fiche technique ou type de produit) — désactivez-la plutôt que de la supprimer.");
  }
  db.prepare("DELETE FROM grilles_tailles WHERE id = ?").run(grilleId); // cascade sur les valeurs
  return { deleted: true };
}

// --- Valeurs d'une grille ---

function ajouterValeur(db, grilleId, valeur) {
  const valeurTrim = String(valeur || "").trim();
  if (!valeurTrim) throw new Error("La valeur est obligatoire.");
  const normalisee = normalizeNom(valeurTrim);
  const existante = db.prepare("SELECT id FROM grilles_tailles_valeurs WHERE grille_id = ? AND valeur_normalisee = ?").get(grilleId, normalisee);
  if (existante) return getGrille(db, grilleId); // déjà présente, rien à dupliquer
  const maxOrdre = db.prepare("SELECT MAX(ordre) AS m FROM grilles_tailles_valeurs WHERE grille_id = ?").get(grilleId).m;
  db.prepare("INSERT INTO grilles_tailles_valeurs (grille_id, valeur, valeur_normalisee, ordre) VALUES (?, ?, ?, ?)")
    .run(grilleId, valeurTrim, normalisee, (maxOrdre == null ? -1 : maxOrdre) + 1);
  return getGrille(db, grilleId);
}

function modifierValeur(db, grilleId, valeurId, nouvelleValeur) {
  const valeurTrim = String(nouvelleValeur || "").trim();
  if (!valeurTrim) throw new Error("La valeur est obligatoire.");
  db.prepare("UPDATE grilles_tailles_valeurs SET valeur = ?, valeur_normalisee = ? WHERE id = ? AND grille_id = ?")
    .run(valeurTrim, normalizeNom(valeurTrim), valeurId, grilleId);
  return getGrille(db, grilleId);
}

function supprimerValeur(db, grilleId, valeurId) {
  db.prepare("DELETE FROM grilles_tailles_valeurs WHERE id = ? AND grille_id = ?").run(valeurId, grilleId);
  return getGrille(db, grilleId);
}

function reordonnerValeurs(db, grilleId, orderedValeurIds) {
  const update = db.prepare("UPDATE grilles_tailles_valeurs SET ordre = ? WHERE id = ? AND grille_id = ?");
  const tx = db.transaction(() => { orderedValeurIds.forEach((id, i) => update.run(i, id, grilleId)); });
  tx();
  return getGrille(db, grilleId);
}

// --- Association type de produit -> grille ---

function getGrillePourProduit(db, produitId) {
  const lien = db.prepare("SELECT grille_id FROM produit_grille_taille WHERE produit_id = ?").get(produitId);
  if (!lien) return null;
  return getGrille(db, lien.grille_id);
}

function setGrillePourProduit(db, produitId, grilleId) {
  if (grilleId == null) {
    db.prepare("DELETE FROM produit_grille_taille WHERE produit_id = ?").run(produitId);
    return null;
  }
  db.prepare(
    "INSERT INTO produit_grille_taille (produit_id, grille_id) VALUES (?, ?) " +
    "ON CONFLICT(produit_id) DO UPDATE SET grille_id = excluded.grille_id"
  ).run(produitId, grilleId);
  return getGrillePourProduit(db, produitId);
}

module.exports = {
  listGrilles, getGrille, creerGrille, renommerGrille, setGrilleActive, supprimerGrille,
  ajouterValeur, modifierValeur, supprimerValeur, reordonnerValeurs,
  getGrillePourProduit, setGrillePourProduit,
};
