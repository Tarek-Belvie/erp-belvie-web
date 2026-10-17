const crypto = require("crypto");
const bcPf = require("./bcPf");

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

// Verifie que chaque identifiant transmis EXISTE reellement dans sa table de reference.
// assertValidLignes ne controlait que le TYPE (un entier), pas l'existence : un identifiant
// valide mais pris dans une autre table passait donc la validation et echouait ensuite en
// « FOREIGN KEY constraint failed », sans que rien ne designe la ligne ni la colonne fautive.
// C'est exactement le defaut deja rencontre sur ft_tailles.grille_valeur_id.
function assertReferencesLignes(db, lignes) {
  lignes.forEach((l, i) => {
    const rang = i + 1;
    const couleurId = Number(l.couleur_id);
    const couleur = db.prepare("SELECT id, type, nom FROM listes_valeurs WHERE id = ?").get(couleurId);
    if (!couleur) {
      // L'identifiant n'existe nulle part dans listes_valeurs : il vient probablement d'un autre
      // referentiel. On le dit explicitement plutot que de laisser SQLite refuser sans motif.
      const ailleurs = [];
      [["declinaison_valeurs", "ancien systeme de declinaisons"], ["grilles_tailles_valeurs", "valeurs de grille de tailles"]]
        .forEach(([table, libelle]) => {
          try {
            const r = db.prepare("SELECT 1 AS x FROM " + table + " WHERE id = ?").get(couleurId);
            if (r) ailleurs.push(libelle);
          } catch (e) { /* table absente */ }
        });
      throw new Error(
        "Ligne " + rang + " de la répartition : la couleur " + couleurId + " n'existe pas dans le référentiel des couleurs" +
        (ailleurs.length ? " (cet identifiant correspond à : " + ailleurs.join(", ") + ")" : "") +
        ". Vérifiez les couleurs disponibles dans Paramètres."
      );
    }
    if (couleur.type !== "couleur") {
      throw new Error(
        "Ligne " + rang + " de la répartition : « " + couleur.nom + " » est une valeur de type « " +
        couleur.type + " », pas une couleur."
      );
    }
    if (l.taille_id) {
      const t = db.prepare("SELECT id FROM grilles_tailles_valeurs WHERE id = ?").get(Number(l.taille_id));
      if (!t) {
        throw new Error("Ligne " + rang + " de la répartition : la taille " + l.taille_id + " n'existe dans aucune grille.");
      }
    }
  });
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
  return lignes.reduce(function (sum, l) { return sum + Number(l.quantite); }, 0);
}

function insertLignes(db, commandeId, lignes) {
  // taille_nom est figé DÈS la création : le libellé affiché ne dépend plus jamais
  // de l'état ultérieur de la grille (valeur renommée, désactivée, retirée). Sans
  // cela, la colonne reste NULL et le filet de sécurité historique est vide.
  assertReferencesLignes(db, lignes);
  const insertLigne = db.prepare(
    "INSERT INTO commande_lignes (commande_id, couleur_id, reference_libre, taille_id, taille_nom, quantite) " +
    "VALUES (?, ?, ?, ?, (SELECT valeur FROM grilles_tailles_valeurs WHERE id = ?), ?)"
  );
  for (const l of lignes) {
    const ref = l.reference_libre != null ? String(l.reference_libre).trim() || null : null;
    const tailleId = l.taille_id ? Number(l.taille_id) : null;
    insertLigne.run(commandeId, Number(l.couleur_id), ref, tailleId, tailleId, Number(l.quantite));
  }
}

function fetchLignes(db, commandeId) {
  // Taille lue depuis grilles_tailles_valeurs (référentiel unique depuis la
  // réparation taille_id). COALESCE sur taille_nom : une valeur retirée de sa
  // grille conserve son libellé historique à l'écran.
  return db.prepare(
    "SELECT cl.id, cl.couleur_id, co.nom AS couleur, cl.reference_libre AS couleur_reference, cl.taille_id, " +
    "COALESCE(t.valeur, cl.taille_nom) AS taille, t.ordre AS taille_ordre, cl.quantite " +
    "FROM commande_lignes cl " +
    "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
    "LEFT JOIN grilles_tailles_valeurs t ON t.id = cl.taille_id " +
    "WHERE cl.commande_id = ? " +
    "ORDER BY co.nom COLLATE NOCASE ASC, t.ordre ASC"
  ).all(commandeId);
}

function fetchHistorique(db, commandeId) {
  return db.prepare(
    "SELECT id, type_evenement, operateur_id, motif, survenu_le " +
    "FROM historique_transitions WHERE commande_id = ? ORDER BY survenu_le ASC, id ASC"
  ).all(commandeId);
}

function list(db) {
  return db.prepare(SELECT_BASE + "ORDER BY c.date_fin_prevue ASC").all();
}

function get(db, id) {
  const cmd = db.prepare(SELECT_BASE + "AND c.id = ?").get(id);
  if (!cmd) return cmd;
  cmd.lignes = fetchLignes(db, id);
  cmd.historique = fetchHistorique(db, id);
  return cmd;
}

function getOperateurActif(db) {
  const row = db.prepare("SELECT valeur FROM parametres WHERE cle = 'operateur_actif_id'").get();
  if (!row || !row.valeur) return null;
  return db.prepare("SELECT * FROM listes_valeurs WHERE id = ? AND type = 'operateur' AND actif = 1").get(Number(row.valeur)) || null;
}

function assertOperateurActif(db) {
  const op = getOperateurActif(db);
  if (!op) {
    throw new Error("Aucun opérateur actif n'est sélectionné. Choisissez-en un dans Paramètres avant de continuer.");
  }
  return op;
}

function enregistrerHistorique(db, commandeId, typeEvenement, operateurId, motif) {
  db.prepare(
    "INSERT INTO historique_transitions (commande_id, type_evenement, operateur_id, motif) VALUES (?, ?, ?, ?)"
  ).run(commandeId, typeEvenement, operateurId, motif || null);
}

function genererNumero(db) {
  const year = new Date().getFullYear();
  const row = db.prepare("SELECT dernier_numero FROM compteurs WHERE annee = ?").get(year);
  let next = row ? row.dernier_numero + 1 : 1;
  const exists = db.prepare("SELECT 1 FROM commandes WHERE numero = ?");
  while (exists.get("CMD-" + year + "-" + String(next).padStart(3, "0"))) next += 1;
  if (!row) db.prepare("INSERT INTO compteurs (annee, dernier_numero) VALUES (?, ?)").run(year, next);
  else db.prepare("UPDATE compteurs SET dernier_numero = ? WHERE annee = ?").run(next, year);
  return "CMD-" + year + "-" + String(next).padStart(3, "0");
}

function prochainNumeroReassort(db, articleId) {
  const row = db.prepare(
    "SELECT MAX(numero_reassort) AS m FROM commandes WHERE article_id = ? AND type_production = 'reassort'"
  ).get(articleId);
  return (row.m || 0) + 1;
}

// Verifie les cles etrangeres de la commande elle-meme AVANT l'insertion. insertCommandeRow
// s'execute avant insertLignes : une cle fautive ici echouait donc sans jamais atteindre le
// controle des lignes, et sans que rien ne designe la colonne responsable.
function assertReferencesCommande(db, params) {
  const article = db.prepare("SELECT id FROM articles WHERE id = ?").get(Number(params.article_id));
  if (!article) throw new Error("Article " + params.article_id + " introuvable.");

  const atelier = db.prepare("SELECT id, type, nom FROM listes_valeurs WHERE id = ?").get(Number(params.atelier_id));
  if (!atelier) {
    throw new Error("[LOT-CMD] Atelier " + params.atelier_id + " introuvable dans le référentiel. Vérifiez les ateliers dans Paramètres.");
  }
  if (atelier.type !== "atelier") {
    throw new Error("[LOT-CMD] « " + atelier.nom + " » est une valeur de type « " + atelier.type + " », pas un atelier.");
  }

  const etape = db.prepare("SELECT id FROM etapes WHERE id = ?").get(Number(params.etape_id));
  if (!etape) {
    throw new Error("[LOT-CMD] Étape de production " + params.etape_id + " introuvable. Vérifiez les étapes dans Paramètres.");
  }
  return true;
}

function insertCommandeRow(db, params) {
  assertReferencesCommande(db, params);
  const info = db.prepare(
    "INSERT INTO commandes " +
    "(uuid, article_id, type_production, numero_reassort, reference_production, " +
    " responsable_nom, atelier_id, quantite_totale, date_lancement, date_fin_prevue, etape_id, " +
    " statut, priorite, commentaires, archived, est_demo) " +
    "VALUES " +
    "(@uuid, @article_id, @type_production, @numero_reassort, @reference_production, " +
    " @responsable_nom, @atelier_id, @quantite_totale, @date_lancement, @date_fin_prevue, @etape_id, " +
    " 'brouillon', @priorite, @commentaires, 0, 0)"
  ).run(params);
  return info.lastInsertRowid;
}

async function create(db, payload) {
  assertValid(payload);
  assertValidLignes(payload.lignes);
  if (!payload.article_id) throw new Error("Sélectionnez un article.");

  const article = db.prepare("SELECT * FROM articles WHERE id = ?").get(Number(payload.article_id));
  if (!article) throw new Error("Article introuvable.");
  if (!article.reference_principale) {
    throw new Error(
      "Cet article n'a pas encore de référence principale. Complétez-la (Articles > \"Compléter et générer la référence\") avant de créer une commande."
    );
  }

  const type_production = payload.type_production === "reassort" ? "reassort" : "nouveau";
  const uuid = crypto.randomUUID();
  const baseParams = {
    uuid: uuid,
    article_id: article.id,
    responsable_nom: String(payload.responsable_nom || "").trim(),
    atelier_id: Number(payload.atelier_id),
    quantite_totale: sumQuantite(payload.lignes),
    date_lancement: payload.date_lancement,
    date_fin_prevue: payload.date_fin_prevue,
    etape_id: Number(payload.etape_id),
    priorite: payload.priorite || "normale",
    commentaires: payload.commentaires || null,
  };

  let commandeId;
  const tx = db.transaction(function () {
    if (type_production === "nouveau") {
      const dejaExistant = db.prepare(
        "SELECT id FROM commandes WHERE article_id = ? AND type_production = 'nouveau' AND deleted_at IS NULL"
      ).get(article.id);
      if (dejaExistant) {
        throw new Error(
          "Cet article possède déjà une première commande de production. Veuillez créer un réassort."
        );
      }
      commandeId = insertCommandeRow(db, Object.assign({}, baseParams, {
        type_production: "nouveau", numero_reassort: null, reference_production: article.reference_principale,
      }));
    } else {
      const MAX_TENTATIVES = 5;
      let derniereErreur = null;
      let inseree = false;
      for (let i = 0; i < MAX_TENTATIVES && !inseree; i++) {
        const numero_reassort = prochainNumeroReassort(db, article.id);
        const reference_production = article.reference_principale + "-R" + String(numero_reassort).padStart(2, "0");
        try {
          commandeId = insertCommandeRow(db, Object.assign({}, baseParams, {
            type_production: "reassort", numero_reassort: numero_reassort, reference_production: reference_production,
          }));
          inseree = true;
        } catch (err) {
          derniereErreur = err;
          if (!String(err.message || "").toUpperCase().includes("UNIQUE")) throw err;
        }
      }
      if (!inseree) {
        throw new Error(
          "Impossible de générer un numéro de réassort unique après plusieurs tentatives." +
          (derniereErreur ? " " + derniereErreur.message : "")
        );
      }
    }
    insertLignes(db, commandeId, payload.lignes);
  });
  tx();

  return get(db, commandeId);
}

const EDITABLE_FIELDS = [
  "article_id", "type_production", "numero_reassort", "reference_production",
  "responsable_nom", "atelier_id", "quantite_totale",
  "date_lancement", "date_fin_prevue", "etape_id", "priorite", "commentaires",
];
const CHAMPS_VERROUILLES_HORS_BROUILLON = ["article_id", "type_production", "numero_reassort", "reference_production"];

// La répartition couleurs/tailles reste modifiable tant que le BC PF associé n'est pas encore
// validé — même si la commande elle-même a déjà été validée. Rien n'est réellement "engagé"
// auprès de l'atelier tant que ce document n'est pas validé. L'article et le type de production
// restent en revanche verrouillés dès que la commande n'est plus en brouillon, quel que soit le
// statut du BC : les modifier déclenche une recréation de la commande (voir CommandeWizard),
// une opération sûre uniquement sur un authentique brouillon.
function bcPfEncoreModifiable(db, commandeId) {
  const bc = db.prepare("SELECT statut FROM bc_pf WHERE commande_id = ? ORDER BY id DESC LIMIT 1").get(commandeId);
  return !bc || bc.statut === "brouillon";
}

async function update(db, id, payload) {
  const current = get(db, id);
  if (!current) throw new Error("Commande introuvable.");

  const patch = Object.assign({}, payload);
  delete patch.photo;
  delete patch.lignes;

  if (current.statut !== "brouillon") {
    for (const champ of CHAMPS_VERROUILLES_HORS_BROUILLON) {
      if (payload[champ] !== undefined) {
        throw new Error("Ce champ ne peut plus être modifié : la commande n'est plus en brouillon.");
      }
    }
    if (payload.lignes !== undefined && !bcPfEncoreModifiable(db, id)) {
      throw new Error("La répartition couleurs/tailles ne peut plus être modifiée : le bon de commande associé a déjà été validé.");
    }
  }

  if (payload.lignes !== undefined) {
    assertValidLignes(payload.lignes);
    patch.quantite_totale = sumQuantite(payload.lignes);
  }

  const merged = Object.assign({}, current, patch);
  assertValid(merged);

  const fields = Object.keys(patch).filter(function (k) { return EDITABLE_FIELDS.includes(k); });

  const tx = db.transaction(function () {
    if (fields.length > 0) {
      const setClause = fields.map(function (f) { return f + " = @" + f; }).join(", ");
      db.prepare("UPDATE commandes SET " + setClause + " WHERE id = @id").run(Object.assign({}, patch, { id: id }));
    }
    if (payload.lignes !== undefined) {
      db.prepare("DELETE FROM commande_lignes WHERE commande_id = ?").run(id);
      insertLignes(db, id, payload.lignes);
    }
  });
  tx();

  return get(db, id);
}

function validerCommande(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "brouillon") throw new Error("Seule une commande en brouillon peut être validée.");
    const op = assertOperateurActif(db);

    const numero = genererNumero(db);
    db.prepare(
      "UPDATE commandes SET statut = 'validee', numero = ?, valide_le = datetime('now'), valide_par_id = ? WHERE id = ?"
    ).run(numero, op.id, id);
    enregistrerHistorique(db, id, "validation", op.id, null);
  });
  tx();

  // La création du BC PF est désormais entièrement autonome (snapshots article + entreprise +
  // logo, sa propre transaction, son propre nettoyage en cas d'échec — voir bcPf.js). Si elle
  // échoue malgré tout, la commande reste validée : l'action "Créer un bon de commande",
  // disponible depuis la fiche, permet de rattraper la situation sans rien perdre.
  try {
    bcPf.creerBcPf(db, id);
  } catch (err) {
    console.error("Création automatique du BC PF impossible (la commande reste validée) :", err);
  }
  return get(db, id);
}

function lancerProduction(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "validee") throw new Error("Seule une commande validée peut être lancée en production.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET statut = 'en_production', lance_le = datetime('now'), lance_par_id = ? WHERE id = ?"
    ).run(op.id, id);
    enregistrerHistorique(db, id, "lancement", op.id, null);
  });
  tx();
  return get(db, id);
}

function entrerEnControleQualite(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "en_production") throw new Error("Seule une commande en production peut entrer en contrôle qualité.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET statut = 'controle_qualite', controle_qualite_le = datetime('now'), controle_qualite_par_id = ? WHERE id = ?"
    ).run(op.id, id);
    enregistrerHistorique(db, id, "entree_controle_qualite", op.id, null);
  });
  tx();
  return get(db, id);
}

function terminerProduction(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "controle_qualite") throw new Error("Seule une commande en contrôle qualité peut être terminée.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET statut = 'terminee', terminee_le = datetime('now'), terminee_par_id = ? WHERE id = ?"
    ).run(op.id, id);
    enregistrerHistorique(db, id, "fin_production", op.id, null);
  });
  tx();
  return get(db, id);
}

function annulerCommande(db, id, motif) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!STATUTS_ANNULABLES.includes(cmd.statut)) {
      throw new Error("Cette commande ne peut pas être annulée depuis son statut actuel.");
    }
    if (!motif || !motif.trim()) throw new Error("Le motif d'annulation est obligatoire.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET statut = 'annulee', annulee_le = datetime('now'), annulee_par_id = ?, annulation_motif = ? WHERE id = ?"
    ).run(op.id, motif.trim(), id);
    enregistrerHistorique(db, id, "annulation", op.id, motif.trim());
  });
  tx();
  return get(db, id);
}

function bloquer(db, id, motif) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!STATUTS_BLOCABLES.includes(cmd.statut)) {
      throw new Error("Le blocage n'est disponible que pour une commande validée, en production ou en contrôle qualité.");
    }
    if (cmd.bloquee) throw new Error("Cette commande est déjà bloquée.");
    if (!motif || !motif.trim()) throw new Error("Le motif de blocage est obligatoire.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET bloquee = 1, blocage_motif = ?, bloquee_le = datetime('now'), bloquee_par_id = ? WHERE id = ?"
    ).run(motif.trim(), op.id, id);
    enregistrerHistorique(db, id, "blocage", op.id, motif.trim());
  });
  tx();
  return get(db, id);
}

function debloquer(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!cmd.bloquee) throw new Error("Cette commande n'est pas bloquée.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET bloquee = 0, debloquee_le = datetime('now'), debloquee_par_id = ? WHERE id = ?"
    ).run(op.id, id);
    enregistrerHistorique(db, id, "deblocage", op.id, null);
  });
  tx();
  return get(db, id);
}

function archiver(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!["terminee", "annulee"].includes(cmd.statut)) {
      throw new Error("Seule une commande terminée ou annulée peut être archivée.");
    }
    if (cmd.archived) throw new Error("Cette commande est déjà archivée.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET archived = 1, archived_le = datetime('now'), archived_par_id = ? WHERE id = ?"
    ).run(op.id, id);
    enregistrerHistorique(db, id, "archivage", op.id, null);
  });
  tx();
  return get(db, id);
}

function desarchiver(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT * FROM commandes WHERE id = ? AND deleted_at IS NULL").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (!cmd.archived) throw new Error("Cette commande n'est pas archivée.");
    const op = assertOperateurActif(db);

    db.prepare(
      "UPDATE commandes SET archived = 0, desarchive_le = datetime('now'), desarchive_par_id = ? WHERE id = ?"
    ).run(op.id, id);
    enregistrerHistorique(db, id, "desarchivage", op.id, null);
  });
  tx();
  return get(db, id);
}

function remove(db, id) {
  const tx = db.transaction(function () {
    const cmd = db.prepare("SELECT statut FROM commandes WHERE id = ?").get(id);
    if (!cmd) throw new Error("Commande introuvable.");
    if (cmd.statut !== "brouillon") {
      throw new Error(
        "Seule une commande en brouillon peut être supprimée définitivement. Utilisez \"Annuler\" pour les autres statuts."
      );
    }
    db.prepare("DELETE FROM commandes WHERE id = ?").run(id);
  });
  tx();
  return { id: id, deleted: true };
}

// ================================================================================================
// BESOINS MATIÈRES
// ================================================================================================
// Projection en LECTURE SEULE : rien n'est stocké, aucune table, aucune écriture.
//
// Le besoin dépend de deux sources qui évoluent indépendamment — les quantités de la commande et
// la recette de la fiche technique. Le figer créerait une seconde vérité qui divergerait au
// premier ajustement. Et ce ne serait même pas prudent : commandes.js autorise explicitement la
// modification de la répartition couleurs/tailles APRÈS validation de la commande, tant que le
// BC PF n'est pas validé (voir bcPfEncoreModifiable). Un snapshot pris à la validation serait
// donc faux dès la première retouche.
// Ce qui doit être figé, c'est l'ENGAGEMENT d'achat — et il l'est déjà, dans achats et
// achats_affectations, qui portent des quantités réelles. Le besoin reste une projection.
//
// Aucun filtre sur fiches_techniques.statut : UNIQUE(article_id) signifie qu'il n'existe qu'UNE
// fiche par article, tous statuts confondus — il n'y a donc pas de "version validée" à côté d'une
// version brouillon, c'est la même ligne. Exiger 'validee' ne protégerait de rien et empêcherait
// d'anticiper les achats pendant la mise au point de la fiche, c'est-à-dire au moment où on en a
// le plus besoin. Le statut est renvoyé comme information, jamais comme condition.
// (Le jour où les révisions multiples existeront, la règle deviendra "la révision en vigueur à la
// date de lancement" — une vraie règle, qui demandera de relâcher la contrainte UNIQUE.)
//
// Cette version couvre le mode 'moyenne' uniquement. Le mode 'par_taille' est préparé en base
// (ft_matiere_consommations_taille) mais reste subordonné à la correction du référentiel de
// ft_tailles : les tailles de la fiche et celles de commande_lignes ne pointent pas aujourd'hui
// le même référentiel, les rapprocher produirait des résultats faux.

function besoinsMatieres(db, commandeId) {
  const commande = db.prepare(
    "SELECT id, article_id, numero, statut FROM commandes WHERE id = ? AND deleted_at IS NULL"
  ).get(commandeId);
  if (!commande) throw new Error("Commande introuvable.");

  const fiche = db.prepare(
    "SELECT id, statut FROM fiches_techniques WHERE article_id = ?"
  ).get(commande.article_id);

  const vide = {
    commande_id: commandeId,
    fiche_id: null,
    fiche_statut: null,
    matieres: [],
    couleurs_sans_correspondance: [],
    total_general: null,
  };
  if (!fiche) return vide;

  const matieres = db.prepare(
    "SELECT id, nom, utilisation, unite, consommation_technique, perte_pourcent, mode_consommation, ordre " +
    "FROM ft_matieres WHERE fiche_id = ? ORDER BY ordre, id"
  ).all(fiche.id);
  if (matieres.length === 0) {
    return Object.assign({}, vide, { fiche_id: fiche.id, fiche_statut: fiche.statut });
  }

  // Quantités réellement commandées, par couleur. Le mode 'moyenne' agrège toutes les tailles :
  // les lignes sans taille (commandes migrées depuis l'ancien modèle) sont donc comptées
  // normalement, sans traitement particulier.
  const quantites = db.prepare(
    "SELECT cl.couleur_id, lv.nom AS couleur_nom, SUM(cl.quantite) AS pieces " +
    "FROM commande_lignes cl JOIN listes_valeurs lv ON lv.id = cl.couleur_id " +
    "WHERE cl.commande_id = ? GROUP BY cl.couleur_id ORDER BY lv.nom COLLATE NOCASE ASC"
  ).all(commandeId);
  const parCouleur = new Map(quantites.map((q) => [q.couleur_id, q]));

  const correspondances = db.prepare(
    "SELECT fmc.ft_matiere_id, fmc.couleur_produit_id, lv.nom AS couleur_nom, " +
    "mcol.libelle AS coloris_matiere, mcol.code AS coloris_code, mcol.reference AS coloris_reference " +
    "FROM ft_matiere_couleurs fmc " +
    "JOIN listes_valeurs lv ON lv.id = fmc.couleur_produit_id " +
    "LEFT JOIN matiere_couleurs mcol ON mcol.id = fmc.matiere_couleur_id " +
    "WHERE fmc.ft_matiere_id = ? ORDER BY lv.nom COLLATE NOCASE ASC"
  );

  // Une couleur COMMANDÉE sans correspondance dans la fiche est une anomalie : son besoin est
  // incalculable, donc la matière correspondante risque de ne jamais être achetée. L'inverse —
  // une couleur prévue dans la fiche mais non commandée — est normal : besoin nul, aucune alerte.
  const couvertes = new Set();
  let totalGeneral = 0;
  let auMoinsUnChiffre = false;

  const resultat = matieres.map((m) => {
    const lignes = [];
    let totalMatiere = 0;
    let quantifiable = m.consommation_technique != null;

    // Valeur non arrondie, conservée telle quelle : l'arrondi est fait à l'affichage uniquement.
    // Arrondir chaque ligne avant de sommer ferait diverger le total de la somme affichée.
    const budgetee = quantifiable
      ? m.consommation_technique * (1 + (m.perte_pourcent || 0) / 100)
      : null;

    for (const c of correspondances.all(m.id)) {
      const q = parCouleur.get(c.couleur_produit_id);
      if (q) couvertes.add(c.couleur_produit_id);
      const pieces = q ? q.pieces : 0;
      const besoin = budgetee != null ? pieces * budgetee : null;
      if (besoin != null) totalMatiere += besoin;
      lignes.push({
        couleur_produit_id: c.couleur_produit_id,
        couleur_nom: c.couleur_nom,
        coloris_matiere: c.coloris_matiere,
        coloris_code: c.coloris_code,
        coloris_reference: c.coloris_reference,
        pieces: pieces,
        commandee: !!q,
        besoin: besoin,
      });
    }

    if (quantifiable) { totalGeneral += totalMatiere; auMoinsUnChiffre = true; }
    return {
      ft_matiere_id: m.id,
      nom: m.nom,
      utilisation: m.utilisation,
      unite: m.unite,
      mode_consommation: m.mode_consommation,
      consommation_technique: m.consommation_technique,
      perte_pourcent: m.perte_pourcent,
      consommation_budgetee: budgetee,
      lignes: lignes,
      total: quantifiable ? totalMatiere : null,
      // Sans consommation technique saisie, la matière est listée mais non chiffrable.
      incomplete: !quantifiable,
    };
  });

  const sansCorrespondance = quantites
    .filter((q) => !couvertes.has(q.couleur_id))
    .map((q) => ({ couleur_id: q.couleur_id, couleur_nom: q.couleur_nom, pieces: q.pieces }));

  return {
    commande_id: commandeId,
    fiche_id: fiche.id,
    fiche_statut: fiche.statut,
    matieres: resultat,
    couleurs_sans_correspondance: sansCorrespondance,
    // Le total général n'a de sens que si les matières partagent la même unité ; l'interface ne
    // l'affiche donc pas globalement, elle affiche un total PAR matière avec son unité.
    total_general: auMoinsUnChiffre ? totalGeneral : null,
  };
}

module.exports = {
  list: list,
  get: get,
  create: create,
  update: update,
  remove: remove,
  besoinsMatieres: besoinsMatieres,
  validerCommande: validerCommande,
  lancerProduction: lancerProduction,
  entrerEnControleQualite: entrerEnControleQualite,
  terminerProduction: terminerProduction,
  annulerCommande: annulerCommande,
  bloquer: bloquer,
  debloquer: debloquer,
  archiver: archiver,
  desarchiver: desarchiver,
  getOperateurActif: getOperateurActif,
};
