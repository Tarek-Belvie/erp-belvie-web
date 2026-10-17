const crypto = require("crypto");
const DEFAULTS = require("./defaults");
const { normalizeNom } = require("./normalize");
const { genererReferencePrincipale, prochainSequentiel } = require("./references");

function iso(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 10);
}
function isoDateTime(daysOffset) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 19).replace("T", " ");
}

// Refuse de charger la démo par-dessus de vraies données, pour ne jamais mélanger les deux.
async function assertPeutChargerDemo(db) {
  const n = (await db.prepare("SELECT COUNT(*) AS n FROM commandes").get()).n;
  if (n > 0) {
    throw new Error(
      "Des commandes existent déjà dans cette base. Le jeu de données de démonstration ne peut être chargé " +
      "que sur une installation vierge, pour ne jamais mélanger données réelles et fictives."
    );
  }
}

async function upsertListe(db, type, nom) {
  const norm = normalizeNom(nom);
  const found = await db.prepare("SELECT id, actif FROM listes_valeurs WHERE type = ? AND nom_normalise = ?").get(type, norm);
  if (found) {
    if (!found.actif) await db.prepare("UPDATE listes_valeurs SET actif = 1 WHERE id = ?").run(found.id);
    return found.id;
  }
  const info = await db.prepare("INSERT INTO listes_valeurs (type, nom, nom_normalise) VALUES (?, ?, ?)").run(type, nom, norm);
  return info.lastInsertRowid;
}

// Charge un jeu complet de données de démonstration (produits, couleurs, responsables, ateliers,
// opérateurs, articles avec de vraies références générées, commandes couvrant tous les statuts,
// historique). N'est JAMAIS appelé automatiquement — uniquement via une action explicite de
// l'utilisateur (bouton "Charger des données de démonstration" dans Paramètres).
async function loadDemoData(db) {
  const run = db.transaction(async () => {
    await assertPeutChargerDemo(db);

    for (const n of DEFAULTS.DEMO_PRODUITS) {
      await upsertListe(db, "produit", n);
    }

    for (const n of DEFAULTS.DEMO_COULEURS) {
      await upsertListe(db, "couleur", n);
    }

    for (const n of DEFAULTS.DEMO_RESPONSABLES) {
      await upsertListe(db, "responsable", n);
    }

    for (const n of DEFAULTS.DEMO_ATELIERS) {
      await upsertListe(db, "atelier", n);
    }

    for (const n of DEFAULTS.DEMO_OPERATEURS) {
      await upsertListe(db, "operateur", n);
    }

    const idFor = async (type, nom) => (await db.prepare("SELECT id FROM listes_valeurs WHERE type = ? AND nom_normalise = ?").get(type, normalizeNom(nom))).id;

    // --- Articles de démonstration, avec de vraies références générées ---
    const insertArticle = db.prepare(`
      INSERT INTO articles
        (uuid, produit_id, saison_id, annee_collection, rayon_id, abreviation, numero_sequentiel, reference_principale, est_demo)
      VALUES (@uuid, @produit_id, @saison_id, @annee_collection, @rayon_id, @abreviation, @numero_sequentiel, @reference_principale, 1)
    `);
    const specs = [
      { produit: "T-shirt Essentiel", saison: "Été", annee: 2026, rayon: "Unisexe", abreviation: "TSH" },
      { produit: "Robe Aya", saison: "Printemps–Été", annee: 2026, rayon: "Femme", abreviation: "ROB" },
      { produit: "Veste Denim", saison: "Automne–Hiver", annee: 2026, rayon: "Homme", abreviation: "VES" },
      { produit: "Chemise Lin", saison: "Été", annee: 2025, rayon: "Homme", abreviation: "CHE" },
      { produit: "Pantalon Nara", saison: "Automne–Hiver", annee: 2026, rayon: "Femme", abreviation: "PAN" },
      { produit: "Blouse Soie", saison: "Printemps–Été", annee: 2026, rayon: "Femme", abreviation: "BLO" },
    ];
    const articleIdByProduit = {};
    for (const s of specs) {
      const produit_id = await idFor("produit", s.produit);
      const saisonRow = await db.prepare("SELECT id, code FROM listes_valeurs WHERE type='saison' AND nom_normalise=?").get(normalizeNom(s.saison));
      const rayonRow = await db.prepare("SELECT id, code FROM listes_valeurs WHERE type='rayon' AND nom_normalise=?").get(normalizeNom(s.rayon));
      const sequentiel = await prochainSequentiel(db, { saisonId: saisonRow.id, annee: s.annee, rayonId: rayonRow.id, abreviation: s.abreviation });
      const reference_principale = genererReferencePrincipale({
        saisonCode: saisonRow.code, annee: s.annee, rayonCode: rayonRow.code, abreviation: s.abreviation, sequentiel,
      });
      const info = await insertArticle.run({
        uuid: crypto.randomUUID(), produit_id, saison_id: saisonRow.id, annee_collection: s.annee,
        rayon_id: rayonRow.id, abreviation: s.abreviation, numero_sequentiel: sequentiel, reference_principale,
      });
      articleIdByProduit[s.produit] = info.lastInsertRowid;
    }
    const articleIdFor = (produitNom) => articleIdByProduit[produitNom];
    const refFor = async produitNom => (await db.prepare("SELECT reference_principale FROM articles WHERE id = ?").get(articleIdFor(produitNom))).reference_principale;

    // --- Commandes de démonstration, une par statut du cycle de vie ---
    const etapeIdByCle = Object.fromEntries((await db.prepare("SELECT id, cle FROM etapes").all()).map((e) => [e.cle, e.id]));
    const t = async nom => await idFor("taille", nom);
    const c = async nom => await idFor("couleur", nom);
    const opAmal = await idFor("operateur", "Amal");
    const opKarim = await idFor("operateur", "Karim");

    const insertCmd = db.prepare(`
      INSERT INTO commandes
        (uuid, numero, article_id, type_production, reference_production, responsable_nom, atelier_id, quantite_totale,
         date_lancement, date_fin_prevue, etape_id, statut, priorite, bloquee, blocage_motif,
         bloquee_le, bloquee_par_id, valide_le, valide_par_id, lance_le, lance_par_id,
         controle_qualite_le, controle_qualite_par_id, terminee_le, terminee_par_id,
         annulee_le, annulee_par_id, annulation_motif, archived_le, archived_par_id,
         commentaires, archived, est_demo)
      VALUES
        (@uuid, @numero, @article_id, 'nouveau', @reference_production, @responsable_nom, @atelier_id, @quantite_totale,
         @date_lancement, @date_fin_prevue, @etape_id, @statut, @priorite, @bloquee, @blocage_motif,
         @bloquee_le, @bloquee_par_id, @valide_le, @valide_par_id, @lance_le, @lance_par_id,
         @controle_qualite_le, @controle_qualite_par_id, @terminee_le, @terminee_par_id,
         @annulee_le, @annulee_par_id, @annulation_motif, @archived_le, @archived_par_id,
         @commentaires, @archived, 1)
    `);
    const insertLigne = db.prepare("INSERT INTO commande_lignes (commande_id, couleur_id, taille_id, quantite) VALUES (?, ?, ?, ?)");
    const insertHistorique = db.prepare(`
      INSERT INTO historique_transitions (commande_id, type_evenement, operateur_id, motif, survenu_le)
      VALUES (?, ?, ?, ?, ?)
    `);

    const annee = new Date().getFullYear();
    const numero = (n) => `CMD-${annee}-${String(n).padStart(3, "0")}`;
    const N = { bloquee: 0, blocage_motif: null, bloquee_le: null, bloquee_par_id: null };
    const V = { valide_le: null, valide_par_id: null };
    const L = { lance_le: null, lance_par_id: null };
    const CQ = { controle_qualite_le: null, controle_qualite_par_id: null };
    const T = { terminee_le: null, terminee_par_id: null };
    const A = { annulee_le: null, annulee_par_id: null, annulation_motif: null };
    const ARC = { archived_le: null, archived_par_id: null };

    const demo = [
      {
        numero: numero(1), article_id: articleIdFor("T-shirt Essentiel"), reference_production: await refFor("T-shirt Essentiel"),
        responsable_nom: "Sami", atelier_id: await idFor("atelier", "Atelier interne Belvie"),
        date_lancement: iso(-12), date_fin_prevue: iso(2), etape_id: etapeIdByCle.controle_qualite,
        statut: "en_production", priorite: "haute",
        bloquee: 1, blocage_motif: "Rupture de fil de couleur assortie", bloquee_le: isoDateTime(-1), bloquee_par_id: opKarim,
        valide_le: isoDateTime(-13), valide_par_id: opAmal, lance_le: isoDateTime(-12), lance_par_id: opAmal,
        ...CQ, ...T, ...A, ...ARC,
        commentaires: "Livraison boutique flagship.", archived: 0,
        lignes: [
          { couleur_id: await c("Blanc"), taille_id: await t("S"), quantite: 40 },
          { couleur_id: await c("Blanc"), taille_id: await t("M"), quantite: 80 },
          { couleur_id: await c("Noir"), taille_id: await t("M"), quantite: 90 },
          { couleur_id: await c("Noir"), taille_id: await t("XL"), quantite: 110 },
        ],
        historique: [
          { type: "validation", op: opAmal, motif: null, quand: isoDateTime(-13) },
          { type: "lancement", op: opAmal, motif: null, quand: isoDateTime(-12) },
          { type: "blocage", op: opKarim, motif: "Rupture de fil de couleur assortie", quand: isoDateTime(-1) },
        ],
      },
      {
        numero: numero(2), article_id: articleIdFor("Robe Aya"), reference_production: await refFor("Robe Aya"),
        responsable_nom: "Nour", atelier_id: await idFor("atelier", "Atelier Mme Ibtissem"),
        date_lancement: iso(-20), date_fin_prevue: iso(-3), etape_id: etapeIdByCle.controle_qualite,
        statut: "controle_qualite", priorite: "haute", ...N,
        valide_le: isoDateTime(-21), valide_par_id: opKarim, lance_le: isoDateTime(-20), lance_par_id: opKarim,
        controle_qualite_le: isoDateTime(-2), controle_qualite_par_id: opAmal,
        ...T, ...A, ...ARC,
        commentaires: "Contrôle final avant expédition.", archived: 0,
        lignes: [
          { couleur_id: await c("Terracotta"), taille_id: await t("S"), quantite: 20 },
          { couleur_id: await c("Terracotta"), taille_id: await t("M"), quantite: 40 },
          { couleur_id: await c("Ecru"), taille_id: await t("L"), quantite: 25 },
        ],
        historique: [
          { type: "validation", op: opKarim, motif: null, quand: isoDateTime(-21) },
          { type: "lancement", op: opKarim, motif: null, quand: isoDateTime(-20) },
          { type: "entree_controle_qualite", op: opAmal, motif: null, quand: isoDateTime(-2) },
        ],
      },
      {
        numero: numero(3), article_id: articleIdFor("Veste Denim"), reference_production: await refFor("Veste Denim"),
        responsable_nom: "Amine", atelier_id: await idFor("atelier", "Atelier externe X"),
        date_lancement: iso(-5), date_fin_prevue: iso(9), etape_id: etapeIdByCle.confection,
        statut: "en_production", priorite: "normale", ...N,
        valide_le: isoDateTime(-6), valide_par_id: opAmal, lance_le: isoDateTime(-5), lance_par_id: opAmal,
        ...CQ, ...T, ...A, ...ARC,
        commentaires: null, archived: 0,
        lignes: [
          { couleur_id: await c("Bleu indigo"), taille_id: await t("M"), quantite: 25 },
          { couleur_id: await c("Bleu indigo"), taille_id: await t("L"), quantite: 35 },
        ],
        historique: [
          { type: "validation", op: opAmal, motif: null, quand: isoDateTime(-6) },
          { type: "lancement", op: opAmal, motif: null, quand: isoDateTime(-5) },
        ],
      },
      {
        numero: numero(4), article_id: articleIdFor("Chemise Lin"), reference_production: await refFor("Chemise Lin"),
        responsable_nom: "Hela", atelier_id: await idFor("atelier", "Atelier interne Belvie"),
        date_lancement: iso(-30), date_fin_prevue: iso(-15), etape_id: etapeIdByCle.terminee,
        statut: "terminee", priorite: "normale", ...N,
        valide_le: isoDateTime(-31), valide_par_id: opKarim, lance_le: isoDateTime(-30), lance_par_id: opKarim,
        controle_qualite_le: isoDateTime(-17), controle_qualite_par_id: opAmal,
        terminee_le: isoDateTime(-15), terminee_par_id: opAmal,
        ...A,
        archived_le: isoDateTime(-14), archived_par_id: opAmal,
        commentaires: "Expédiée.", archived: 1,
        lignes: [
          { couleur_id: await c("Ecru"), taille_id: await t("S"), quantite: 50 },
          { couleur_id: await c("Ecru"), taille_id: await t("M"), quantite: 90 },
        ],
        historique: [
          { type: "validation", op: opKarim, motif: null, quand: isoDateTime(-31) },
          { type: "lancement", op: opKarim, motif: null, quand: isoDateTime(-30) },
          { type: "entree_controle_qualite", op: opAmal, motif: null, quand: isoDateTime(-17) },
          { type: "fin_production", op: opAmal, motif: null, quand: isoDateTime(-15) },
          { type: "archivage", op: opAmal, motif: null, quand: isoDateTime(-14) },
        ],
      },
      {
        numero: null, article_id: articleIdFor("Pantalon Nara"), reference_production: null,
        responsable_nom: "Youssef", atelier_id: await idFor("atelier", "Atelier Mme Ibtissem"),
        date_lancement: iso(-2), date_fin_prevue: iso(18), etape_id: etapeIdByCle.preparation,
        statut: "brouillon", priorite: "faible", ...N, ...V, ...L, ...CQ, ...T, ...A, ...ARC,
        commentaires: "Attente validation fiche technique.", archived: 0,
        lignes: [
          { couleur_id: await c("Kaki"), taille_id: await t("M"), quantite: 100 },
          { couleur_id: await c("Kaki"), taille_id: await t("L"), quantite: 120 },
        ],
        historique: [],
      },
      {
        numero: numero(5), article_id: articleIdFor("Blouse Soie"), reference_production: await refFor("Blouse Soie"),
        responsable_nom: "Nour", atelier_id: await idFor("atelier", "Atelier interne Belvie"),
        date_lancement: iso(-9), date_fin_prevue: iso(1), etape_id: etapeIdByCle.preparation,
        statut: "annulee", priorite: "normale", ...N,
        valide_le: isoDateTime(-10), valide_par_id: opAmal, ...L, ...CQ, ...T,
        annulee_le: isoDateTime(-8), annulee_par_id: opKarim, annulation_motif: "Commande client annulée en amont.",
        ...ARC,
        commentaires: null, archived: 0,
        lignes: [{ couleur_id: await c("Noir"), taille_id: await t("M"), quantite: 60 }],
        historique: [
          { type: "validation", op: opAmal, motif: null, quand: isoDateTime(-10) },
          { type: "annulation", op: opKarim, motif: "Commande client annulée en amont.", quand: isoDateTime(-8) },
        ],
      },
    ];

    for (const r of demo) {
      const { lignes, historique, ...commandeFields } = r;
      const quantite_totale = lignes.reduce((sum, l) => sum + l.quantite, 0);
      const info = await insertCmd.run({ ...commandeFields, uuid: crypto.randomUUID(), quantite_totale });

      for (const l of lignes) {
        await insertLigne.run(info.lastInsertRowid, l.couleur_id, l.taille_id, l.quantite);
      }

      for (const h of historique) {
        await insertHistorique.run(info.lastInsertRowid, h.type, h.op, h.motif, h.quand);
      }
    }

    const dernierNumero = demo.filter((r) => r.numero).length;
    await db.prepare(`
      INSERT INTO compteurs (annee, dernier_numero) VALUES (?, ?)
      ON CONFLICT(annee) DO UPDATE SET dernier_numero = MAX(dernier_numero, excluded.dernier_numero)
    `).run(annee, dernierNumero);

    await db.prepare("INSERT OR REPLACE INTO parametres (cle, valeur) VALUES ('operateur_actif_id', ?)").run(String(opAmal));

    return { commandes: demo.length, articles: specs.length };
  });
  return await run();
}

module.exports = { loadDemoData };
