const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("../lib/asyncArray.js");
const crypto = require("crypto");

// ==================================================================================================
// MODULE FINANCE — backend/IPC uniquement pour cette étape (aucune interface encore).
// Principe directeur : aucune valeur calculable (coût réel, dette, statut de paiement, quantité
// disponible) n'est jamais stockée — toujours dérivée à la demande des tables ci-dessous.
// ==================================================================================================

const CATEGORIES_ACHAT = ["matiere", "fourniture", "confection", "impression", "transport", "retouche", "emballage", "autre"];
const UNITES = ["kg", "m", "piece", "lot"];

function assertCategorie(categorie) {
  if (!CATEGORIES_ACHAT.includes(categorie)) throw new Error(`Catégorie invalide : ${categorie}`);
}
function assertUnite(unite) {
  if (unite != null && !UNITES.includes(unite)) throw new Error(`Unité invalide : ${unite}`);
}

// -------------------------------------------------------------------------------------------------
// 1. Fournisseurs
// -------------------------------------------------------------------------------------------------
async function creerFournisseur(db, payload) {
  if (!payload.nom || !payload.nom.trim()) throw new Error("Le nom du fournisseur est obligatoire.");
  const info = await db.prepare(
    "INSERT INTO fournisseurs (nom, contact, telephone, email, adresse, conditions_paiement_defaut) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(payload.nom.trim(), payload.contact || null, payload.telephone || null, payload.email || null, payload.adresse || null, payload.conditions_paiement_defaut || null);
  return await getFournisseur(db, info.lastInsertRowid);
}

async function mettreAJourFournisseur(db, id, patch) {
  const champs = ["nom", "activite", "contact", "telephone", "email", "adresse", "delai_paiement_jours", "delai_fin_de_mois", "mode_paiement_defaut", "notes", "actif"];
  const sets = [];
  const params = { id };
  champs.forEach((c) => {
    if (patch[c] !== undefined) {
      sets.push(`${c} = @${c}`);
      params[c] = patch[c] === "" ? null : patch[c];
    }
  });
  if (sets.length > 0) {
    sets.push("updated_at = maintenant()");
    await db.prepare(`UPDATE fournisseurs SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }
  return await getFournisseur(db, id);
}

async function listFournisseurs(db, options) {
  options = options || {};
  const where = options.includeInactive ? "" : "WHERE actif = 1";
  return await db.prepare(`SELECT * FROM fournisseurs ${where} ORDER BY LOWER(nom) COLLATE ucs_basic ASC`).all();
}

async function getFournisseur(db, id) {
  return (await db.prepare("SELECT * FROM fournisseurs WHERE id = ?").get(id)) || null;
}

// -------------------------------------------------------------------------------------------------
// 2. Historique des prix fournisseurs — une nouvelle ligne à chaque tarif, jamais une modification.
//    L'ajout d'un nouveau prix ferme automatiquement l'ancien (date_fin_validite = veille du nouveau
//    début), pour qu'un seul tarif soit "en vigueur" à une date donnée, sans jamais l'imposer par
//    contrainte SQL (une contrainte serait fragile face à une saisie rétroactive).
// -------------------------------------------------------------------------------------------------
async function ajouterPrixFournisseur(db, payload) {
  if (!payload.fournisseur_id) throw new Error("Le fournisseur est obligatoire.");
  if (!payload.designation || !payload.designation.trim()) throw new Error("La désignation est obligatoire.");
  assertUnite(payload.unite);
  if (!payload.unite) throw new Error("L'unité est obligatoire.");
  if (payload.matiere_catalogue_id && payload.accessoire_catalogue_id) {
    throw new Error("Un tarif ne peut référencer à la fois une matière et un accessoire catalogués.");
  }
  const dateDebut = payload.date_debut_validite || new Date().toISOString().slice(0, 10);

  const tx = db.transaction(async () => {
    // Ferme le tarif précédent en vigueur pour ce même composant (même fournisseur + même
    // référence catalogue, ou même désignation si aucun catalogue), s'il existe.
    const cleColonne = payload.matiere_catalogue_id ? "matiere_catalogue_id"
      : payload.accessoire_catalogue_id ? "accessoire_catalogue_id" : null;
    if (cleColonne) {
      await db.prepare(
        // date(x, '-1 day') de SQLite : la veille, au format AAAA-MM-JJ.
        `UPDATE prix_fournisseurs SET date_fin_validite = to_char(CAST(@dateDebut AS date) - 1, 'YYYY-MM-DD') ` +
        `WHERE fournisseur_id = @fournisseur_id AND ${cleColonne} = @cleValeur AND date_fin_validite IS NULL`
      ).run({ dateDebut, fournisseur_id: payload.fournisseur_id, cleValeur: payload[cleColonne] });
    } else {
      await db.prepare(
        "UPDATE prix_fournisseurs SET date_fin_validite = to_char(CAST(@dateDebut AS date) - 1, 'YYYY-MM-DD') " +
        "WHERE fournisseur_id = @fournisseur_id AND matiere_catalogue_id IS NULL AND accessoire_catalogue_id IS NULL " +
        "AND designation = @designation AND date_fin_validite IS NULL"
      ).run({ dateDebut, fournisseur_id: payload.fournisseur_id, designation: payload.designation.trim() });
    }

    const info = await db.prepare(
      "INSERT INTO prix_fournisseurs (fournisseur_id, matiere_catalogue_id, accessoire_catalogue_id, designation, unite, prix_ht, date_debut_validite) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(payload.fournisseur_id, payload.matiere_catalogue_id || null, payload.accessoire_catalogue_id || null,
      payload.designation.trim(), payload.unite, Number(payload.prix_ht), dateDebut);
    return info.lastInsertRowid;
  });
  const id = await tx();
  return await db.prepare("SELECT * FROM prix_fournisseurs WHERE id = ?").get(id);
}

async function listPrixFournisseur(db, fournisseurId, options) {
  options = options || {};
  const params = { fournisseurId };
  let sql = "SELECT * FROM prix_fournisseurs WHERE fournisseur_id = @fournisseurId";
  if (!options.includeHistorique) sql += " AND date_fin_validite IS NULL";
  sql += " ORDER BY LOWER(designation) COLLATE ucs_basic ASC, date_debut_validite DESC";
  return await db.prepare(sql).all(params);
}

// Prix en vigueur pour un composant à une date donnée (par défaut aujourd'hui) — c'est cette
// fonction, et elle seule, qui alimente le calcul du coût prévisionnel.
async function prixEnVigueur(
  db,
  { fournisseurId, matiereCatalogueId, accessoireCatalogueId, designation, date }
) {
  date = date || new Date().toISOString().slice(0, 10);
  const params = { fournisseurId, date };
  let where = "fournisseur_id = @fournisseurId AND date_debut_validite <= @date " +
    "AND (date_fin_validite IS NULL OR date_fin_validite >= @date)";
  if (matiereCatalogueId) { where += " AND matiere_catalogue_id = @cle"; params.cle = matiereCatalogueId; }
  else if (accessoireCatalogueId) { where += " AND accessoire_catalogue_id = @cle"; params.cle = accessoireCatalogueId; }
  else if (designation) { where += " AND designation = @cle AND matiere_catalogue_id IS NULL AND accessoire_catalogue_id IS NULL"; params.cle = designation; }
  else return null;
  return (await db.prepare(`SELECT * FROM prix_fournisseurs WHERE ${where} ORDER BY date_debut_validite DESC LIMIT 1`).get(params)) || null;
}

// -------------------------------------------------------------------------------------------------
// 3. Achats / engagements
// -------------------------------------------------------------------------------------------------
async function creerAchat(db, payload) {
  if (!payload.fournisseur_id) throw new Error("Le fournisseur est obligatoire.");
  assertCategorie(payload.categorie);
  if (!payload.designation || !payload.designation.trim()) throw new Error("La désignation est obligatoire.");
  if (payload.montant_engage == null || Number(payload.montant_engage) < 0) throw new Error("Le montant engagé est obligatoire et doit être positif.");
  assertUnite(payload.unite);
  if (payload.commande_id && payload.quantite) {
    // Un achat directement lié à UNE commande n'a pas besoin d'une répartition par quantité —
    // autorisé quand même (ex: traçabilité de quantité de tissu utilisée), mais pas obligatoire.
  }
  const uuid = crypto.randomUUID();
  const info = await db.prepare(
    "INSERT INTO achats (uuid, fournisseur_id, commande_id, categorie, designation, matiere_catalogue_id, couleur, quantite, unite, montant_engage, date_engagement, reference, notes) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(uuid, payload.fournisseur_id, payload.commande_id || null, payload.categorie, payload.designation.trim(),
    payload.matiere_catalogue_id || null, payload.couleur ? payload.couleur.trim() : null,
    payload.quantite != null ? Number(payload.quantite) : null, payload.unite || null, Number(payload.montant_engage),
    payload.date_engagement || new Date().toISOString().slice(0, 10), payload.reference || null, payload.notes || null);
  return await getAchat(db, info.lastInsertRowid);
}

async function getAchat(db, id) {
  return (await db.prepare("SELECT * FROM achats WHERE id = ?").get(id)) || null;
}

async function listAchats(db, filtres) {
  filtres = filtres || {};
  const clauses = [];
  const params = {};
  if (filtres.fournisseurId) { clauses.push("fournisseur_id = @fournisseurId"); params.fournisseurId = filtres.fournisseurId; }
  if (filtres.commandeId) { clauses.push("commande_id = @commandeId"); params.commandeId = filtres.commandeId; }
  if (filtres.categorie) { clauses.push("categorie = @categorie"); params.categorie = filtres.categorie; }
  if (filtres.partageablesUniquement) { clauses.push("commande_id IS NULL"); }
  const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return await db.prepare(`SELECT * FROM achats ${where} ORDER BY date_engagement DESC, id DESC`).all(params);
}

// -------------------------------------------------------------------------------------------------
// 4. Réceptions d'achats — plusieurs lignes possibles (réceptions partielles), jamais de total
//    doublé puisque chaque ligne représente un événement distinct, jamais un cumul réécrit.
// -------------------------------------------------------------------------------------------------
async function ajouterReceptionAchat(db, achatId, payload) {
  if (!(await getAchat(db, achatId))) throw new Error("Achat introuvable.");
  const info = await db.prepare(
    "INSERT INTO achats_receptions (achat_id, date_reception, quantite_recue, reference_bl, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(achatId, payload.date_reception || new Date().toISOString().slice(0, 10),
    payload.quantite_recue != null ? Number(payload.quantite_recue) : null, payload.reference_bl || null, payload.notes || null);
  return await db.prepare("SELECT * FROM achats_receptions WHERE id = ?").get(info.lastInsertRowid);
}

async function listReceptionsAchat(db, achatId) {
  return await db.prepare("SELECT * FROM achats_receptions WHERE achat_id = ? ORDER BY date_reception ASC, id ASC").all(achatId);
}

async function quantiteRecueAchat(db, achatId) {
  return (await db.prepare("SELECT COALESCE(SUM(quantite_recue), 0) AS s FROM achats_receptions WHERE achat_id = ?").get(achatId)).s;
}

// -------------------------------------------------------------------------------------------------
// 5. Factures fournisseurs — plusieurs factures possibles par achat (facturation partielle).
//    C'est la SEULE source du "coût réel" ; montant_tva est purement informatif.
// -------------------------------------------------------------------------------------------------
async function ajouterFactureAchat(db, achatId, payload) {
  if (!(await getAchat(db, achatId))) throw new Error("Achat introuvable.");
  if (payload.montant_ht == null || Number(payload.montant_ht) < 0) throw new Error("Le montant HT de la facture est obligatoire et doit être positif.");
  const info = await db.prepare(
    "INSERT INTO achats_factures (achat_id, date_facture, montant_ht, montant_tva, reference_facture) VALUES (?, ?, ?, ?, ?)"
  ).run(achatId, payload.date_facture || new Date().toISOString().slice(0, 10), Number(payload.montant_ht),
    payload.montant_tva != null ? Number(payload.montant_tva) : null, payload.reference_facture || null);
  return await db.prepare("SELECT * FROM achats_factures WHERE id = ?").get(info.lastInsertRowid);
}

async function listFacturesAchat(db, achatId) {
  return await db.prepare("SELECT * FROM achats_factures WHERE achat_id = ? ORDER BY date_facture ASC, id ASC").all(achatId);
}

async function getFacture(db, id) {
  return (await db.prepare("SELECT * FROM achats_factures WHERE id = ?").get(id)) || null;
}

// -------------------------------------------------------------------------------------------------
// Calcul du coût d'un achat — cœur de toute la logique financière. Jamais stocké.
// -------------------------------------------------------------------------------------------------
async function coutAchat(db, achatId) {
  const achat = await getAchat(db, achatId);
  if (!achat) throw new Error("Achat introuvable.");
  const factureReel = (await db.prepare("SELECT COALESCE(SUM(montant_ht), 0) AS s FROM achats_factures WHERE achat_id = ?").get(achatId)).s;
  const provisoireRestant = Math.max(0, achat.montant_engage - factureReel);
  const coutSuivi = factureReel + provisoireRestant; // == Math.max(factureReel, achat.montant_engage)
  return { achat_id: achatId, montant_engage: achat.montant_engage, facture_reel: factureReel, provisoire_restant: provisoireRestant, cout_suivi: coutSuivi };
}

// -------------------------------------------------------------------------------------------------
// 6. Affectation des achats partagés aux productions — quantité seule est saisie/figée ; la valeur
//    est TOUJOURS recalculée au prorata de la valeur réelle actuelle de l'achat (jamais stockée),
//    pour qu'une facture différente de l'engagement se répercute automatiquement.
// -------------------------------------------------------------------------------------------------
async function quantiteDejaAffectee(db, achatId, excludeAffectationId) {
  return (await db.prepare(
    "SELECT COALESCE(SUM(quantite_affectee), 0) AS s FROM achats_affectations WHERE achat_id = ? AND id <> ?"
  ).get(achatId, excludeAffectationId ?? -1)).s;
}

async function affecterAchat(db, payload) {
  const achat = await getAchat(db, payload.achat_id);
  if (!achat) throw new Error("Achat introuvable.");
  if (achat.quantite == null) throw new Error("Cet achat n'a pas de quantité renseignée — impossible de le répartir.");
  const quantite = Number(payload.quantite_affectee);
  if (!(quantite > 0)) throw new Error("La quantité affectée doit être positive.");

  const dejaAffectee = await quantiteDejaAffectee(db, payload.achat_id);
  if (dejaAffectee + quantite > achat.quantite + 1e-9) {
    throw new Error(
      `Affectation refusée : ${dejaAffectee + quantite} ${achat.unite || ""} dépasseraient la quantité achetée ` +
      `(${achat.quantite} ${achat.unite || ""}). Disponible : ${(achat.quantite - dejaAffectee).toFixed(3)}.`
    );
  }

  const info = await db.prepare(
    "INSERT INTO achats_affectations (achat_id, commande_id, quantite_affectee, date_affectation, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(payload.achat_id, payload.commande_id, quantite, payload.date_affectation || new Date().toISOString().slice(0, 10), payload.notes || null);
  return await db.prepare("SELECT * FROM achats_affectations WHERE id = ?").get(info.lastInsertRowid);
}

async function quantiteDisponibleAchat(db, achatId) {
  const achat = await getAchat(db, achatId);
  if (!achat || achat.quantite == null) return null;
  return achat.quantite - (await quantiteDejaAffectee(db, achatId));
}

async function listAffectationsAchat(db, achatId) {
  return await db.prepare("SELECT * FROM achats_affectations WHERE achat_id = ? ORDER BY date_affectation ASC, id ASC").all(achatId);
}

// Part réelle/provisoire d'UNE affectation, dérivée du coût de l'achat parent — jamais stockée.
async function coutAffectation(db, affectationId) {
  const affectation = await db.prepare("SELECT * FROM achats_affectations WHERE id = ?").get(affectationId);
  if (!affectation) throw new Error("Affectation introuvable.");
  const achat = await getAchat(db, affectation.achat_id);
  const part = affectation.quantite_affectee / achat.quantite;
  const cout = await coutAchat(db, affectation.achat_id);
  return {
    affectation_id: affectationId,
    part,
    facture_reel: part * cout.facture_reel,
    provisoire_restant: part * cout.provisoire_restant,
    cout_suivi: part * cout.cout_suivi,
  };
}

// -------------------------------------------------------------------------------------------------
// Coût d'une commande (production) — agrège achats directs + part des achats partagés affectés.
// -------------------------------------------------------------------------------------------------
// -------------------------------------------------------------------------------------------------
// STOCK MATIÈRES/FOURNITURES — identifié par (matiere_catalogue_id, couleur). La couleur reste
// optionnelle (NULL = composant sans déclinaison, ex: aiguille). Catégories "stockables" : leur
// coût réel se construit à partir de la quantité RÉELLEMENT CONSOMMÉE, jamais du montant total
// facturé. Les prestations (confection, transport, retouche, impression, autre) n'ont pas cette
// notion de stock — leur montant facturé s'affecte directement, logique déjà existante inchangée.
// -------------------------------------------------------------------------------------------------
const CATEGORIES_STOCKABLES = ["matiere", "fourniture", "habillage", "emballage"];
function estCategorieStockable(categorie) {
  return CATEGORIES_STOCKABLES.includes(categorie);
}

// Tous les lots (achats) d'un composant identifié par matière+couleur, du plus ancien au plus
// récent — base de la logique FIFO. "couleur = null" cible spécifiquement les lots SANS couleur
// (pas un joker qui les inclurait tous).
async function listLotsMatiere(db, matiereCatalogueId, couleur) {
  let sql = "SELECT * FROM achats WHERE matiere_catalogue_id = ?";
  const params = [matiereCatalogueId];
  if (couleur == null || couleur === "") {
    sql += " AND (couleur IS NULL OR couleur = '')";
  } else {
    sql += " AND couleur = ?";
    params.push(couleur);
  }
  sql += " ORDER BY date_engagement ASC, id ASC";
  return await db.prepare(sql).all(...params);
}

// Stock disponible pour un composant (matière ou fourniture) + couleur éventuelle — Acheté /
// Consommé / Disponible, avec le détail lot par lot pour comprendre le calcul si nécessaire.
async function stockDisponibleMatiere(db, matiereCatalogueId, couleur) {
  const lots = await listLotsMatiere(db, matiereCatalogueId, couleur);
  let achete = 0, consomme = 0;
  const detailLots = await mapSeq(lots, async lot => {
    const dejaAffecte = await quantiteDejaAffectee(db, lot.id);
    const disponible = Math.max(0, (lot.quantite || 0) - dejaAffecte);
    const cout = await coutAchat(db, lot.id);
    achete += lot.quantite || 0;
    consomme += dejaAffecte;
    return {
      achat_id: lot.id, date_engagement: lot.date_engagement, reference: lot.reference,
      quantite_achetee: lot.quantite, quantite_consommee: dejaAffecte, disponible,
      prix_unitaire_reel: lot.quantite ? cout.cout_suivi / lot.quantite : null,
    };
  });
  return {
    matiere_catalogue_id: matiereCatalogueId, couleur: couleur || null,
    achete, consomme, disponible: Math.max(0, achete - consomme), lots: detailLots,
  };
}

// Consommation réelle d'une production pour un composant + couleur — l'utilisateur indique
// SEULEMENT la quantité consommée ; la répartition sur les lots disponibles (FIFO, du plus ancien
// au plus récent) et le calcul du coût sont entièrement automatiques. Réutilise affecterAchat tel
// quel (mêmes garde-fous), jamais de logique de coût parallèle.
async function affecterConsommationMatiere(db, payload) {
  const { commande_id, matiere_catalogue_id, couleur, quantite_consommee } = payload;
  if (!commande_id) throw new Error("La production est obligatoire.");
  if (!matiere_catalogue_id) throw new Error("Le composant (matière/fourniture) est obligatoire.");
  const quantiteVoulue = Number(quantite_consommee);
  if (!(quantiteVoulue > 0)) throw new Error("La quantité consommée doit être positive.");

  const lots = (await mapSeq(await listLotsMatiere(db, matiere_catalogue_id, couleur), async lot => ({
    ...lot,
    disponible: Math.max(0, (lot.quantite || 0) - (await quantiteDejaAffectee(db, lot.id)))
  })))
    .filter((l) => l.disponible > 1e-9);
  const totalDisponible = lots.reduce((s, l) => s + l.disponible, 0);
  if (quantiteVoulue > totalDisponible + 1e-9) {
    throw new Error(
      `Stock insuffisant : ${totalDisponible.toFixed(3)} disponible(s) pour ce composant${couleur ? " (" + couleur + ")" : ""}, ` +
      `${quantiteVoulue} demandé(s).`
    );
  }

  let reste = quantiteVoulue;
  let coutTotal = 0;
  const detail = [];
  for (const lot of lots) {
    if (reste <= 1e-9) break;
    const prise = Math.min(lot.disponible, reste);
    const affectation = await affecterAchat(db, {
      achat_id: lot.id, commande_id, quantite_affectee: prise,
      date_affectation: payload.date_affectation, notes: payload.notes,
    });
    const c = await coutAffectation(db, affectation.id);
    coutTotal += c.cout_suivi;
    detail.push({
      affectation_id: affectation.id, achat_id: lot.id, date_engagement: lot.date_engagement,
      quantite: prise, prix_unitaire_reel: lot.quantite ? (await coutAchat(db, lot.id)).cout_suivi / lot.quantite : null,
      cout: c.cout_suivi,
    });
    reste -= prise;
  }

  return { quantite_consommee: quantiteVoulue, cout_total: coutTotal, nb_lots_utilises: detail.length, detail };
}

// Vue globale du stock — tous composants + couleurs confondus. Fonction de données seulement,
// prépare la future vue "Finance / Stock matières" sans construire l'écran maintenant.
async function syntheseStockMatiere(db) {
  const combinaisons = await db.prepare(
    // Ordre de première apparition (ce que rendait le DISTINCT de SQLite en lisant la table par id).
    "SELECT matiere_catalogue_id, couleur FROM achats WHERE matiere_catalogue_id IS NOT NULL " +
    "GROUP BY matiere_catalogue_id, couleur ORDER BY MIN(id)"
  ).all();
  return (await mapSeq(combinaisons, async c => {
    const matiere = await db.prepare("SELECT nom, unite_defaut FROM matieres_catalogue WHERE id = ?").get(c.matiere_catalogue_id);
    const stock = await stockDisponibleMatiere(db, c.matiere_catalogue_id, c.couleur);
    const valeurStock = stock.lots.reduce((s, l) => s + l.disponible * (l.prix_unitaire_reel || 0), 0);
    return { ...stock, nom: matiere ? matiere.nom : "—", unite: matiere ? matiere.unite_defaut : null, valeur_stock: valeurStock };
  })).filter((s) => s.achete > 1e-9);
}

// Consommation théorique (estimation × quantité prévue) vs réellement affectée — seulement pour
// les catégories stockables, avec écart en quantité, en %, et son impact en valeur.
async function comparaisonConsommationCommande(db, commandeId) {
  const commande = await db.prepare("SELECT article_id, quantite_totale FROM commandes WHERE id = ?").get(commandeId);
  if (!commande) throw new Error("Commande introuvable.");
  const estimation = await db.prepare("SELECT id FROM estimations WHERE article_id = ?").get(commande.article_id);
  const lignesEstimation = estimation ? await listLignesEstimation(db, estimation.id) : [];

  const parCategorie = {};
  lignesEstimation
    .filter((l) => estCategorieStockable(l.categorie) && l.mode_calcul === "consommation_prix" && l.quantite != null)
    .forEach((l) => {
      const theorique = l.quantite * commande.quantite_totale;
      parCategorie[l.categorie] = parCategorie[l.categorie] || { categorie: l.categorie, theorique: 0, reel: 0 };
      parCategorie[l.categorie].theorique += theorique;
    });

  const achatsCommande = await db.prepare(
    "SELECT categorie, id FROM achats WHERE commande_id = ? OR id IN (SELECT achat_id FROM achats_affectations WHERE commande_id = ?) ORDER BY id"
  ).all(commandeId, commandeId);

  for (const a of achatsCommande) {
    if (!estCategorieStockable(a.categorie))
      continue;
    const reel = (await db.prepare(
      "SELECT COALESCE(SUM(quantite_affectee), 0) AS s FROM achats_affectations WHERE achat_id = ? AND commande_id = ?"
    ).get(a.id, commandeId)).s;
    parCategorie[a.categorie] = parCategorie[a.categorie] || { categorie: a.categorie, theorique: 0, reel: 0 };
    parCategorie[a.categorie].reel += reel;
  }

  return Object.values(parCategorie).map((c) => {
    const ecartQuantite = c.reel - c.theorique;
    const ecartPourcent = c.theorique > 1e-9 ? (ecartQuantite / c.theorique) * 100 : null;
    return { ...c, ecart_quantite: ecartQuantite, ecart_pourcent: ecartPourcent };
  });
}

async function coutCommande(db, commandeId) {
  const achatsDirects = await db.prepare("SELECT id FROM achats WHERE commande_id = ?").all(commandeId);
  const affectations = await db.prepare("SELECT id FROM achats_affectations WHERE commande_id = ?").all(commandeId);

  let factureReel = 0, provisoireRestant = 0;

  for (const a of achatsDirects) {
    const c = await coutAchat(db, a.id);
    factureReel += c.facture_reel;
    provisoireRestant += c.provisoire_restant;
  }

  for (const aff of affectations) {
    const c = await coutAffectation(db, aff.id);
    factureReel += c.facture_reel;
    provisoireRestant += c.provisoire_restant;
  }

  return {
    commande_id: commandeId,
    facture_reel: factureReel,
    provisoire_restant: provisoireRestant,
    cout_suivi: factureReel + provisoireRestant,
    nb_achats_directs: achatsDirects.length,
    nb_affectations: affectations.length,
  };
}

// -------------------------------------------------------------------------------------------------
// 7. Paiements — toujours rattachés à un fournisseur, jamais directement à un achat.
// -------------------------------------------------------------------------------------------------
async function creerPaiement(db, payload) {
  if (!payload.fournisseur_id) throw new Error("Le fournisseur est obligatoire.");
  if (!(Number(payload.montant) > 0)) throw new Error("Le montant du paiement doit être positif.");
  const type = payload.type === "avance" ? "avance" : "reglement";
  const info = await db.prepare(
    "INSERT INTO paiements (fournisseur_id, type, date_paiement, montant, mode, reference, notes) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(payload.fournisseur_id, type, payload.date_paiement || new Date().toISOString().slice(0, 10), Number(payload.montant),
    payload.mode || null, payload.reference || null, payload.notes || null);
  return await db.prepare("SELECT * FROM paiements WHERE id = ?").get(info.lastInsertRowid);
}

async function listPaiementsFournisseur(db, fournisseurId) {
  return await db.prepare("SELECT * FROM paiements WHERE fournisseur_id = ? ORDER BY date_paiement DESC, id DESC").all(fournisseurId);
}

// -------------------------------------------------------------------------------------------------
// 8. Affectation des paiements aux factures — un paiement peut couvrir plusieurs factures ; la part
//    non affectée reste un crédit fournisseur visible, jamais forcé sur une facture.
// -------------------------------------------------------------------------------------------------
async function montantDejaAffecteDuPaiement(db, paiementId) {
  return (await db.prepare("SELECT COALESCE(SUM(montant_affecte), 0) AS s FROM paiement_affectations WHERE paiement_id = ?").get(paiementId)).s;
}
async function montantDejaPayeDeLaFacture(db, factureId) {
  return (await db.prepare("SELECT COALESCE(SUM(montant_affecte), 0) AS s FROM paiement_affectations WHERE achat_facture_id = ?").get(factureId)).s;
}

async function affecterPaiement(db, payload) {
  const paiement = await db.prepare("SELECT * FROM paiements WHERE id = ?").get(payload.paiement_id);
  if (!paiement) throw new Error("Paiement introuvable.");
  const facture = await getFacture(db, payload.achat_facture_id);
  if (!facture) throw new Error("Facture introuvable.");
  const montant = Number(payload.montant_affecte);
  if (!(montant > 0)) throw new Error("Le montant affecté doit être positif.");

  const disponiblePaiement = paiement.montant - (await montantDejaAffecteDuPaiement(db, payload.paiement_id));
  if (montant > disponiblePaiement + 1e-9) {
    throw new Error(`Affectation refusée : seulement ${disponiblePaiement.toFixed(3)} DT disponibles sur ce paiement.`);
  }
  const resteSurFacture = facture.montant_ht - (await montantDejaPayeDeLaFacture(db, payload.achat_facture_id));
  if (montant > resteSurFacture + 1e-9) {
    throw new Error(`Affectation refusée : cette facture ne peut pas recevoir plus que son reste dû (${resteSurFacture.toFixed(3)} DT).`);
  }

  const info = await db.prepare(
    "INSERT INTO paiement_affectations (paiement_id, achat_facture_id, montant_affecte) VALUES (?, ?, ?)"
  ).run(payload.paiement_id, payload.achat_facture_id, montant);
  return await db.prepare("SELECT * FROM paiement_affectations WHERE id = ?").get(info.lastInsertRowid);
}

async function creditNonAffecte(db, paiementId) {
  const paiement = await db.prepare("SELECT * FROM paiements WHERE id = ?").get(paiementId);
  if (!paiement) throw new Error("Paiement introuvable.");
  return paiement.montant - (await montantDejaAffecteDuPaiement(db, paiementId));
}

async function statutFacture(db, factureId) {
  const facture = await getFacture(db, factureId);
  if (!facture) throw new Error("Facture introuvable.");
  const paye = await montantDejaPayeDeLaFacture(db, factureId);
  const resteDu = facture.montant_ht - paye;
  let statut;
  if (paye <= 1e-9) statut = "non_payee";
  else if (resteDu <= 1e-9) statut = "payee";
  else statut = "partiellement_payee";
  return { facture_id: factureId, montant_ht: facture.montant_ht, paye, reste_du: Math.max(0, resteDu), statut };
}

async function detteFournisseur(db, fournisseurId) {
  const achatsIds = (await db.prepare("SELECT id FROM achats WHERE fournisseur_id = ?").all(fournisseurId)).map((a) => a.id);
  let engage = 0, facture = 0, paye = 0;

  for (const achatId of achatsIds) {
    const a = await getAchat(db, achatId);
    engage += a.montant_engage;
    const facturesAchat = await listFacturesAchat(db, achatId);

    for (const f of facturesAchat) {
      facture += f.montant_ht;
      paye += await montantDejaPayeDeLaFacture(db, f.id);
    }
  }

  const totalPaiements = (await db.prepare("SELECT COALESCE(SUM(montant), 0) AS s FROM paiements WHERE fournisseur_id = ?").get(fournisseurId)).s;
  const creditNonAffecteTotal = totalPaiements - paye;
  return {
    fournisseur_id: fournisseurId,
    engage,
    facture,
    paye,
    dette_restante: Math.max(0, facture - paye),
    engagement_restant: Math.max(0, engage - facture),
    credit_non_affecte: Math.max(0, creditNonAffecteTotal),
  };
}

// -------------------------------------------------------------------------------------------------
// 9. Échéances
// -------------------------------------------------------------------------------------------------
async function ajouterEcheance(db, achatId, payload) {
  if (!(await getAchat(db, achatId))) throw new Error("Achat introuvable.");
  if (!payload.date_echeance) throw new Error("La date d'échéance est obligatoire.");
  if (!(Number(payload.montant) > 0)) throw new Error("Le montant de l'échéance doit être positif.");
  const info = await db.prepare(
    "INSERT INTO echeances (achat_id, achat_facture_id, date_echeance, montant, notes) VALUES (?, ?, ?, ?, ?)"
  ).run(achatId, payload.achat_facture_id || null, payload.date_echeance, Number(payload.montant), payload.notes || null);
  return await db.prepare("SELECT * FROM echeances WHERE id = ?").get(info.lastInsertRowid);
}

// Calcule une date d'échéance suggérée à partir des conditions de paiement structurées du
// fournisseur — jamais imposée : purement une proposition, toujours modifiable pour la facture
// concernée, sans jamais toucher aux conditions générales enregistrées sur la fiche fournisseur.
// "délai fin de mois" = à partir de la fin du mois de la facture, puis + délai (ex: facture du
// 12 août + 30 jours fin de mois → fin août (31) + 30 jours = 30 septembre).
function calculerEcheanceSuggeree(dateFacture, delaiJours, delaiFinDeMois) {
  if (delaiJours == null) return null;
  const [annee, mois, jour] = dateFacture.split("-").map(Number);
  let base;
  if (delaiFinDeMois) {
    base = new Date(Date.UTC(annee, mois, 0)); // dernier jour du mois de la facture
  } else {
    base = new Date(Date.UTC(annee, mois - 1, jour));
  }
  base.setUTCDate(base.getUTCDate() + delaiJours);
  return base.toISOString().slice(0, 10);
}

// Factures d'un fournisseur, toutes achats confondus — pour l'onglet Factures de la fiche
// fournisseur, qui a sa propre vue distincte de l'onglet Achats.
async function listFacturesFournisseur(db, fournisseurId) {
  const achatsIds = await db.prepare("SELECT id, designation FROM achats WHERE fournisseur_id = ?").all(fournisseurId);
  const parAchat = new Map(achatsIds.map((a) => [a.id, a.designation]));
  const factures = await db.prepare(
    `SELECT f.* FROM achats_factures f JOIN achats a ON a.id = f.achat_id WHERE a.fournisseur_id = ? ORDER BY f.date_facture DESC, f.id DESC`
  ).all(fournisseurId);
  return await mapSeq(factures, async f => {
    const st = await statutFacture(db, f.id);
    const echeance = await db.prepare("SELECT date_echeance FROM echeances WHERE achat_facture_id = ? ORDER BY date_echeance ASC LIMIT 1").get(f.id);
    const dateEcheance = echeance ? echeance.date_echeance : null;
    const enRetard = st.reste_du > 1e-9 && dateEcheance && dateEcheance < new Date().toISOString().slice(0, 10);
    let statut;
    if (st.statut === "payee") statut = "payee";
    else if (enRetard) statut = "en_retard";
    else if (st.statut === "partiellement_payee") statut = "partiel";
    else statut = "a_payer";
    return {
      ...f, achat_designation: parAchat.get(f.achat_id) || "—",
      paye: st.paye, reste: st.reste_du, statut,
      date_echeance: dateEcheance,
    };
  });
}

async function listEcheances(db, filtres) {
  filtres = filtres || {};
  const clauses = [];
  const params = {};
  if (filtres.avant) { clauses.push("date_echeance <= @avant"); params.avant = filtres.avant; }
  if (filtres.apres) { clauses.push("date_echeance >= @apres"); params.apres = filtres.apres; }
  const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
  return await db.prepare(`SELECT * FROM echeances ${where} ORDER BY date_echeance ASC`).all(params);
}

// -------------------------------------------------------------------------------------------------
// 10. Réceptions de production (contrôle qualité) — historique conservé, jamais écrasé.
// -------------------------------------------------------------------------------------------------
async function ajouterReceptionProduction(db, commandeId, payload) {
  const conforme = Number(payload.quantite_conforme || 0);
  const aRetoucher = Number(payload.quantite_a_retoucher || 0);
  const rebut = Number(payload.quantite_rebut || 0);
  const recue = Number(payload.quantite_recue);
  if (!(recue > 0)) throw new Error("La quantité reçue doit être positive.");
  if (conforme + aRetoucher + rebut > recue + 1e-9) {
    throw new Error("La somme conforme + à retoucher + rebut ne peut pas dépasser la quantité reçue.");
  }
  const info = await db.prepare(
    "INSERT INTO receptions_production (commande_id, date_reception, quantite_recue, quantite_conforme, quantite_a_retoucher, quantite_rebut, notes) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(commandeId, payload.date_reception || new Date().toISOString().slice(0, 10), recue, conforme, aRetoucher, rebut, payload.notes || null);
  return await db.prepare("SELECT * FROM receptions_production WHERE id = ?").get(info.lastInsertRowid);
}

// Enregistre une retouche réussie sur une ligne de réception précise — jamais de suppression de
// l'historique du besoin initial (quantite_a_retoucher reste inchangée).
async function enregistrerRetoucheReussie(db, receptionId, quantite) {
  const reception = await db.prepare("SELECT * FROM receptions_production WHERE id = ?").get(receptionId);
  if (!reception) throw new Error("Réception introuvable.");
  const q = Number(quantite);
  if (!(q > 0)) throw new Error("La quantité récupérée doit être positive.");
  if (reception.quantite_retouchee_recuperee + q > reception.quantite_a_retoucher + 1e-9) {
    throw new Error("Impossible de récupérer plus de pièces qu'il n'y en avait à retoucher.");
  }
  await db.prepare(
    "UPDATE receptions_production SET quantite_retouchee_recuperee = quantite_retouchee_recuperee + ?, updated_at = maintenant() WHERE id = ?"
  ).run(q, receptionId);
  return await db.prepare("SELECT * FROM receptions_production WHERE id = ?").get(receptionId);
}

async function listReceptionsProduction(db, commandeId) {
  return await db.prepare("SELECT * FROM receptions_production WHERE commande_id = ? ORDER BY date_reception ASC, id ASC").all(commandeId);
}

// Quantité totale commercialisable = conforme + retouchée récupérée, sur TOUTES les réceptions
// (partielles ou non) de cette commande — jamais de double comptage puisque chaque ligne est un
// événement distinct, jamais un cumul réécrit.
async function quantiteCommercialisableCommande(db, commandeId) {
  const lignes = await listReceptionsProduction(db, commandeId);
  return lignes.reduce((s, l) => s + l.quantite_conforme + l.quantite_retouchee_recuperee, 0);
}

// -------------------------------------------------------------------------------------------------
// Synthèse finale : coût réel unitaire = coût total suivi de la commande / quantité commercialisable.
// -------------------------------------------------------------------------------------------------
async function syntheseCoutCommande(db, commandeId) {
  const cout = await coutCommande(db, commandeId);
  const quantiteCommercialisable = await quantiteCommercialisableCommande(db, commandeId);
  return {
    ...cout,
    quantite_commercialisable: quantiteCommercialisable,
    cout_unitaire: quantiteCommercialisable > 0 ? cout.cout_suivi / quantiteCommercialisable : null,
    provisoire: cout.provisoire_restant > 1e-9,
  };
}

// -------------------------------------------------------------------------------------------------
// Agrégats pour la Vue d'ensemble — un seul appel, calculé côté backend pour ne jamais dupliquer
// la logique métier (déjà établie ci-dessus) côté frontend.
// -------------------------------------------------------------------------------------------------
async function syntheseGlobale(db) {
  const fournisseurs = await listFournisseurs(db, { includeInactive: true });
  let totalAPayer = 0, creditNonAffecteTotal = 0;

  for (const f of fournisseurs) {
    const d = await detteFournisseur(db, f.id);
    totalAPayer += d.dette_restante;
    creditNonAffecteTotal += d.credit_non_affecte;
  }

  const achats = await listAchats(db, {});
  let coutProvisoireTotal = 0, nbAchatsProvisoires = 0;

  for (const a of achats) {
    const c = await coutAchat(db, a.id);
    if (c.provisoire_restant > 1e-9) { coutProvisoireTotal += c.provisoire_restant; nbAchatsProvisoires++; }
  }

  const aujourdHui = new Date().toISOString().slice(0, 10);
  const dans7j = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const dans30j = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const echeances7j = (await listEcheances(db, { apres: aujourdHui, avant: dans7j })).reduce((s, e) => s + e.montant, 0);
  const echeances30j = (await listEcheances(db, { apres: aujourdHui, avant: dans30j })).reduce((s, e) => s + e.montant, 0);

  return {
    total_a_payer: totalAPayer,
    echeances_7j: echeances7j,
    echeances_30j: echeances30j,
    credit_non_affecte: creditNonAffecteTotal,
    cout_provisoire_total: coutProvisoireTotal,
    nb_achats_provisoires: nbAchatsProvisoires,
  };
}

// Échéances enrichies (fournisseur, document, montant payé/reste, statut) — pour affichage direct,
// sans recomposer les jointures côté frontend.
async function listEcheancesDetaillees(db, filtres) {
  const echeances = await listEcheances(db, filtres);
  return await mapSeq(echeances, async e => {
    const achat = await getAchat(db, e.achat_id);
    const fournisseur = await getFournisseur(db, achat.fournisseur_id);
    const factures = await listFacturesAchat(db, e.achat_id);
    const paye = await reduceSeq(
      factures,
      async (s, f) => s + (await montantDejaPayeDeLaFacture(db, f.id)),
      0
    );
    const reste = Math.max(0, e.montant - paye);
    let statut;
    const enRetard = e.date_echeance < new Date().toISOString().slice(0, 10);
    if (reste <= 1e-9) statut = "payee";
    else if (paye > 1e-9) statut = "partiellement_payee";
    else if (enRetard) statut = "en_retard";
    else statut = "a_payer";
    return {
      echeance_id: e.id, achat_id: e.achat_id, fournisseur_nom: fournisseur ? fournisseur.nom : "—",
      document: achat.designation, date_echeance: e.date_echeance, montant: e.montant, paye, reste, statut,
    };
  });
}

// Dette + prochaine échéance par fournisseur — pour la liste Fournisseurs (une ligne = un appel
// unique par fournisseur, évite de recomposer ces deux informations séparément côté écran).
async function listFournisseursAvecSynthese(db, options) {
  return await mapSeq(await listFournisseurs(db, options), async f => {
    const d = await detteFournisseur(db, f.id);
    const prochaine = (await db.prepare(
      "SELECT MIN(ech.date_echeance) AS d FROM echeances ech JOIN achats a ON a.id = ech.achat_id WHERE a.fournisseur_id = ? AND ech.date_echeance >= aujourdhui()"
    ).get(f.id)).d;
    // "Activité" : le champ saisi prime toujours ; à défaut, dérivée des catégories d'achats déjà
    // passés (pour un fournisseur tout juste créé, sans encore aucune activité renseignée).
    const categories = (await db.prepare("SELECT DISTINCT categorie FROM achats WHERE fournisseur_id = ? ORDER BY categorie").all(f.id)).map((c) => c.categorie);
    return { ...f, dette_actuelle: d.dette_restante, prochaine_echeance: prochaine, categories_achat: categories };
  });
}

// Achats enrichis (fournisseur, production liée, coût facturé, payé, reste à payer, statut) — pour
// la liste Achats & factures, en un seul appel.
async function listAchatsDetailles(db, filtres) {
  return await mapSeq(await listAchats(db, filtres), async a => {
    const fournisseur = await getFournisseur(db, a.fournisseur_id);
    const cout = await coutAchat(db, a.id);
    const factures = await listFacturesAchat(db, a.id);
    const paye = await reduceSeq(
      factures,
      async (s, f) => s + (await montantDejaPayeDeLaFacture(db, f.id)),
      0
    );
    const resteAPayer = Math.max(0, cout.facture_reel - paye);
    const affectations = await listAffectationsAchat(db, a.id);
    let commande = null;
    if (a.commande_id) {
      commande = await db.prepare("SELECT numero, id FROM commandes WHERE id = ?").get(a.commande_id);
    }
    let statut;
    if (cout.provisoire_restant > 1e-9) statut = "provisoire";
    else if (resteAPayer <= 1e-9) statut = "paye";
    else if (paye > 1e-9) statut = "partiellement_paye";
    else statut = "a_payer";
    return {
      ...a, fournisseur_nom: fournisseur ? fournisseur.nom : "—",
      commande_numero: commande ? commande.numero : null,
      nb_affectations: affectations.length,
      facture_reel: cout.facture_reel, provisoire_restant: cout.provisoire_restant, cout_suivi: cout.cout_suivi,
      paye, reste_a_payer: resteAPayer, statut,
    };
  });
}

// -------------------------------------------------------------------------------------------------
// Catalogue matières — mêmes principes que accessoires_catalogue déjà existant (find-or-create
// par nom normalisé, pour ne jamais dupliquer la même matière sous deux entrées différentes).
// -------------------------------------------------------------------------------------------------
async function listMatieresCatalogue(db) {
  return await db.prepare("SELECT * FROM matieres_catalogue WHERE actif = 1 ORDER BY ordre, nom").all();
}

async function trouverOuCreerMatiereCatalogue(db, nom, uniteDefaut) {
  const nomTrim = nom.trim();
  const nomNormalise = nomTrim.toLowerCase().replace(/\s+/g, " ");
  let entry = await db.prepare("SELECT * FROM matieres_catalogue WHERE nom_normalise = ?").get(nomNormalise);
  if (!entry) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM matieres_catalogue").get()).m || 0;
    const info = await db.prepare(
      "INSERT INTO matieres_catalogue (nom, nom_normalise, unite_defaut, ordre) VALUES (?, ?, ?, ?)"
    ).run(nomTrim, nomNormalise, uniteDefaut || "kg", maxOrdre + 1);
    entry = await db.prepare("SELECT * FROM matieres_catalogue WHERE id = ?").get(info.lastInsertRowid);
  }
  return entry;
}

// -------------------------------------------------------------------------------------------------
// ESTIMATIONS DE COÛT — point de départ du workflow, avant tout achat/fournisseur/BC. Une seule
// estimation par article (find-or-create), entièrement modifiable tant qu'aucune commande n'a
// été lancée à partir d'elle.
// -------------------------------------------------------------------------------------------------
const CATEGORIES_ESTIMATION = ["matiere", "fourniture", "habillage", "emballage", "transport", "confection", "impression", "retouche", "autre"];
const MODES_CALCUL = ["consommation_prix", "unitaire_direct", "montant_global"];

async function getOuCreerEstimation(db, articleId) {
  let e = await db.prepare("SELECT * FROM estimations WHERE article_id = ?").get(articleId);
  if (!e) {
    const info = await db.prepare("INSERT INTO estimations (article_id) VALUES (?)").run(articleId);
    e = await db.prepare("SELECT * FROM estimations WHERE id = ?").get(info.lastInsertRowid);
    await preremplirLignesParDefaut(db, e.id);
  }
  return e;
}

// Copie chaque poste marqué "ajouter_automatiquement" dans une ligne réelle de la nouvelle
// estimation — une copie indépendante, jamais un lien vers le poste : modifier le poste plus tard
// dans Paramètres n'affecte donc jamais les estimations déjà créées (uniquement les futures).
async function preremplirLignesParDefaut(db, estimationId) {
  const entreprise = await db.prepare("SELECT taux_tva_defaut FROM entreprise WHERE id = 1").get();
  const tauxTva = entreprise ? entreprise.taux_tva_defaut : null;
  const postes = await db.prepare(
    "SELECT * FROM postes_cout_predefinis WHERE actif = 1 AND ajouter_automatiquement = 1 ORDER BY ordre ASC, LOWER(designation) COLLATE ucs_basic ASC"
  ).all();

  for (const poste of postes) {
    let unite = poste.unite_defaut;
    let quantite = poste.quantite_defaut;
    if (poste.mode_calcul_defaut === "unitaire_direct") {
      if (!unite) unite = "piece";
      if (quantite == null) quantite = 1;
    }
    await ajouterLigneEstimation(db, estimationId, {
      categorie: poste.categorie, designation: poste.designation, mode_calcul: poste.mode_calcul_defaut,
      unite, quantite, taux_tva: tauxTva,
    });
  }
}

async function mettreAJourEstimation(db, estimationId, patch) {
  if (patch.quantite_prevue !== undefined) {
    await db.prepare("UPDATE estimations SET quantite_prevue = ?, updated_at = maintenant() WHERE id = ?")
      .run(patch.quantite_prevue === "" ? null : Number(patch.quantite_prevue), estimationId);
  }
  return await db.prepare("SELECT * FROM estimations WHERE id = ?").get(estimationId);
}

async function ajouterLigneEstimation(db, estimationId, payload) {
  if (!CATEGORIES_ESTIMATION.includes(payload.categorie)) throw new Error(`Catégorie invalide : ${payload.categorie}`);
  if (!MODES_CALCUL.includes(payload.mode_calcul)) throw new Error(`Mode de calcul invalide : ${payload.mode_calcul}`);
  // Pas de désignation obligatoire à la création : la ligne apparaît immédiatement, vide, dans un
  // tableau de saisie rapide — l'utilisateur la remplit ensuite progressivement, sans pop-up.
  const designation = payload.designation ? payload.designation.trim() : "";
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM estimation_lignes WHERE estimation_id = ?").get(estimationId)).m || 0;
  const info = await db.prepare(
    "INSERT INTO estimation_lignes (estimation_id, categorie, designation, mode_calcul, quantite, unite, prix_unitaire_ht, montant_global_ht, taux_tva, ordre) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    estimationId, payload.categorie, designation, payload.mode_calcul,
    payload.quantite != null ? Number(payload.quantite) : null, payload.unite || null,
    payload.prix_unitaire_ht != null ? Number(payload.prix_unitaire_ht) : null,
    payload.montant_global_ht != null ? Number(payload.montant_global_ht) : null,
    payload.taux_tva != null ? Number(payload.taux_tva) : null, maxOrdre + 1
  );
  return await db.prepare("SELECT * FROM estimation_lignes WHERE id = ?").get(info.lastInsertRowid);
}

async function mettreAJourLigneEstimation(db, ligneId, patch) {
  const champs = ["categorie", "designation", "mode_calcul", "quantite", "unite", "prix_unitaire_ht", "montant_global_ht", "taux_tva"];
  const sets = [];
  const params = { id: ligneId };
  champs.forEach((c) => {
    if (patch[c] !== undefined) {
      sets.push(`${c} = @${c}`);
      params[c] = patch[c] === "" ? null : patch[c];
    }
  });
  if (sets.length > 0) {
    sets.push("updated_at = maintenant()");
    await db.prepare(`UPDATE estimation_lignes SET ${sets.join(", ")} WHERE id = @id`).run(params);
  }
  return await db.prepare("SELECT * FROM estimation_lignes WHERE id = ?").get(ligneId);
}

async function supprimerLigneEstimation(db, ligneId) {
  await db.prepare("DELETE FROM estimation_lignes WHERE id = ?").run(ligneId);
}

async function listLignesEstimation(db, estimationId) {
  return await db.prepare("SELECT * FROM estimation_lignes WHERE estimation_id = ? ORDER BY ordre ASC, id ASC").all(estimationId);
}

// Coût HT par pièce d'une ligne, selon son mode de calcul — jamais stocké, toujours dérivé.
function coutHtParPieceLigne(ligne, quantitePrevue) {
  if (ligne.mode_calcul === "consommation_prix") {
    if (ligne.quantite == null || ligne.prix_unitaire_ht == null) return 0;
    return ligne.quantite * ligne.prix_unitaire_ht;
  }
  if (ligne.mode_calcul === "unitaire_direct") {
    if (ligne.prix_unitaire_ht == null) return 0;
    // Quantité par défaut = 1 si jamais renseignée (compatibilité avec les lignes déjà existantes
    // créées avant que la quantité devienne modifiable sur ce mode) — jamais autre chose que 1,
    // jamais silencieusement ignorée si l'utilisateur l'a explicitement changée.
    const q = ligne.quantite != null ? ligne.quantite : 1;
    return q * ligne.prix_unitaire_ht;
  }
  // montant_global : réparti sur la quantité prévue de production
  if (!quantitePrevue || ligne.montant_global_ht == null) return 0;
  return ligne.montant_global_ht / quantitePrevue;
}

function coutTtcParPieceLigne(ligne, coutHt) {
  if (ligne.taux_tva == null) return coutHt;
  return coutHt * (1 + ligne.taux_tva / 100);
}

// Synthèse complète de l'estimation — coût HT/TTC par pièce, budget total, détail par catégorie.
// C'est cette fonction, et elle seule, qui alimente l'écran (aucun total recalculé côté frontend).
async function syntheseEstimation(db, estimationId) {
  const estimation = await db.prepare("SELECT * FROM estimations WHERE id = ?").get(estimationId);
  if (!estimation) throw new Error("Estimation introuvable.");
  const lignes = await listLignesEstimation(db, estimationId);
  const quantitePrevue = estimation.quantite_prevue;

  let coutHtParPiece = 0, coutTtcParPiece = 0;
  const parCategorie = {};
  const lignesAvecCout = lignes.map((l) => {
    const ht = coutHtParPieceLigne(l, quantitePrevue);
    const ttc = coutTtcParPieceLigne(l, ht);
    coutHtParPiece += ht;
    coutTtcParPiece += ttc;
    parCategorie[l.categorie] = (parCategorie[l.categorie] || 0) + ht;
    return { ...l, cout_ht_piece: ht, cout_ttc_piece: ttc };
  });

  return {
    estimation_id: estimationId,
    quantite_prevue: quantitePrevue,
    lignes: lignesAvecCout,
    cout_ht_piece: coutHtParPiece,
    cout_ttc_piece: coutTtcParPiece,
    budget_total_ht: quantitePrevue ? coutHtParPiece * quantitePrevue : null,
    budget_total_ttc: quantitePrevue ? coutTtcParPiece * quantitePrevue : null,
    par_categorie: parCategorie,
  };
}

// Simulation de prix bidirectionnelle — jamais imposée, jamais stockée à part le prix envisagé
// (réutilise articles.prix_vente_envisage, déjà existant) : le coefficient est toujours recalculé
// à l'affichage, jamais figé indépendamment du prix.
function simulationPrix(coutUnitaireHt, { coefficient, prixEnvisage }, quantiteCommercialisable) {
  let prix, coeff;
  if (prixEnvisage != null) {
    prix = prixEnvisage;
    coeff = coutUnitaireHt > 0 ? prix / coutUnitaireHt : null;
  } else if (coefficient != null) {
    coeff = coefficient;
    prix = coutUnitaireHt * coefficient;
  } else {
    return null;
  }
  const margeUnitaire = prix - coutUnitaireHt;
  const tauxMarge = prix > 0 ? (margeUnitaire / prix) * 100 : null;
  return {
    prix_vente: prix,
    coefficient: coeff,
    marge_unitaire: margeUnitaire,
    taux_marge: tauxMarge,
    marge_totale_estimee: quantiteCommercialisable ? margeUnitaire * quantiteCommercialisable : null,
  };
}

// Résumé de toutes les estimations existantes — pour la liste Coûts produits, sans appel répété
// par article.
async function listEstimationsResume(db) {
  const estimations = await db.prepare("SELECT * FROM estimations ORDER BY id").all();
  return await mapSeq(estimations, async e => {
    const s = await syntheseEstimation(db, e.id);
    return { article_id: e.article_id, estimation_id: e.id, quantite_prevue: e.quantite_prevue, nb_lignes: s.lignes.length, cout_ht_piece: s.cout_ht_piece, budget_total_ht: s.budget_total_ht };
  });
}

// Persist uniquement le prix de vente envisagé — jamais le coefficient, toujours recalculé à
// l'affichage (voir simulationPrix). Reste scopé à Finance plutôt que de toucher au module Articles.
async function mettreAJourPrixVenteEnvisage(db, articleId, prixVenteEnvisage) {
  await db.prepare("UPDATE articles SET prix_vente_envisage = ?, updated_at = maintenant() WHERE id = ?")
    .run(prixVenteEnvisage === "" || prixVenteEnvisage == null ? null : Number(prixVenteEnvisage), articleId);
  return await db.prepare("SELECT prix_vente_envisage FROM articles WHERE id = ?").get(articleId);
}

// -------------------------------------------------------------------------------------------------
// Vue globale des factures avec échéance, tous fournisseurs confondus — pour Échéances & paiements.
// Une échéance issue d'une facture est TOUJOURS dérivée de la facture (jamais ressaisie) : on part
// des factures elles-mêmes, en récupérant l'échéance liée si elle existe. Le statut et le "déjà
// payé" réutilisent exactement statutFacture, jamais une deuxième logique.
// -------------------------------------------------------------------------------------------------
async function listFacturesAvecEcheances(db, filtres) {
  filtres = filtres || {};
  const rows = await db.prepare(`
    SELECT af.id AS facture_id, af.reference_facture, af.date_facture, af.montant_ht, af.montant_tva,
           a.fournisseur_id, f.nom AS fournisseur_nom, f.mode_paiement_defaut,
           ech.date_echeance
    FROM achats_factures af
    JOIN achats a ON a.id = af.achat_id
    JOIN fournisseurs f ON f.id = a.fournisseur_id
    LEFT JOIN echeances ech ON ech.achat_facture_id = af.id
    ORDER BY af.id, ech.id
  `).all();

  const aujourdHui = new Date().toISOString().slice(0, 10);
  const dans7j = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const dans30j = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const debutMois = aujourdHui.slice(0, 7) + "-01";
  const finMois = new Date(new Date(aujourdHui).getFullYear(), new Date(aujourdHui).getMonth() + 1, 0).toISOString().slice(0, 10);

  return (await mapSeq(rows, async r => {
      const st = await statutFacture(db, r.facture_id);
      const ttc = r.montant_ht + (r.montant_tva || 0);
      let statut;
      const enRetard = r.date_echeance && r.date_echeance < aujourdHui && st.reste_du > 1e-9;
      if (st.statut === "payee") statut = "payee";
      else if (enRetard) statut = "en_retard";
      else if (st.statut === "partiellement_payee") statut = "partiel";
      else statut = "a_payer";
      return {
        facture_id: r.facture_id, reference_facture: r.reference_facture, fournisseur_nom: r.fournisseur_nom,
        date_facture: r.date_facture, date_echeance: r.date_echeance, montant_ttc: ttc,
        mode_prevu: r.mode_paiement_defaut, paye: st.paye, reste: st.reste_du, statut,
      };
    }))
    .filter((r) => {
      if (filtres.statutFiltre === "en_retard") return r.statut === "en_retard";
      if (filtres.statutFiltre === "7j") return r.date_echeance && r.date_echeance >= aujourdHui && r.date_echeance <= dans7j;
      if (filtres.statutFiltre === "30j") return r.date_echeance && r.date_echeance >= aujourdHui && r.date_echeance <= dans30j;
      if (filtres.statutFiltre === "ce_mois") return r.date_echeance && r.date_echeance >= debutMois && r.date_echeance <= finMois;
      return true; // "toutes"
    })
    .sort((a, b) => (a.date_echeance || "9999").localeCompare(b.date_echeance || "9999"));
}

// Vue globale des paiements/avances, tous fournisseurs — réutilise creditNonAffecte pour le non
// affecté, jamais une deuxième formule.
async function listPaiementsEtAvances(db) {
  const rows = await db.prepare(`
    SELECT p.*, f.nom AS fournisseur_nom FROM paiements p JOIN fournisseurs f ON f.id = p.fournisseur_id
    ORDER BY p.date_paiement DESC, p.id DESC
  `).all();
  return await mapSeq(rows, async p => {
    const affecte = await montantDejaAffecteDuPaiement(db, p.id);
    const nonAffecte = p.montant - affecte;
    return {
      ...p, affecte, non_affecte: nonAffecte,
      statut: nonAffecte <= 1e-9 ? "totalement_affecte" : affecte > 1e-9 ? "partiellement_affecte" : "non_affecte",
    };
  });
}

// -------------------------------------------------------------------------------------------------
// POSTES DE COÛT PRÉDÉFINIS — les habitudes de calcul propres à l'utilisateur, jamais un catalogue
// fournisseur. Sert uniquement à préremplir une nouvelle ligne d'estimation ; la ligne créée est
// une copie indépendante, jamais liée au poste après coup (modifiable librement ensuite).
// -------------------------------------------------------------------------------------------------
async function listPostesCout(db, options) {
  options = options || {};
  const where = options.includeInactifs ? "" : "WHERE actif = 1";
  return await db.prepare(`SELECT * FROM postes_cout_predefinis ${where} ORDER BY ordre ASC, LOWER(designation) COLLATE ucs_basic ASC`).all();
}

// Normalise pour une comparaison insensible à la casse ET aux accents — SQLite'LOWER(s) COLLATE ucs_basic ne
// gère que l'ASCII (É ne correspond jamais à é autrement), d'où ce filtrage fait côté JS.
function normaliserPourRecherche(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

async function rechercherPostesCout(db, requete, limite, categorie) {
  const q = normaliserPourRecherche(requete);
  let tous = await db.prepare("SELECT * FROM postes_cout_predefinis WHERE actif = 1 ORDER BY LOWER(designation) COLLATE ucs_basic ASC").all();
  if (categorie) tous = tous.filter((p) => p.categorie === categorie);
  return tous.filter((p) => normaliserPourRecherche(p.designation).includes(q)).slice(0, limite || 10);
}

async function creerPosteCout(db, payload) {
  if (!CATEGORIES_ESTIMATION.includes(payload.categorie)) throw new Error(`Catégorie invalide : ${payload.categorie}`);
  if (!MODES_CALCUL.includes(payload.mode_calcul_defaut)) throw new Error(`Mode de calcul invalide : ${payload.mode_calcul_defaut}`);
  if (!payload.designation || !payload.designation.trim()) throw new Error("La désignation est obligatoire.");
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM postes_cout_predefinis").get()).m || 0;
  const info = await db.prepare(
    "INSERT INTO postes_cout_predefinis (categorie, designation, unite_defaut, mode_calcul_defaut, quantite_defaut, ajouter_automatiquement, ordre) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(payload.categorie, payload.designation.trim(), payload.unite_defaut || null, payload.mode_calcul_defaut,
    payload.quantite_defaut != null ? Number(payload.quantite_defaut) : null, payload.ajouter_automatiquement ? 1 : 0, maxOrdre + 1);
  return await db.prepare("SELECT * FROM postes_cout_predefinis WHERE id = ?").get(info.lastInsertRowid);
}

async function mettreAJourPosteCout(db, id, patch) {
  const champs = ["categorie", "designation", "unite_defaut", "mode_calcul_defaut", "quantite_defaut", "ajouter_automatiquement", "actif"];
  const sets = [];
  const params = { id };
  champs.forEach((c) => {
    if (patch[c] !== undefined) {
      sets.push(`${c} = @${c}`);
      params[c] = patch[c] === "" ? null : patch[c];
    }
  });
  if (sets.length > 0) await db.prepare(`UPDATE postes_cout_predefinis SET ${sets.join(", ")} WHERE id = @id`).run(params);
  return await db.prepare("SELECT * FROM postes_cout_predefinis WHERE id = ?").get(id);
}

async function supprimerPosteCout(db, id) {
  await db.prepare("DELETE FROM postes_cout_predefinis WHERE id = ?").run(id);
}

// Supprime uniquement l'estimation de travail (et ses lignes, via ON DELETE CASCADE) — ne touche
// JAMAIS l'article lui-même. Aucun risque pour un snapshot déjà figé au BC : cette table est une
// copie indépendante (commande_cout_previsionnel_lignes ne référence que commandes, jamais
// estimations) — supprimer l'estimation de travail ne peut donc jamais l'affecter.
async function supprimerEstimation(db, estimationId) {
  await db.prepare("DELETE FROM estimations WHERE id = ?").run(estimationId);
}

module.exports = {
  creerFournisseur, mettreAJourFournisseur, listFournisseurs, getFournisseur,
  ajouterPrixFournisseur, listPrixFournisseur, prixEnVigueur,
  creerAchat, getAchat, listAchats,
  ajouterReceptionAchat, listReceptionsAchat, quantiteRecueAchat,
  ajouterFactureAchat, listFacturesAchat, getFacture,
  coutAchat,
  estCategorieStockable, listLotsMatiere, stockDisponibleMatiere, affecterConsommationMatiere,
  syntheseStockMatiere, comparaisonConsommationCommande,
  affecterAchat, quantiteDisponibleAchat, listAffectationsAchat, coutAffectation,
  coutCommande,
  creerPaiement, listPaiementsFournisseur,
  affecterPaiement, creditNonAffecte, statutFacture, detteFournisseur,
  ajouterEcheance, listEcheances, calculerEcheanceSuggeree, listFacturesFournisseur,
  ajouterReceptionProduction, enregistrerRetoucheReussie, listReceptionsProduction, quantiteCommercialisableCommande,
  syntheseCoutCommande,
  syntheseGlobale, listEcheancesDetaillees, listFournisseursAvecSynthese, listAchatsDetailles,
  listMatieresCatalogue, trouverOuCreerMatiereCatalogue,
  getOuCreerEstimation, mettreAJourEstimation, supprimerEstimation, ajouterLigneEstimation, mettreAJourLigneEstimation,
  supprimerLigneEstimation, listLignesEstimation, syntheseEstimation, simulationPrix, listEstimationsResume,
  mettreAJourPrixVenteEnvisage,
  listFacturesAvecEcheances, listPaiementsEtAvances,
  listPostesCout, rechercherPostesCout, creerPosteCout, mettreAJourPosteCout, supprimerPosteCout,
};
