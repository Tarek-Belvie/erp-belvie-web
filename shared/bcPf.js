// ============================================================================
// LOGIQUE MÉTIER PARTAGÉE — bc_pf (Bon de Commande Produits Finis).
//
// Adaptée de electron/ipc/bcPf.js pour la Phase 1 (Lot 3 — Commandes).
// bcPfPdf.js (génération PDF, 100% Electron) N'EST PAS concerné ici.
//
// EXCLU, volontairement (fichier physique, bloqué tant que Cloudflare R2
// n'est pas configuré) :
//   - photos.snapshotArticlePhoto() / removeSnapshotFile() : le snapshot de
//     la photo article et du logo entreprise. photoSnapshotPath et
//     entrepriseSnap.logoSnapshotPath valent toujours null ici — le reste
//     du document (toutes les données texte) est créé normalement.
//
// datetime('now') (nombreuses occurrences) remplacé par un horodatage
// JavaScript passé en paramètre. db.transaction() remplacé par
// adapter.transaction(). Détection "UNIQUE" déjà prouvée portable (Lot 1),
// réutilisée telle quelle.
//
// electron/ipc/bcPf.js n'est PAS modifié.
// ============================================================================

const crypto = require("crypto");
const { lireInfosEntrepriseSnapshot } = require("./parametres-bridge");

async function genererNumeroBcPf(adapter) {
  const year = new Date().getFullYear();
  const row = await adapter.get("SELECT dernier_numero FROM compteurs_bc_pf WHERE annee = ?", [year]);
  let next = row ? row.dernier_numero + 1 : 1;
  while (await adapter.get("SELECT 1 AS x FROM bc_pf WHERE numero = ?", ["PF-" + year + "-" + String(next).padStart(4, "0")])) next += 1;
  if (!row) await adapter.run("INSERT INTO compteurs_bc_pf (annee, dernier_numero) VALUES (?, ?)", [year, next]);
  else await adapter.run("UPDATE compteurs_bc_pf SET dernier_numero = ? WHERE annee = ?", [next, year]);
  return "PF-" + year + "-" + String(next).padStart(4, "0");
}

async function fetchSnapshotSource(adapter, commandeId) {
  return adapter.get(
    "SELECT c.id, c.numero, c.statut, c.type_production, c.atelier_id, c.priorite, c.date_fin_prevue, c.commentaires, c.responsable_nom, " +
    "ar.reference_principale AS article_reference_principale, p.nom AS produit, " +
    "s.nom AS saison, a.nom AS atelier, " +
    "(SELECT photo_path FROM article_photos WHERE article_id = ar.id AND est_principale = 1 LIMIT 1) AS photo_path " +
    "FROM commandes c " +
    "LEFT JOIN articles ar ON ar.id = c.article_id " +
    "LEFT JOIN listes_valeurs p ON p.id = ar.produit_id " +
    "LEFT JOIN listes_valeurs s ON s.id = ar.saison_id " +
    "LEFT JOIN listes_valeurs a ON a.id = c.atelier_id " +
    "WHERE c.id = ? AND c.deleted_at IS NULL",
    [commandeId]
  );
}

async function fetchCommandeLignesNoms(adapter, commandeId) {
  // Alimente le taille_nom FIGÉ des lignes de BC PF : une erreur ici se grave
  // définitivement dans un document officiel. Lecture depuis la grille, avec
  // repli sur le libellé déjà figé de la ligne de commande.
  return adapter.all(
    "SELECT co.nom AS couleur_nom, cl.reference_libre AS couleur_reference, " +
    "COALESCE(ta.valeur, cl.taille_nom) AS taille_nom, cl.quantite " +
    "FROM commande_lignes cl " +
    "JOIN listes_valeurs co ON co.id = cl.couleur_id " +
    "LEFT JOIN grilles_tailles_valeurs ta ON ta.id = cl.taille_id " +
    "WHERE cl.commande_id = ?",
    [commandeId]
  );
}

const STATUTS_AVEC_BC_POSSIBLE = ["validee", "en_production", "controle_qualite", "terminee", "annulee"];

function assertCommandeEligible(source) {
  if (!source) throw new Error("Commande introuvable.");
  if (STATUTS_AVEC_BC_POSSIBLE.indexOf(source.statut) === -1) {
    throw new Error("Seule une commande validée (ou à une étape ultérieure) peut avoir un bon de commande.");
  }
}

async function insertDocument(adapter, numero, commandeId, source, photoSnapshotPath, entrepriseSnap, extra) {
  const lignes = await fetchCommandeLignesNoms(adapter, source.id);
  const uuid = crypto.randomUUID();

  const champs = {
    uuid, numero, commande_id: commandeId, atelier_id: source.atelier_id,
    remplace_bc_pf_id: (extra && extra.remplace_bc_pf_id) || null,
    motif_remplacement: (extra && extra.motif_remplacement) || null,
    commande_numero: source.numero, article_nom: source.produit, article_reference: source.article_reference_principale,
    type_production: source.type_production, atelier_nom: source.atelier, saison_nom: source.saison,
    responsable_nom: source.responsable_nom, date_limite_production: source.date_fin_prevue, priorite: source.priorite,
    photo_snapshot_path: photoSnapshotPath,
    entreprise_logo_snapshot_path: entrepriseSnap.logoSnapshotPath,
    notes_atelier: (extra && extra.notes_atelier) || source.commentaires || null,
    observations_internes: (extra && extra.observations_internes) || null,
    ...entrepriseSnap.fields,
  };

  const colonnes = [
    "uuid", "numero", "commande_id", "atelier_id", "statut", "remplace_bc_pf_id", "motif_remplacement",
    "commande_numero", "article_nom", "article_reference", "type_production", "atelier_nom", "saison_nom", "responsable_nom",
    "date_limite_production", "priorite", "photo_snapshot_path",
    "entreprise_nom_commercial", "entreprise_raison_sociale", "entreprise_matricule_fiscal", "entreprise_registre_commerce",
    "entreprise_adresse", "entreprise_telephone", "entreprise_email", "entreprise_banque", "entreprise_agence_bancaire",
    "entreprise_rib", "entreprise_logo_snapshot_path", "notes_atelier", "observations_internes", "commande_synced_at",
  ];
  const valeurs = colonnes.map((c) => (c === "statut" ? "brouillon" : c === "commande_synced_at" ? new Date().toISOString() : champs[c] ?? null));
  const placeholders = colonnes.map(() => "?").join(", ");
  const info = await adapter.run(`INSERT INTO bc_pf (${colonnes.join(", ")}) VALUES (${placeholders}) RETURNING id`, valeurs);

  for (const l of lignes) {
    await adapter.run("INSERT INTO bc_pf_lignes (bc_pf_id, couleur_nom, couleur_reference, taille_nom, quantite) VALUES (?, ?, ?, ?, ?)",
      [info.lastInsertRowid, l.couleur_nom, l.couleur_reference, l.taille_nom, l.quantite]);
  }
  return info.lastInsertRowid;
}

// La photo/le logo ne sont jamais capturés ici (voir en-tête de fichier) — photoSnapshotPath et
// entrepriseSnap.logoSnapshotPath valent toujours null, le reste du document se crée normalement.
async function creerBcPf(adapter, commandeId) {
  const source = await fetchSnapshotSource(adapter, commandeId);
  assertCommandeEligible(source);

  const existing = await adapter.get(
    "SELECT id FROM bc_pf WHERE commande_id = ? AND atelier_id = ? AND statut NOT IN ('remplace','annule')",
    [commandeId, source.atelier_id]
  );
  if (existing) throw new Error("Un bon de commande PF existe déjà pour cette commande et cet atelier.");

  const photoSnapshotPath = null;
  const entrepriseSnap = await lireInfosEntrepriseSnapshot(adapter);

  const numero = await genererNumeroBcPf(adapter);
  const bcId = await adapter.transaction(async (tx) => {
    const stillNone = await tx.get(
      "SELECT id FROM bc_pf WHERE commande_id = ? AND atelier_id = ? AND statut NOT IN ('remplace','annule')",
      [commandeId, source.atelier_id]
    );
    if (stillNone) throw new Error("Un bon de commande PF existe déjà pour cette commande et cet atelier.");
    return insertDocument(tx, numero, commandeId, source, photoSnapshotPath, entrepriseSnap, null);
  });
  return get(adapter, bcId);
}

async function getByCommandeId(adapter, commandeId) {
  return (await adapter.get("SELECT * FROM bc_pf WHERE commande_id = ? AND statut NOT IN ('remplace','annule')", [commandeId])) || null;
}

async function listForCommande(adapter, commandeId) {
  const rows = await adapter.all("SELECT * FROM bc_pf WHERE commande_id = ? ORDER BY id DESC", [commandeId]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const remplacePar = new Map();
  rows.forEach((r) => { if (r.remplace_bc_pf_id != null) remplacePar.set(r.remplace_bc_pf_id, { id: r.id, numero: r.numero, statut: r.statut }); });
  return rows.map((r) => {
    const ancien = r.remplace_bc_pf_id != null ? byId.get(r.remplace_bc_pf_id) : null;
    return { ...r, remplace_numero: ancien ? ancien.numero : null, remplace_par: remplacePar.get(r.id) || null };
  });
}

async function attachLignes(adapter, bc) {
  if (!bc) return null;
  const lignes = await adapter.all("SELECT * FROM bc_pf_lignes WHERE bc_pf_id = ?", [bc.id]);
  return { ...bc, lignes };
}

async function get(adapter, bcPfId) {
  const bc = await adapter.get("SELECT * FROM bc_pf WHERE id = ?", [bcPfId]);
  if (!bc) return null;
  const remplacePar = (await adapter.get("SELECT id, numero, statut FROM bc_pf WHERE remplace_bc_pf_id = ?", [bcPfId])) || null;
  const remplaceQui = bc.remplace_bc_pf_id ? await adapter.get("SELECT id, numero, statut FROM bc_pf WHERE id = ?", [bc.remplace_bc_pf_id]) : null;
  const avecLignes = await attachLignes(adapter, bc);
  return { ...avecLignes, remplace_par: remplacePar, remplace_qui: remplaceQui };
}

const CHAMPS_MODIFIABLES = ["notes_atelier", "observations_internes"];

async function updateBrouillonDoc(adapter, bcPfId, patch) {
  const bc = await adapter.get("SELECT * FROM bc_pf WHERE id = ?", [bcPfId]);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "brouillon") throw new Error("Ce document n'est plus modifiable.");

  const fields = CHAMPS_MODIFIABLES.filter((f) => patch[f] !== undefined);
  if (fields.length > 0) {
    const setClause = fields.map((f) => `${f} = ?`).join(", ");
    await adapter.run(`UPDATE bc_pf SET ${setClause} WHERE id = ?`, [...fields.map((f) => patch[f]), bcPfId]);
  }
  return get(adapter, bcPfId);
}

async function mettreAJourDepuisCommande(adapter, bcPfId) {
  const bc = await adapter.get("SELECT * FROM bc_pf WHERE id = ?", [bcPfId]);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "brouillon") {
    throw new Error("Ce document n'est plus en brouillon : utilisez « Créer un nouveau bon de commande » pour le remplacer.");
  }
  const source = await fetchSnapshotSource(adapter, bc.commande_id);
  assertCommandeEligible(source);
  const lignes = await fetchCommandeLignesNoms(adapter, source.id);

  await adapter.transaction(async (tx) => {
    // COALESCE(notes_atelier, ?) : ne remplace jamais une note déjà personnalisée par l'utilisateur.
    await tx.run(
      "UPDATE bc_pf SET commande_numero=?, article_nom=?, article_reference=?, " +
      "type_production=?, atelier_nom=?, saison_nom=?, responsable_nom=?, " +
      "date_limite_production=?, priorite=?, atelier_id=?, " +
      "notes_atelier=COALESCE(notes_atelier, ?), commande_synced_at=? WHERE id=?",
      [
        source.numero, source.produit, source.article_reference_principale,
        source.type_production, source.atelier, source.saison, source.responsable_nom,
        source.date_fin_prevue, source.priorite, source.atelier_id,
        source.commentaires || null, new Date().toISOString(), bcPfId,
      ]
    );
    await tx.run("DELETE FROM bc_pf_lignes WHERE bc_pf_id = ?", [bcPfId]);
    for (const l of lignes) {
      await tx.run("INSERT INTO bc_pf_lignes (bc_pf_id, couleur_nom, couleur_reference, taille_nom, quantite) VALUES (?, ?, ?, ?, ?)",
        [bcPfId, l.couleur_nom, l.couleur_reference, l.taille_nom, l.quantite]);
    }
  });
  return get(adapter, bcPfId);
}

async function validerBcPf(adapter, bcPfId) {
  const bc = await adapter.get("SELECT * FROM bc_pf WHERE id = ?", [bcPfId]);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "brouillon") throw new Error("Seul un document en brouillon peut être validé.");
  await adapter.run("UPDATE bc_pf SET statut = 'valide', validated_at = ? WHERE id = ?", [new Date().toISOString(), bcPfId]);
  return get(adapter, bcPfId);
}

async function lancerBcPf(adapter, bcPfId) {
  const bc = await adapter.get("SELECT * FROM bc_pf WHERE id = ?", [bcPfId]);
  if (!bc) throw new Error("Bon de commande introuvable.");
  if (bc.statut !== "valide") throw new Error("Seul un document déjà validé peut être lancé.");
  await adapter.run("UPDATE bc_pf SET statut = 'lance', launched_at = ? WHERE id = ?", [new Date().toISOString(), bcPfId]);
  return get(adapter, bcPfId);
}

async function remplacerBcPf(adapter, ancienBcPfId, motif) {
  if (!motif || !motif.trim()) throw new Error("Le motif du remplacement est obligatoire.");
  const ancien = await adapter.get("SELECT * FROM bc_pf WHERE id = ?", [ancienBcPfId]);
  if (!ancien) throw new Error("Bon de commande introuvable.");
  if (ancien.statut !== "valide" && ancien.statut !== "lance") {
    throw new Error("Seul un document validé ou lancé peut être remplacé.");
  }
  const source = await fetchSnapshotSource(adapter, ancien.commande_id);
  assertCommandeEligible(source);

  const photoSnapshotPath = null;
  const entrepriseSnap = await lireInfosEntrepriseSnapshot(adapter);

  const numero = await genererNumeroBcPf(adapter);
  const nouveauId = await adapter.transaction(async (tx) => {
    await tx.run("UPDATE bc_pf SET statut = 'remplace' WHERE id = ?", [ancienBcPfId]);
    return insertDocument(tx, numero, ancien.commande_id, source, photoSnapshotPath, entrepriseSnap, {
      remplace_bc_pf_id: ancienBcPfId,
      motif_remplacement: motif ? motif.trim() : null,
    });
  });
  return get(adapter, nouveauId);
}

module.exports = {
  creerBcPf, getByCommandeId, listForCommande, get,
  updateBrouillonDoc, mettreAJourDepuisCommande, validerBcPf, lancerBcPf, remplacerBcPf,
};
