// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — commandes (cycle de vie complet).
//
// Adaptée de electron/ipc/commandes.js pour la Phase 1 (Lot 3).
//
// Point de vigilance métier vérifié EXPLICITEMENT avant toute adaptation
// (pas supposé) : validerCommande() exécute DEUX opérations distinctes,
// jamais une seule transaction commune :
//   1. Une transaction complète qui valide la commande (statut, numéro,
//      historique) — commit intégralement, quoi qu'il arrive ensuite.
//   2. Ensuite seulement, en dehors de toute transaction, la création du BC
//      PF est tentée dans un simple try/catch. Si elle échoue, l'erreur est
//      journalisée et ABSORBÉE — jamais relancée. La commande reste
//      validée. C'est un choix assumé et documenté du code de référence
//      (voir commentaire original cité avant l'implémentation), reproduit
//      ici à l'identique, testé explicitement (succès ET échec forcé du BC
//      PF) dans server/test-lot-commandes.js.
//
// db.transaction() -> adapter.transaction(). datetime('now') -> horodatage
// JavaScript en paramètre. Détection "UNIQUE" déjà prouvée portable (Lot 1).
// getOperateurActif()/assertOperateurActif() utilisent désormais la vraie
// implémentation de shared/parametres-bridge.js (plus un stub).
//
// electron/ipc/commandes.js n'est PAS modifié.
// ============================================================================

const crypto = require("crypto");
const bcPf = require("./bcPf");
const { lireOperateurActifId } = require("./parametres-bridge");

const SELECT_BASE =
  "SELECT " +
  "c.id, c.uuid, c.numero, " +
  "c.article_id, ar.reference_principale AS article_reference_principale, ar.produit_id, p.nom AS produit, " +
  "ar.saison_id, s.nom AS saison, ar.annee_collection, ar.rayon_id, ry.nom AS rayon, " +
  "c.type_production, c.numero_reassort, c.reference_production, " +
  "c.responsable_nom AS responsable, " +
  "c.atelier_id, a.nom AS atelier, " +
  "c.quantite_totale, " +
  "(SELECT COUNT(DISTINCT couleur_id) FROM commande_lignes WHERE commande_id = c.id) AS nb_couleurs, " +
  "(SELECT COUNT(DISTINCT taille_id) FROM commande_lignes WHERE commande_id = c.id AND taille_id IS NOT NULL) AS nb_tailles, " +
  "(SELECT photo_path FROM article_photos WHERE article_id = ar.id AND est_principale = 1 LIMIT 1) AS photo_path, " +
  "(SELECT photo_thumb_path FROM article_photos WHERE article_id = ar.id AND est_principale = 1 LIMIT 1) AS photo_thumb_path, " +
  "c.date_lancement, c.date_fin_prevue, " +
  "c.etape_id, e.libelle AS etape_libelle, e.pourcentage AS etape_pourcentage, e.ordre AS etape_ordre, e.cle AS etape_cle, " +
  "c.statut, c.priorite, " +
  "c.bloquee, c.blocage_motif, c.bloquee_le, c.bloquee_par_id, " +
  "c.debloquee_le, c.debloquee_par_id, " +
  "c.valide_le, c.valide_par_id, " +
  "c.lance_le, c.lance_par_id, " +
  "c.controle_qualite_le, c.controle_qualite_par_id, " +
  "c.terminee_le, c.terminee_par_id, " +
  "c.annulee_le, c.annulee_par_id, c.annulation_motif, " +
  "c.archived_le, c.archived_par_id, " +
  "c.desarchive_le, c.desarchive_par_id, " +
  "c.commentaires, " +
  "c.archived, c.est_demo, c.created_at, c.updated_at " +
  "FROM commandes c " +
  "JOIN articles ar ON ar.id = c.article_id " +
  "JOIN listes_valeurs p ON p.id = ar.produit_id " +
  "LEFT JOIN listes_valeurs s ON s.id = ar.saison_id " +
  "LEFT JOIN listes_valeurs ry ON ry.id = ar.rayon_id " +
  "JOIN listes_valeurs a ON a.id = c.atelier_id " +
  "JOIN etapes e ON e.id = c.etape_id " +
  "WHERE c.deleted_at IS NULL ";

const STATUTS_ANNULABLES = ["validee", "en_production", "controle_qualite"];
const STATUTS_BLOCABLES = ["validee", "en_production", "controle_qualite"];

function assertValid(merged) {
  const errors = [];
  if (merged.date_fin_prevue < merged.date_lancement) {
    errors.push("La date limite de production ne peut pas être antérieure à la date de lancement.");
  }
  const responsableEffectif = merged.responsable_nom ?? merged.responsable;
  if (!responsableEffectif || !String(responsableEffectif).trim()) {
    errors.push("Veuillez renseigner un responsable.");
  }
  if (!merged.atelier_id || !Number.isInteger(Number(merged.atelier_id))) {
    errors.push("Veuillez sélectionner un atelier.");
  }
  if (errors.length) throw new Error(errors.join(" "));
}

function assertValidLignes(lignes) {
  if (!Array.isArray(lignes) || lignes.length === 0) {
    throw new Error("Renseignez au moins une quantité dans le tableau couleur × taille.");
  }
  for (const l of lignes) {
    if (!l.couleur_id || !Number.isInteger(Number(l.couleur_id))) {
      throw new Error("Chaque ligne du tableau doit correspondre à une couleur valide.");
    }
    const q = Number(l.quantite);
    if (!Number.isInteger(q) || q <= 0) {
      throw new Error("Chaque quantité renseignée doit être un nombre entier supérieur à zéro.");
    }
  }
}

function sumQuantite(lignes) {
  return lignes.reduce((sum, l) => sum + Number(l.quantite), 0);
}

async function insertLignes(adapter, commandeId, lignes) {
  for (const l of lignes) {
    const ref = l.reference_libre != null ? String(l.reference_libre).trim() || null : null;
    await adapter.run(
      "INSERT INTO commande_lignes (commande_id, couleur_id, reference_libre, taille_id, taille_nom, quantite) " +
      "VALUES (?, ?, ?, ?, (SELECT valeur FROM grilles_tailles_valeurs WHERE id = ?), ?)",
      [commandeId, Number(l.couleur_id), ref, l.taille_id ? Number(l.taille_id) : null,
       l.taille_id ? Number(l.taille_id) : null, Number(l.quantite)]
    );
  }
}

async function fetchLignes(adapter, commandeId) {
  // Taille lue depuis grilles_tailles_valeurs, référentiel unique de taille_id.
  // Joindre listes_valeurs ici renverrait le nom de la ligne de MÊME identifiant —
  // un produit ou une couleur — au lieu de la taille.
  // COALESCE sur taille_nom : une valeur retirée de sa grille garde son libellé.
  return adapter.all(
    "SELECT cl.id, cl.couleur_id, co.nom AS couleur, cl.reference_libre AS couleur_reference, cl.taille_id, " +
    "COALESCE(t.valeur, cl.taille_nom) AS taille, t.ordre AS taille_ordre, cl.quantite " +
    "FROM commande_lignes cl " +
    "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
    "LEFT JOIN grilles_tailles_valeurs t ON t.id = cl.taille_id " +
    "WHERE cl.commande_id = ? " +
    "ORDER BY co.nom ASC, t.ordre ASC", // listes_valeurs.nom porte deja COLLATE "C" au schema
    [commandeId]                        // (Lot 1) : comportement casse-sensible identique a SQLite
  );
}

async function fetchHistorique(adapter, commandeId) {
  return adapter.all(
    "SELECT id, type_evenement, operateur_id, motif, survenu_le FROM historique_transitions WHERE commande_id = ? ORDER BY survenu_le ASC, id ASC",
    [commandeId]
  );
}

async function list(adapter) {
  return adapter.all(SELECT_BASE + "ORDER BY c.date_fin_prevue ASC", []);
}

async function get(adapter, id) {
  const cmd = await adapter.get(SELECT_BASE + "AND c.id = ?", [id]);
  if (!cmd) return cmd;
  cmd.lignes = await fetchLignes(adapter, id);
  cmd.historique = await fetchHistorique(adapter, id);
  return cmd;
}

async function getOperateurActif(adapter) {
  return lireOperateurActifId(adapter);
}

async function assertOperateurActif(adapter) {
  const op = await getOperateurActif(adapter);
  if (!op) {
    throw new Error("Aucun opérateur actif n'est sélectionné. Choisissez-en un dans Paramètres avant de continuer.");
  }
  return op;
}

async function enregistrerHistorique(adapter, commandeId, typeEvenement, operateurId, motif) {
  await adapter.run(
    "INSERT INTO historique_transitions (commande_id, type_evenement, operateur_id, motif) VALUES (?, ?, ?, ?)",
    [commandeId, typeEvenement, operateurId, motif || null]
  );
}

async function genererNumero(adapter) {
  const year = new Date().getFullYear();
  const row = await adapter.get("SELECT dernier_numero FROM compteurs WHERE annee = ?", [year]);
  let next = row ? row.dernier_numero + 1 : 1;
  while (await adapter.get("SELECT 1 AS x FROM commandes WHERE numero = ?", ["CMD-" + year + "-" + String(next).padStart(3, "0")])) next += 1;
  if (!row) await adapter.run("INSERT INTO compteurs (annee, dernier_numero) VALUES (?, ?)", [year, next]);
  else await adapter.run("UPDATE compteurs SET dernier_numero = ? WHERE annee = ?", [next, year]);
  return "CMD-" + year + "-" + String(next).padStart(3, "0");
}

async function prochainNumeroReassort(adapter, articleId) {
  const row = await adapter.get("SELECT MAX(numero_reassort) AS m FROM commandes WHERE article_id = ? AND type_production = 'reassort'", [articleId]);
  return ((row && row.m) || 0) + 1;
}

async function insertCommandeRow(adapter, params) {
  const colonnes = ["uuid", "article_id", "type_production", "numero_reassort", "reference_production",
    "responsable_nom", "atelier_id", "quantite_totale", "date_lancement", "date_fin_prevue", "etape_id", "priorite", "commentaires"];
  const valeurs = colonnes.map((c) => params[c]);
  const info = await adapter.run(
    `INSERT INTO commandes (${colonnes.join(", ")}, statut, archived, est_demo) ` +
    `VALUES (${colonnes.map(() => "?").join(", ")}, 'brouillon', 0, 0) RETURNING id`,
    valeurs
  );
  return info.lastInsertRowid;
}

async function create(adapter, payload) {
  assertValid(payload);
  assertValidLignes(payload.lignes);
  if (!payload.article_id) throw new Error("Sélectionnez un article.");

  const article = await adapter.get("SELECT * FROM articles WHERE id = ?", [Number(payload.article_id)]);
  if (!article) throw new Error("Article introuvable.");
  if (!article.reference_principale) {
    throw new Error(
      "Cet article n'a pas encore de référence principale. Complétez-la (Articles > \"Compléter et générer la référence\") avant de créer une commande."
    );
  }

  const type_production = payload.type_production === "reassort" ? "reassort" : "nouveau";
  const uuid = crypto.randomUUID();
  const baseParams = {
    uuid, article_id: article.id,
    responsable_nom: String(payload.responsable_nom || "").trim(),
    atelier_id: Number(payload.atelier_id),
    quantite_totale: sumQuantite(payload.lignes),
    date_lancement: payload.date_lancement,
    date_fin_prevue: payload.date_fin_prevue,
    etape_id: Number(payload.etape_id),
    priorite: payload.priorite || "normale",
    commentaires: payload.commentaires || null,
  };

  const commandeId = await adapter.transaction(async (tx) => {
    let commandeId;
    if (type_production === "nouveau") {
      const dejaExistant = await tx.get(
        "SELECT id FROM commandes WHERE article_id = ? AND type_production = 'nouveau' AND deleted_at IS NULL", [article.id]
      );
      if (dejaExistant) {
        throw new Error("Cet article possède déjà une première commande de production. Veuillez créer un réassort.");
      }
      commandeId = await insertCommandeRow(tx, { ...baseParams, type_production: "nouveau", numero_reassort: null, reference_production: article.reference_principale });
    } else {
      const MAX_TENTATIVES = 5;
      let derniereErreur = null;
      let inseree = false;
      for (let i = 0; i < MAX_TENTATIVES && !inseree; i++) {
        const numero_reassort = await prochainNumeroReassort(tx, article.id);
        const reference_production = article.reference_principale + "-R" + String(numero_reassort).padStart(2, "0");
        try {
          commandeId = await insertCommandeRow(tx, { ...baseParams, type_production: "reassort", numero_reassort, reference_production });
          inseree = true;
        } catch (err) {
          derniereErreur = err;
          if (!String(err.message || "").toUpperCase().includes("UNIQUE")) throw err;
        }
      }
      if (!inseree) {
        throw new Error("Impossible de générer un numéro de réassort unique après plusieurs tentatives." + (derniereErreur ? " " + derniereErreur.message : ""));
      }
    }
    await insertLignes(tx, commandeId, payload.lignes);
    return commandeId;
  });

  return get(adapter, commandeId);
}

const EDITABLE_FIELDS = [
  "article_id", "type_production", "numero_reassort", "reference_production",
  "responsable_nom", "atelier_id", "quantite_totale",
  "date_lancement", "date_fin_prevue", "etape_id", "priorite", "commentaires",
];
const CHAMPS_VERROUILLES_HORS_BROUILLON = ["article_id", "type_production", "numero_reassort", "reference_production"];

async function bcPfEncoreModifiable(adapter, commandeId) {
  const bc = await adapter.get("SELECT statut FROM bc_pf WHERE commande_id = ? ORDER BY id DESC LIMIT 1", [commandeId]);
  return !bc || bc.statut === "brouillon";
}

async function update(adapter, id, payload) {
  const current = await get(adapter, id);
  if (!current) throw new Error("Commande introuvable.");

  const patch = { ...payload };
  delete patch.photo;
  delete patch.lignes;

  if (current.statut !== "brouillon") {
    for (const champ of CHAMPS_VERROUILLES_HORS_BROUILLON) {
      if (payload[champ] !== undefined) throw new Error("Ce champ ne peut plus être modifié : la commande n'est plus en brouillon.");
    }
    if (payload.lignes !== undefined && !(await bcPfEncoreModifiable(adapter, id))) {
      throw new Error("La répartition couleurs/tailles ne peut plus être modifiée : le bon de commande associé a déjà été validé.");
    }
  }

  if (payload.lignes !== undefined) {
    assertValidLignes(payload.lignes);
    patch.quantite_totale = sumQuantite(payload.lignes);
  }

  const merged = { ...current, ...patch };
  assertValid(merged);

  const fields = Object.keys(patch).filter((k) => EDITABLE_FIELDS.includes(k));

  await adapter.transaction(async (tx) => {
    if (fields.length > 0) {
      const setClause = fields.map((f) => `${f} = ?`).join(", ");
      await tx.run(`UPDATE commandes SET ${setClause} WHERE id = ?`, [...fields.map((f) => patch[f]), id]);
    }
    if (payload.lignes !== undefined) {
      await tx.run("DELETE FROM commande_lignes WHERE commande_id = ?", [id]);
      await insertLignes(tx, id, payload.lignes);
    }
  });

  return get(adapter, id);
}

async function validerCommande(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "brouillon") throw new Error("Seule une commande en brouillon peut être validée.");
    const op = await assertOperateurActif(tx);

    const numero = await genererNumero(tx);
    await tx.run("UPDATE commandes SET statut = 'validee', numero = ?, valide_le = ?, valide_par_id = ? WHERE id = ?",
      [numero, new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "validation", op.id, null);
  });

  // Comportement de référence vérifié explicitement avant adaptation (voir en-tête de fichier) :
  // deux opérations distinctes, jamais une transaction commune. Si la création du BC PF échoue,
  // l'erreur est journalisée et ABSORBÉE — jamais relancée. La commande reste validée.
  try {
    await bcPf.creerBcPf(adapter, id);
  } catch (err) {
    console.error("Création automatique du BC PF impossible (la commande reste validée) :", err.message);
  }
  return get(adapter, id);
}

async function lancerProduction(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "validee") throw new Error("Seule une commande validée peut être lancée en production.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET statut = 'en_production', lance_le = ?, lance_par_id = ? WHERE id = ?", [new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "lancement", op.id, null);
  });
  return get(adapter, id);
}

async function entrerEnControleQualite(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "en_production") throw new Error("Seule une commande en production peut entrer en contrôle qualité.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET statut = 'controle_qualite', controle_qualite_le = ?, controle_qualite_par_id = ? WHERE id = ?", [new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "entree_controle_qualite", op.id, null);
  });
  return get(adapter, id);
}

async function terminerProduction(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "controle_qualite") throw new Error("Seule une commande en contrôle qualité peut être terminée.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET statut = 'terminee', terminee_le = ?, terminee_par_id = ? WHERE id = ?", [new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "fin_production", op.id, null);
  });
  return get(adapter, id);
}

async function annulerCommande(adapter, id, motif) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!STATUTS_ANNULABLES.includes(cmd.statut)) throw new Error("Cette commande ne peut pas être annulée depuis son statut actuel.");
    if (!motif || !motif.trim()) throw new Error("Le motif d'annulation est obligatoire.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET statut = 'annulee', annulee_le = ?, annulee_par_id = ?, annulation_motif = ? WHERE id = ?", [new Date().toISOString(), op.id, motif.trim(), id]);
    await enregistrerHistorique(tx, id, "annulation", op.id, motif.trim());
  });
  return get(adapter, id);
}

async function bloquer(adapter, id, motif) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!STATUTS_BLOCABLES.includes(cmd.statut)) throw new Error("Le blocage n'est disponible que pour une commande validée, en production ou en contrôle qualité.");
    if (cmd.bloquee) throw new Error("Cette commande est déjà bloquée.");
    if (!motif || !motif.trim()) throw new Error("Le motif de blocage est obligatoire.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET bloquee = 1, blocage_motif = ?, bloquee_le = ?, bloquee_par_id = ? WHERE id = ?", [motif.trim(), new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "blocage", op.id, motif.trim());
  });
  return get(adapter, id);
}

async function debloquer(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!cmd.bloquee) throw new Error("Cette commande n'est pas bloquée.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET bloquee = 0, debloquee_le = ?, debloquee_par_id = ? WHERE id = ?", [new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "deblocage", op.id, null);
  });
  return get(adapter, id);
}

async function archiver(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!["terminee", "annulee"].includes(cmd.statut)) throw new Error("Seule une commande terminée ou annulée peut être archivée.");
    if (cmd.archived) throw new Error("Cette commande est déjà archivée.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET archived = 1, archived_le = ?, archived_par_id = ? WHERE id = ?", [new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "archivage", op.id, null);
  });
  return get(adapter, id);
}

async function desarchiver(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!cmd.archived) throw new Error("Cette commande n'est pas archivée.");
    const op = await assertOperateurActif(tx);
    await tx.run("UPDATE commandes SET archived = 0, desarchive_le = ?, desarchive_par_id = ? WHERE id = ?", [new Date().toISOString(), op.id, id]);
    await enregistrerHistorique(tx, id, "desarchivage", op.id, null);
  });
  return get(adapter, id);
}

async function remove(adapter, id) {
  await adapter.transaction(async (tx) => {
    const cmd = await tx.get("SELECT statut FROM commandes WHERE id = ?", [id]);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "brouillon") {
      throw new Error("Seule une commande en brouillon peut être supprimée définitivement. Utilisez \"Annuler\" pour les autres statuts.");
    }
    await tx.run("DELETE FROM commandes WHERE id = ?", [id]);
  });
  return { id, deleted: true };
}

module.exports = {
  list, get, create, update, remove,
  validerCommande, lancerProduction, entrerEnControleQualite, terminerProduction,
  annulerCommande, bloquer, debloquer, archiver, desarchiver, getOperateurActif,
};
