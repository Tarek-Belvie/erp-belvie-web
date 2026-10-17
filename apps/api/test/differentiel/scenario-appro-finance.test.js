// ================================================================================================
// Scénario différentiel — APPROVISIONNEMENT (besoins, préparation et BC MP) et FINANCE.
// Tout est construit depuis une installation neuve, uniquement par les canaux de l'API.
// ================================================================================================
require("../../src/config").chargerConfiguration(); // avant le harnais, qui lit DATABASE_URL au chargement
const test = require("node:test");
const assert = require("node:assert/strict");
const { scenario } = require("./outils");

// ------------------------------------------------------------------------------------------------
// Socle commun : référentiels, article, grille de tailles, fiche technique riche, commandes.
// ------------------------------------------------------------------------------------------------
async function socle({ appeler, refuse }) {
  const cat = (await appeler("listes:list", "categorie")).find((v) => v.nom === "Vestes et Blousons");
  const produit = await appeler("listes:create", "produit", "Veste test", { parent_id: cat.id });
  await refuse("listes:create", "categorie", "vestes et blousons");
  const saison = (await appeler("listes:list", "saison")).find((v) => v.code === "SS");
  const rayon = (await appeler("listes:list", "rayon")).find((v) => v.code === "M");
  const atelier = await appeler("listes:create", "atelier", "Atelier Sfax");
  const operateur = await appeler("listes:create", "operateur", "Opérateur Un");
  const noir = await appeler("listes:create", "couleur", "Noir");
  const marine = await appeler("listes:create", "couleur", "Marine");
  const sable = await appeler("listes:create", "couleur", "Sable");
  await appeler("parametres:setOperateurActif", operateur.id);

  const grille = await appeler("grillesTailles:creer", "Lettres test");
  for (const v of ["S", "M", "L"]) await appeler("grillesTailles:ajouterValeur", grille.id, v);
  const g = await appeler("grillesTailles:get", grille.id);
  const tailles = g.valeurs;
  await appeler("grillesTailles:setPourProduit", produit.id, grille.id);

  const article = await appeler("articles:create", { produit_id: produit.id, saison_id: saison.id, rayon_id: rayon.id, annee_collection: 2026, abreviation: "VES", designation: "Veste coton" });
  const fiche = await appeler("ficheTechnique:getOrCreateByArticleId", article.id);
  await appeler("ficheTechnique:definirGrille", fiche.id, grille.id, {});
  for (const t of tailles) await appeler("ficheTechnique:selectionnerTaille", fiche.id, t.id);
  const ftTailles = (await appeler("ficheTechnique:get", fiche.id)).grille.tailles;

  // Matières : fixe avec coloris, par taille, sans consommation (anomalie), hors catalogue.
  const tissu = await appeler("ficheTechnique:addMatiere", fiche.id, { nom: "Coton sergé", unite: "m", consommation_technique: 1.6, perte_pourcent: 5 });
  const tissuColNoir = await appeler("ficheTechnique:createMatiereCouleur", tissu.matiere_catalogue_id, { libelle: "Noir 001", code: "N1" });
  const tissuColMarine = await appeler("ficheTechnique:createMatiereCouleur", tissu.matiere_catalogue_id, { libelle: "Marine 002" });
  await refuse("ficheTechnique:createMatiereCouleur", tissu.matiere_catalogue_id, { libelle: "Noir 001" });
  await appeler("ficheTechnique:addMatiereCouleur", tissu.id, { couleur_produit_id: noir.id, matiere_couleur_id: tissuColNoir.id });
  await appeler("ficheTechnique:addMatiereCouleur", tissu.id, { couleur_produit_id: marine.id, matiere_couleur_id: tissuColMarine.id });
  const doublure = await appeler("ficheTechnique:addMatiere", fiche.id, { nom: "Doublure satin", unite: "m", mode_consommation: "par_taille", perte_pourcent: 3 });
  await appeler("ficheTechnique:setConsommationTaille", doublure.id, ftTailles[0].id, 0.9);
  await appeler("ficheTechnique:setConsommationTaille", doublure.id, ftTailles[1].id, 1.05);
  // Taille L volontairement sans consommation → consommation_taille_absente.
  const ouate = await appeler("ficheTechnique:addMatiere", fiche.id, { nom: "Ouate", unite: "kg" });
  // Fournitures : sans coloris (cible *), avec coloris (dont un non choisi), sans unité, conso ≤ 0.
  const fil = await appeler("ficheTechnique:addAccessoire", fiche.id, { nom: "Fil polyester", famille: "composant", unite: "bobine", consommation_par_piece: 0.05 });
  const zip = await appeler("ficheTechnique:addAccessoire", fiche.id, { nom: "Zip 60 cm", famille: "composant", unite: "piece", consommation_par_piece: 1, reference: "YKK-60" });
  await appeler("ficheTechnique:addFournitureCouleur", zip.id, { couleur_produit_id: noir.id, couleur_fourniture: "Noir 580", reference: "YKK-60-N" });
  await appeler("ficheTechnique:addFournitureCouleur", zip.id, { couleur_produit_id: marine.id, couleur_fourniture: "", consommation_par_piece: 1 });
  await refuse("ficheTechnique:addFournitureCouleur", zip.id, { couleur_produit_id: noir.id, couleur_fourniture: "Doublon" });
  const etiquette = await appeler("ficheTechnique:addAccessoire", fiche.id, { nom: "Étiquette composition", famille: "habillage", consommation_par_piece: 1 });
  const bouton = await appeler("ficheTechnique:addAccessoire", fiche.id, { nom: "Bouton 18L", famille: "composant", unite: "piece", consommation_par_piece: 0 });

  const etapes = await appeler("etapes:list");
  const base = { responsable_nom: "Karim", atelier_id: atelier.id, etape_id: etapes[0].id, date_lancement: "2026-03-01", date_fin_prevue: "2026-04-15" };
  const lignes = (q) => [
    { couleur_id: noir.id, taille_id: tailles[0].id, quantite: 10 * q }, { couleur_id: noir.id, taille_id: tailles[1].id, quantite: 20 * q },
    { couleur_id: noir.id, taille_id: tailles[2].id, quantite: 5 * q }, { couleur_id: marine.id, taille_id: tailles[1].id, quantite: 15 * q },
    { couleur_id: sable.id, taille_id: tailles[0].id, quantite: 7 * q },
  ];
  const c1 = await appeler("commandes:create", { ...base, article_id: article.id, lignes: lignes(1) });
  await appeler("commandes:valider", c1.id);
  const c2 = await appeler("commandes:create", { ...base, article_id: article.id, type_production: "reassort", lignes: lignes(2), date_fin_prevue: "2026-05-01" });
  await appeler("commandes:valider", c2.id);
  const c3 = await appeler("commandes:create", { ...base, article_id: article.id, type_production: "reassort", lignes: lignes(1) }); // reste brouillon
  return { article, fiche, tissu, tissuColNoir, doublure, ouate, fil, zip, etiquette, bouton, noir, marine, sable, tailles, c1, c2, c3 };
}

// ------------------------------------------------------------------------------------------------
test("besoins, simulation et préparation des BC MP", (t) => scenario(t, "appro", async (m) => {
  const { appeler, refuse } = m;
  const s = await socle(m);
  const { c1, c2, c3 } = s;

  for (const c of [c1, c2, c3]) await appeler("approvisionnement:calculerBesoins", c.id);
  // Garde-fou : le scénario exerce bien les anomalies attendues (sinon il ne prouverait rien).
  const res1 = await appeler("approvisionnement:calculerBesoins", c1.id);
  const codes = new Set(res1.lignes.flatMap((l) => l.anomalies || []));
  for (const c of ["consommation_absente", "consommation_taille_absente", "unite_absente", "consommation_invalide", "correspondance_couleur_absente", "coloris_non_choisi"]) assert.ok(codes.has(c), "anomalie non exercée : " + c);
  assert.equal((await appeler("approvisionnement:calculerBesoins", c1.id, { lignes_simulees: [{ couleur_id: s.noir.id, taille_id: s.tailles[0].id, quantite: 1 }] })).simulation, true);
  await appeler("approvisionnement:calculerBesoins", c1.id, { lignes_simulees: [{ couleur_id: s.noir.id, taille_id: s.tailles[0].id, quantite: 100 }, { couleur_id: 99999, taille_id: s.tailles[0].id, quantite: 3 }] });
  await appeler("approvisionnement:calculerBesoins", c1.id, { lignes_simulees: [{ couleur_id: s.sable.id, taille_id: s.tailles[0].id, quantite: "abc" }] });
  await appeler("approvisionnement:calculerBesoins", c1.id, {});
  await appeler("approvisionnement:calculerBesoins", 99999).catch(() => {});
  await appeler("approvisionnement:etatsApprovisionnement", [c1.id, c2.id, c3.id, 99999]);
  await appeler("approvisionnement:etatsApprovisionnement", []);
  // commandes:besoinsMatieres (hors périmètre : commandes.js) — GROUP BY strict, signalé.
  const reg = await appeler("bcMp:regrouper", [c1.id, c2.id]);
  await appeler("bcMp:regrouper", [c1.id, c3.id, 99999]);

  // Fournisseurs et tarifs (servent à la proposition de fournisseur).
  const f1 = await appeler("finance:creerFournisseur", { nom: "Tissages du Nord", conditions_paiement_defaut: "30 jours" });
  const f2 = await appeler("finance:creerFournisseur", { nom: "Mercerie Centrale" });
  await appeler("finance:ajouterPrixFournisseur", { fournisseur_id: f1.id, matiere_catalogue_id: s.tissu.matiere_catalogue_id, designation: "Coton sergé", unite: "m", prix_ht: 6.4, date_debut_validite: "2026-01-01" });
  await appeler("finance:ajouterPrixFournisseur", { fournisseur_id: f1.id, matiere_catalogue_id: s.tissu.matiere_catalogue_id, designation: "Coton sergé", unite: "m", prix_ht: 6.9, date_debut_validite: "2026-02-01" });
  await appeler("finance:ajouterPrixFournisseur", { fournisseur_id: f2.id, accessoire_catalogue_id: s.zip.accessoire_catalogue_id, designation: "Zip 60 cm", unite: "piece", prix_ht: 0.45, date_debut_validite: "2026-01-01" });
  await appeler("bcMp:regrouper", [c1.id, c2.id]);

  // Création : refus métier puis nominal.
  await refuse("bcMp:creer", {});
  await refuse("bcMp:creer", { fournisseur_id: 99999 });
  await refuse("bcMp:creerLot", []);
  await refuse("bcMp:creerLot", [{ fournisseur_id: f1.id }, { fournisseur_id: f1.id }]);
  const ligneTissu = {
    type: "matiere", matiere_catalogue_id: s.tissu.matiere_catalogue_id, designation: "Coton sergé", couleur: "Noir 001", unite: "m", unite_fiche: "m",
    conditionnement_libelle: "Rouleau 50 m", conditionnement_quantite: 50, nombre_conditionnements: 3, prix_unitaire_ht: 6.9,
    productions: [{ commande_id: c1.id, poids: 63.84 }, { commande_id: c2.id, poids: 127.68 }],
  };
  const b1 = await appeler("bcMp:creer", { fournisseur_id: f1.id, date_commande: "2026-03-02", notes: "Urgent", lignes: [ligneTissu] });
  const lot = await appeler("bcMp:creerLot", [
    { fournisseur_id: f2.id, date_commande: "2026-03-03", lignes: [
      { type: "fourniture", accessoire_catalogue_id: s.zip.accessoire_catalogue_id, designation: "Zip 60 cm", couleur: "Noir 580", unite: "piece", quantite: 105, prix_unitaire_ht: 0.45, productions: [{ commande_id: c1.id, quantite_affectee: 35 }, { commande_id: c2.id, quantite_affectee: 70 }] },
      { type: "fourniture", designation: "Fil polyester", unite: "piece", unite_fiche: "bobine", quantite: 12, productions: [{ commande_id: c1.id, poids: 1 }, { commande_id: c2.id, poids: 2 }] },
    ] },
  ]);
  const b3 = await appeler("bcMp:enregistrerPreparation", {
    nouveaux: [{ fournisseur_id: f1.id, date_commande: "2027-01-05", lignes: [{ type: "matiere", designation: "Ouate", unite: "kg", quantite: 3.333, productions: [{ commande_id: c2.id, poids: 3 }] }] }],
    ajouts: [{ bon_id: b1.id, lignes: [{ type: "matiere", matiere_catalogue_id: s.tissu.matiere_catalogue_id, designation: "Coton sergé", couleur: "Marine 002", unite: "m", quantite: 75.6, productions: [{ commande_id: c1.id, poids: 25.2 }, { commande_id: c2.id, poids: 50.4 }] }] }],
  });
  await refuse("bcMp:enregistrerPreparation", {});
  await refuse("bcMp:enregistrerPreparation", { nouveaux: [{ fournisseur_id: f2.id }, { fournisseur_id: f2.id }] });
  await refuse("bcMp:enregistrerPreparation", { ajouts: [{ bon_id: 99999, lignes: [] }] });
  await appeler("bcMp:list");
  await appeler("bcMp:list", { statut: "brouillon" });
  await appeler("bcMp:list", { fournisseurId: f1.id });

  // Modifications.
  await appeler("bcMp:mettreAJour", b1.id, { notes: "", date_livraison_souhaitee: "2026-03-20", conditions_paiement: "45 jours" });
  await appeler("bcMp:mettreAJour", b1.id, {});
  const lignesB1 = (await appeler("bcMp:get", b1.id)).lignes;
  await appeler("bcMp:mettreAJourLigne", lignesB1[0].id, { nombre_conditionnements: 4 });
  await appeler("bcMp:mettreAJourLigne", lignesB1[0].id, { quantite: 1000 });
  await appeler("bcMp:mettreAJourLigne", lignesB1[0].id, { prix_unitaire_ht: "", reference: "SRG-01" });
  await appeler("bcMp:mettreAJourLigne", lignesB1[1].id, { productions: [{ commande_id: c1.id, quantite_affectee: 30.6 }, { commande_id: c2.id, quantite_affectee: 45 }] });
  await refuse("bcMp:mettreAJourLigne", lignesB1[1].id, { unite: "paire" });
  await refuse("bcMp:mettreAJourLigne", 99999, {});
  await appeler("bcMp:ajouterLigne", b1.id, { type: "matiere", designation: "Coton sergé (échantillon)", unite: "m", quantite: 2, prix_unitaire_ht: 8, productions: [{ commande_id: c1.id, poids: 1 }] });
  await refuse("bcMp:ajouterLigne", 99999, { type: "matiere", designation: "x", quantite: 1, productions: [{ commande_id: c1.id, quantite_affectee: 1 }] });
  const apres = await appeler("bcMp:get", b1.id);
  await appeler("bcMp:supprimerLigne", apres.lignes[apres.lignes.length - 1].id);
  await refuse("bcMp:supprimerLigne", 99999);
  await appeler("bcMp:get", lot[0].id);
  await appeler("bcMp:get", 99999);

  // Les brouillons n'écrivent rien en finance ; les besoins restent identiques.
  for (const c of [c1, c2]) await appeler("approvisionnement:calculerBesoins", c.id);
  await appeler("finance:listAchats");

  await appeler("bcMp:supprimer", b3.crees[0].id);
  await refuse("bcMp:supprimer", b3.crees[0].id);
  // Le numéro supprimé n'est jamais réutilisé.
  await appeler("bcMp:creer", { fournisseur_id: f2.id, date_commande: "2027-02-01" });
  await appeler("bcMp:creer", { fournisseur_id: f2.id });
  await appeler("bcMp:list");

  // Refus APRÈS insertion partielle : tout est annulé (transaction) et aucun numéro MP n'est
  // consommé. Placés en fin de scénario : PostgreSQL consomme les identifiants techniques d'une
  // transaction annulée (SQLite non), ce qui décalerait les id de tout ce qui suit.
  await refuse("bcMp:creer", { fournisseur_id: f1.id, lignes: [{ ...ligneTissu, type: "autre" }] });
  await refuse("bcMp:creer", { fournisseur_id: f1.id, lignes: [{ ...ligneTissu, unite: "bobine" }] });
  await refuse("bcMp:creer", { fournisseur_id: f1.id, lignes: [{ ...ligneTissu, productions: [] }] });
  await refuse("bcMp:creer", { fournisseur_id: f1.id, lignes: [{ ...ligneTissu, productions: [{ commande_id: c1.id, quantite_affectee: 10 }] }] });
  await refuse("bcMp:creer", { fournisseur_id: f1.id, lignes: [{ ...ligneTissu, designation: " " }] });
  await refuse("bcMp:enregistrerPreparation", { nouveaux: [{ fournisseur_id: f2.id, lignes: [ligneTissu] }, { fournisseur_id: f1.id, lignes: [{ ...ligneTissu, productions: [] }] }] });
  await appeler("bcMp:list");
  await refuse("bcMp:mettreAJourLigne", lignesB1[1].id, { productions: [{ commande_id: c1.id, quantite_affectee: 1 }] });
  await appeler("bcMp:get", b1.id);
  void reg;
}));

// ------------------------------------------------------------------------------------------------
test("finance : engagements, réceptions, factures, paiements, échéances, coûts, stock", (t) => scenario(t, "finance", async (m) => {
  const { appeler, refuse } = m;
  const s = await socle(m);
  const { c1, c2 } = s;

  const f1 = await appeler("finance:creerFournisseur", { nom: "Tissages du Nord", contact: "M. Ben", email: "x@y.tn", telephone: "71 000 000", adresse: "Sfax" });
  const f2 = await appeler("finance:creerFournisseur", { nom: "Confection Sahel" });
  await refuse("finance:creerFournisseur", { nom: "  " });
  await appeler("finance:mettreAJourFournisseur", f1.id, { delai_paiement_jours: 30, delai_fin_de_mois: 1, mode_paiement_defaut: "virement", activite: "Tissu" });
  await appeler("finance:mettreAJourFournisseur", f2.id, { actif: 0 });
  await appeler("finance:mettreAJourFournisseur", f2.id, { delai_paiement_jours: 0 });
  await appeler("finance:mettreAJourFournisseur", f2.id, {});
  await appeler("finance:listFournisseurs");
  await appeler("finance:listFournisseurs", { includeInactive: true });
  await appeler("finance:getFournisseur", f1.id);

  // Tarifs (historique, jamais écrasé) et prix en vigueur.
  await appeler("finance:ajouterPrixFournisseur", { fournisseur_id: f1.id, matiere_catalogue_id: s.tissu.matiere_catalogue_id, designation: "Coton sergé", unite: "m", prix_ht: 6.4, date_debut_validite: "2026-01-01" });
  await appeler("finance:ajouterPrixFournisseur", { fournisseur_id: f1.id, matiere_catalogue_id: s.tissu.matiere_catalogue_id, designation: "Coton sergé", unite: "m", prix_ht: 6.9, date_debut_validite: "2026-02-15" });
  await appeler("finance:ajouterPrixFournisseur", { fournisseur_id: f1.id, designation: "Transport", unite: "lot", prix_ht: 40, date_debut_validite: "2026-01-01" });
  await refuse("finance:ajouterPrixFournisseur", { fournisseur_id: f1.id, designation: "x" }).catch(() => {});
  await appeler("finance:listPrixFournisseur", f1.id);
  await appeler("finance:listPrixFournisseur", f1.id, { actifsUniquement: true });
  for (const date of ["2026-01-20", "2026-03-01", "2025-12-01", undefined]) {
    await appeler("finance:prixEnVigueur", { fournisseurId: f1.id, matiereCatalogueId: s.tissu.matiere_catalogue_id, date });
  }
  await appeler("finance:prixEnVigueur", { fournisseurId: f1.id, designation: "Transport", date: "2026-06-01" });
  await appeler("finance:prixEnVigueur", { fournisseurId: f1.id });
  await appeler("finance:listMatieresCatalogue");
  const matCat = await appeler("finance:trouverOuCreerMatiereCatalogue", "Molleton gratté", "kg");
  await appeler("finance:trouverOuCreerMatiereCatalogue", "molleton  GRATTÉ", "m");

  // Engagements.
  await refuse("finance:creerAchat", { categorie: "matiere", designation: "x", montant_engage: 1 });
  await refuse("finance:creerAchat", { fournisseur_id: f1.id, categorie: "inconnue", designation: "x", montant_engage: 1 });
  await refuse("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "", montant_engage: 1 });
  await refuse("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "x", montant_engage: -1 });
  await refuse("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "x", montant_engage: 1, unite: "bobine" });
  const a1 = await appeler("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "Coton sergé", matiere_catalogue_id: s.tissu.matiere_catalogue_id, couleur: " Noir 001 ", quantite: 300, unite: "m", montant_engage: 2070, date_engagement: "2026-03-02", reference: "BC-778" });
  const a2 = await appeler("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "Coton sergé", matiere_catalogue_id: s.tissu.matiere_catalogue_id, couleur: "Noir 001", quantite: 100, unite: "m", montant_engage: 720, date_engagement: "2026-03-10" });
  const a3 = await appeler("finance:creerAchat", { fournisseur_id: f2.id, commande_id: c1.id, categorie: "confection", designation: "Façon veste", montant_engage: 1785, date_engagement: "2026-03-05" });
  const a4 = await appeler("finance:creerAchat", { fournisseur_id: f1.id, categorie: "transport", designation: "Transport", montant_engage: 0, date_engagement: "2026-03-06" });
  const a5 = await appeler("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "Molleton", matiere_catalogue_id: matCat.id, quantite: 20.5, unite: "kg", montant_engage: 205.25, date_engagement: "2026-03-07" });
  await appeler("finance:getAchat", a1.id);
  for (const f of [undefined, {}, { fournisseurId: f1.id }, { commandeId: c1.id }, { categorie: "matiere" }, { partageablesUniquement: true }]) {
    await appeler("finance:listAchats", f);
    await appeler("finance:listAchatsDetailles", f);
  }

  // Affectations aux productions.
  await refuse("finance:affecterAchat", { achat_id: 99999, commande_id: c1.id, quantite_affectee: 1 });
  await refuse("finance:affecterAchat", { achat_id: a3.id, commande_id: c1.id, quantite_affectee: 1 });
  await refuse("finance:affecterAchat", { achat_id: a1.id, commande_id: c1.id, quantite_affectee: 0 });
  await refuse("finance:affecterAchat", { achat_id: a1.id, commande_id: c1.id, quantite_affectee: 301 });
  const aff1 = await appeler("finance:affecterAchat", { achat_id: a1.id, commande_id: c1.id, quantite_affectee: 100.4, date_affectation: "2026-03-03" });
  await appeler("finance:affecterAchat", { achat_id: a1.id, commande_id: c2.id, quantite_affectee: 150, date_affectation: "2026-03-03", notes: "réassort" });
  await appeler("finance:quantiteDisponibleAchat", a1.id);
  await appeler("finance:listAffectationsAchat", a1.id);
  await appeler("finance:coutAffectation", aff1.id);

  // Réceptions.
  await appeler("finance:ajouterReceptionAchat", a1.id, { date_reception: "2026-03-12", quantite_recue: 200, reference_bl: "BL-1" });
  await appeler("finance:ajouterReceptionAchat", a1.id, { date_reception: "2026-03-20", quantite_recue: 110, notes: "excédent" });
  await refuse("finance:ajouterReceptionAchat", a1.id, { date_reception: "2026-03-20", quantite_recue: 0 }).catch(() => {});
  await appeler("finance:listReceptionsAchat", a1.id);

  // Factures (coût réel) et statut.
  const fa1 = await appeler("finance:ajouterFactureAchat", a1.id, { date_facture: "2026-03-15", montant_ht: 2100, montant_tva: 399, reference_facture: "F-2026-11" });
  const fa2 = await appeler("finance:ajouterFactureAchat", a3.id, { date_facture: "2026-04-30", montant_ht: 1800 });
  await refuse("finance:ajouterFactureAchat", a1.id, { date_facture: "2026-03-15", montant_ht: -5 }).catch(() => {});
  await appeler("finance:listFacturesAchat", a1.id);
  await appeler("finance:getFacture", fa1.id);
  await appeler("finance:statutFacture", fa1.id);
  await appeler("finance:coutAchat", a1.id);
  await appeler("finance:coutAchat", a2.id);
  await appeler("finance:coutAchat", a4.id);

  // Échéances.
  for (const [d, j, fm] of [["2026-03-15", 30, 1], ["2026-01-31", 30, 0], ["2026-02-10", 0, 1], ["2026-12-20", 60, 1], ["2026-03-15", null, 0]]) {
    await appeler("finance:calculerEcheanceSuggeree", d, j, fm);
  }
  await appeler("finance:ajouterEcheance", a1.id, { achat_facture_id: fa1.id, date_echeance: "2026-04-30", montant: 1249.5 });
  await appeler("finance:ajouterEcheance", a1.id, { achat_facture_id: fa1.id, date_echeance: "2026-05-31", montant: 1249.5, notes: "2/2" });
  await appeler("finance:ajouterEcheance", a3.id, { achat_facture_id: fa2.id, date_echeance: "2026-05-30", montant: 1800 });
  for (const f of [undefined, {}, { avant: "2026-05-01" }, { apres: "2026-05-01" }]) {
    await appeler("finance:listEcheances", f);
    await appeler("finance:listEcheancesDetaillees", f);
    await appeler("finance:listFacturesAvecEcheances", f);
  }

  // Paiements, avances, affectations de paiement, dette.
  const p1 = await appeler("finance:creerPaiement", { fournisseur_id: f1.id, date_paiement: "2026-04-30", montant: 1000, mode: "virement", reference: "VIR-1" });
  const p2 = await appeler("finance:creerPaiement", { fournisseur_id: f1.id, date_paiement: "2026-03-01", montant: 500, mode: "cheque", type: "avance", notes: "acompte" });
  await refuse("finance:creerPaiement", { fournisseur_id: f1.id, date_paiement: "2026-04-30", montant: 0, mode: "virement" }).catch(() => {});
  await appeler("finance:affecterPaiement", { paiement_id: p1.id, achat_facture_id: fa1.id, montant_affecte: 1000 });
  await appeler("finance:affecterPaiement", { paiement_id: p2.id, achat_facture_id: fa1.id, montant_affecte: 200 });
  await refuse("finance:affecterPaiement", { paiement_id: p2.id, achat_facture_id: fa1.id, montant_affecte: 10000 }).catch(() => {});
  await appeler("finance:creditNonAffecte", p2.id);
  await appeler("finance:creditNonAffecte", p1.id);
  await appeler("finance:statutFacture", fa1.id);
  await appeler("finance:listPaiementsFournisseur", f1.id);
  await appeler("finance:listFacturesFournisseur", f1.id);
  const dette = await appeler("finance:detteFournisseur", f1.id);
  assert.ok(JSON.stringify(dette).match(/[1-9]/), "dette fournisseur non triviale attendue");
  await appeler("finance:detteFournisseur", f2.id);
  await appeler("finance:listPaiementsEtAvances");
  await appeler("finance:listFournisseursAvecSynthese");
  await appeler("finance:listFournisseursAvecSynthese", { includeInactive: true });

  // Coûts de production, réceptions de production, retouches.
  for (const c of [c1, c2]) {
    await appeler("finance:coutCommande", c.id);
    await appeler("finance:syntheseCoutCommande", c.id);
    await appeler("finance:comparaisonConsommationCommande", c.id);
  }
  const rp = await appeler("finance:ajouterReceptionProduction", c1.id, { date_reception: "2026-04-20", quantite_recue: 57, quantite_conforme: 50, quantite_a_retoucher: 5, quantite_rebut: 2 });
  await refuse("finance:ajouterReceptionProduction", c1.id, { date_reception: "2026-04-20", quantite_recue: 10, quantite_conforme: 20 }).catch(() => {});
  await appeler("finance:enregistrerRetoucheReussie", rp.id, 3);
  await refuse("finance:enregistrerRetoucheReussie", rp.id, 99).catch(() => {});
  await appeler("finance:listReceptionsProduction", c1.id);
  await appeler("finance:quantiteCommercialisableCommande", c1.id);
  await appeler("finance:syntheseCoutCommande", c1.id);

  // Stock dérivé et consommation affectée.
  await appeler("finance:stockDisponibleMatiere", s.tissu.matiere_catalogue_id, "Noir 001");
  await appeler("finance:stockDisponibleMatiere", s.tissu.matiere_catalogue_id, null);
  await appeler("finance:stockDisponibleMatiere", matCat.id);
  await appeler("finance:syntheseStockMatiere");
  await appeler("finance:affecterConsommationMatiere", { commande_id: c2.id, matiere_catalogue_id: s.tissu.matiere_catalogue_id, couleur: "Noir 001", quantite_consommee: 80, date_affectation: "2026-03-25" });
  await refuse("finance:affecterConsommationMatiere", { commande_id: c2.id, matiere_catalogue_id: s.tissu.matiere_catalogue_id, couleur: "Noir 001", quantite_consommee: 10000 });
  await refuse("finance:affecterConsommationMatiere", { matiere_catalogue_id: s.tissu.matiere_catalogue_id, quantite_consommee: 1 });
  await appeler("finance:syntheseStockMatiere");
  await appeler("finance:coutCommande", c2.id);
  await appeler("finance:syntheseGlobale");
  void a5;
}));

// ------------------------------------------------------------------------------------------------
test("finance : estimations, postes de coût, simulation de prix", (t) => scenario(t, "estimation", async (m) => {
  const { appeler, refuse } = m;
  const s = await socle(m);

  for (const [cout, params, q] of [[25, { coefficient: 2.6 }, 100], [25, { prixEnvisage: 79 }, 0], [0, { prixEnvisage: 10 }, 5], [12.345, { coefficient: 3 }, null], [10, {}, 10]]) {
    await appeler("finance:simulationPrix", cout, params, q);
  }

  const pc1 = await appeler("finance:creerPosteCout", { categorie: "confection", designation: "Façon veste", mode_calcul_defaut: "unitaire_direct", ajouter_automatiquement: 1 });
  await appeler("finance:creerPosteCout", { categorie: "transport", designation: "Transport Tunis → Paris", mode_calcul_defaut: "montant_global", ajouter_automatiquement: true });
  await appeler("finance:creerPosteCout", { categorie: "matiere", designation: "Tissu principal", mode_calcul_defaut: "consommation_prix", unite_defaut: "m", quantite_defaut: 1.6 });
  await refuse("finance:creerPosteCout", { categorie: "inconnue", designation: "x", mode_calcul_defaut: "unitaire_direct" }).catch(() => {});
  await refuse("finance:creerPosteCout", { categorie: "confection", designation: "façon VESTE", mode_calcul_defaut: "unitaire_direct" }).catch(() => {});
  await appeler("finance:mettreAJourPosteCout", pc1.id, { designation: "Façon veste doublée", ordre: 3 });
  await appeler("finance:listPostesCout");
  await appeler("finance:listPostesCout", { includeInactive: true });
  for (const [q, l, c] of [["fa", 10, undefined], ["", 5, "transport"], ["tissu", undefined, "matiere"], ["zzz", 3, undefined]]) {
    await appeler("finance:rechercherPostesCout", q, l, c);
  }

  const est = await appeler("finance:getOuCreerEstimation", s.article.id);
  await appeler("finance:getOuCreerEstimation", s.article.id);
  await appeler("finance:mettreAJourEstimation", est.id, { quantite_prevue: 300 });
  await appeler("finance:mettreAJourPrixVenteEnvisage", s.article.id, 129);
  await refuse("finance:ajouterLigneEstimation", est.id, { categorie: "inconnue", mode_calcul: "unitaire_direct" });
  await refuse("finance:ajouterLigneEstimation", est.id, { categorie: "matiere", mode_calcul: "autre" });
  const l1 = await appeler("finance:ajouterLigneEstimation", est.id, { categorie: "matiere", designation: "Coton", mode_calcul: "consommation_prix", quantite: 1.6, unite: "m", prix_unitaire_ht: 6.9, taux_tva: 19 });
  const l2 = await appeler("finance:ajouterLigneEstimation", est.id, { categorie: "confection", mode_calcul: "unitaire_direct", prix_unitaire_ht: 8.5 });
  await appeler("finance:ajouterLigneEstimation", est.id, { categorie: "transport", designation: "Transport", mode_calcul: "montant_global", montant_global_ht: 450 });
  await appeler("finance:ajouterLigneEstimation", est.id, { categorie: "fourniture", designation: "Zip", mode_calcul: "consommation_prix", quantite: 1, prix_unitaire_ht: 0.45 });
  await appeler("finance:mettreAJourLigneEstimation", l2.id, { designation: "Façon", prix_unitaire_ht: "9.25" });
  await appeler("finance:mettreAJourLigneEstimation", l1.id, { quantite: "", unite: "" });
  await appeler("finance:mettreAJourLigneEstimation", l1.id, {});
  await appeler("finance:listLignesEstimation", est.id);
  await appeler("finance:syntheseEstimation", est.id);
  await appeler("finance:listEstimationsResume");
  await appeler("finance:supprimerLigneEstimation", l2.id);
  await appeler("finance:syntheseEstimation", est.id);
  await appeler("finance:mettreAJourEstimation", est.id, { quantite_prevue: 0 });
  await appeler("finance:syntheseEstimation", est.id);
  await appeler("finance:supprimerPosteCout", pc1.id);
  await appeler("finance:listPostesCout", { includeInactive: true });
  await appeler("finance:supprimerEstimation", est.id);
  await appeler("finance:listEstimationsResume");
}));

// ------------------------------------------------------------------------------------------------
test("besoins sur recette figée (révision de fiche) et engagements rattachés", (t) => scenario(t, "figee", async (m) => {
  const { appeler } = m;
  const s = await socle(m);
  const { c1, c2, c3, fiche } = s;
  const f1 = await appeler("finance:creerFournisseur", { nom: "Tissages du Nord" });
  // Engagements réels rattachés (et un non rattaché : composant absent de la recette).
  const a1 = await appeler("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "Coton sergé", matiere_catalogue_id: s.tissu.matiere_catalogue_id, couleur: "Noir 001", quantite: 120, unite: "m", montant_engage: 800, date_engagement: "2026-03-02" });
  await appeler("finance:affecterAchat", { achat_id: a1.id, commande_id: c1.id, quantite_affectee: 60 });
  const a2 = await appeler("finance:creerAchat", { fournisseur_id: f1.id, categorie: "matiere", designation: "Lin lavé", quantite: 10, unite: "m", montant_engage: 90, date_engagement: "2026-03-02" });
  await appeler("finance:affecterAchat", { achat_id: a2.id, commande_id: c1.id, quantite_affectee: 10 });
  await appeler("finance:ajouterReceptionAchat", a1.id, { date_reception: "2026-03-10", quantite_recue: 130 });
  await appeler("approvisionnement:calculerBesoins", c1.id);

  await appeler("ficheTechnique:validerFiche", fiche.id);
  await appeler("ficheTechnique:apercuModification", fiche.id);
  await appeler("ficheTechnique:rouvrirPourModification", fiche.id, { motif: "Changement de doublure" });
  // La fiche change : la production validée garde sa recette, le brouillon suit la fiche.
  await appeler("ficheTechnique:updateMatiere", s.tissu.id, { consommation_technique: 2.1, perte_pourcent: 8 });
  await appeler("ficheTechnique:deleteMatiere", s.ouate.id);
  await appeler("ficheTechnique:addAccessoire", fiche.id, { nom: "Pression", famille: "composant", unite: "piece", consommation_par_piece: 4 });
  const r1 = await appeler("approvisionnement:calculerBesoins", c1.id);
  const r3 = await appeler("approvisionnement:calculerBesoins", c3.id);
  await appeler("approvisionnement:calculerBesoins", c2.id);
  assert.equal(r1.recette.source, "figee", "la production validée doit garder sa recette figée");
  assert.equal(r3.recette.source, "fiche", "le brouillon suit la fiche");
  assert.ok(r1.engagements_non_rattaches.length > 0, "engagement non rattaché attendu");
  await appeler("approvisionnement:etatsApprovisionnement", [c1.id, c2.id, c3.id]);
  await appeler("bcMp:regrouper", [c1.id, c2.id, c3.id]);
  await appeler("ficheTechnique:validerFiche", fiche.id);
  for (const c of [c1, c3]) await appeler("approvisionnement:calculerBesoins", c.id);
  await appeler("finance:coutCommande", c1.id);
  await appeler("finance:comparaisonConsommationCommande", c1.id);
}));
