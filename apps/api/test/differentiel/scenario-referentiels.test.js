// ================================================================================================
// Scénario différentiel — RÉFÉRENTIELS ET PLANNING (écritures).
// Listes, étapes, opérateur actif, entreprise (+ logo), grilles de tailles, ratios, déclinaisons
// et variantes, articles (+ photos), modèles de mesures, planning. Chaque écriture est suivie
// d'une relecture : l'ancien code (SQLite) et le nouveau (PostgreSQL) doivent rester identiques.
// ================================================================================================
// La configuration (.env) doit être chargée avant le harnais, qui lit DATABASE_URL au chargement.
require("../../src/config").chargerConfiguration();
const test = require("node:test");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const assert = require("node:assert/strict");
const { scenario } = require("./outils");

// Les fichiers enregistrés reçoivent un nom aléatoire (UUID) : deux exécutions ne peuvent pas
// produire le même chemin. Seule différence tolérée, et uniquement sur les chemins de fichiers.
const RE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
function tolererNomsDeFichiers(journal) {
  const e = journal[journal.length - 1];
  if (!e || !e.ecart) return;
  const restants = e.ecart.filter((ligne) => {
    const m = /^(.*?) : ancien=(.*) nouveau=(.*)$/.exec(ligne);
    if (!m || !/(_path|logo|photo)/.test(m[1])) return true;
    return m[2].replace(RE_UUID, "U") !== m[3].replace(RE_UUID, "U");
  });
  if (restants.length) e.ecart = restants; else delete e.ecart;
}

async function creerImage(nom, couleur) {
  const f = path.join(os.tmpdir(), `belvie-test-${process.pid}-${nom}.png`);
  await sharp({ create: { width: 64, height: 48, channels: 3, background: couleur } }).png().toFile(f);
  return f;
}

// Mois futurs (le planning refuse un lancement dans le passé).
function moisDans(n) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

void test("référentiels : listes, étapes, opérateur, entreprise", (t) => scenario(t, "ref_listes", async ({ appeler, refuse, journal }) => {
  // --- Listes de valeurs
  const noir = await appeler("listes:create", "couleur", "Noir");
  await appeler("listes:create", "couleur", "Marine");
  await appeler("listes:create", "couleur", "  écru  ");
  await refuse("listes:create", "couleur", "noir");
  await refuse("listes:create", "couleur", "   ");
  await refuse("listes:create", "inconnu", "X");
  await appeler("listes:update", noir.id, { nom: "Noir profond" });
  await appeler("listes:update", noir.id, { actif: 0 });
  await appeler("listes:list", "couleur");
  await appeler("listes:list", "couleur", { includeInactive: true });
  await appeler("listes:create", "couleur", "Noir profond"); // réactivation
  await appeler("listes:update", noir.id, { ordre: 4, responsable_nom: "  " });
  const ete = await appeler("listes:create", "saison", "Mi-saison", { code: "ms" });
  await appeler("listes:create", "saison", "Croisière", { code: "CR" });
  await refuse("listes:create", "saison", "Pluie", { code: "MS" });
  await refuse("listes:create", "saison", "été", { code: "ZZ" });
  await refuse("listes:create", "saison", "Sans code", {});
  await refuse("listes:create", "saison", "Mauvais", { code: "trop-long!" });
  await appeler("listes:update", ete.id, { code: "MI" });
  await refuse("listes:update", ete.id, { code: "FW" });
  await appeler("listes:create", "rayon", "Senior", { code: "S" });
  await appeler("listes:create", "rayon", "Junior", { code: "J", ordre: 1 });
  await appeler("listes:list", "rayon");
  await appeler("listes:list", "saison", { includeInactive: true });
  const cat = await appeler("listes:create", "categorie", "Accessoires");
  await appeler("listes:create", "produit", "Ceinture", { parent_id: cat.id });
  await appeler("listes:list", "produit", { parentId: cat.id });
  await appeler("listes:list", "produit", { parentId: 4 });
  const atelier = await appeler("listes:create", "atelier", "Atelier Nord");
  await appeler("listes:update", atelier.id, { responsable_nom: "Sami" });
  await refuse("listes:update", 999999, { nom: "x" });
  await appeler("listes:list", "atelier");

  // --- Étapes
  const etape = await appeler("etapes:create", { libelle: "Broderie", optionnelle: true });
  await appeler("etapes:create", { libelle: "Broderie bis", ordre: 3 });
  await refuse("etapes:create", { libelle: "broderie" });
  await refuse("etapes:create", { libelle: "  " });
  await appeler("etapes:update", etape.id, { libelle: "Broderie main", actif: 0 });
  await appeler("etapes:update", etape.id, { couleur: "ignorée" });
  await refuse("etapes:update", etape.id, { libelle: "Coupe" });
  await refuse("etapes:update", 999999, { libelle: "x" });
  await appeler("etapes:list");
  await appeler("etapes:list", { includeInactive: true });

  // --- Opérateur actif
  const amal = await appeler("listes:create", "operateur", "Amal");
  const karim = await appeler("listes:create", "operateur", "Karim");
  await appeler("parametres:setOperateurActif", amal.id);
  await appeler("parametres:getOperateurActif");
  await appeler("listes:update", karim.id, { actif: 0 });
  await refuse("parametres:setOperateurActif", karim.id);
  await refuse("parametres:setOperateurActif", 999999);
  await appeler("parametres:setOperateurActif", null);
  await appeler("parametres:getOperateurActif");

  // --- Entreprise
  await appeler("entreprise:get");
  await appeler("entreprise:removeLogo");
  await appeler("entreprise:save", { nom_commercial: "Belvie", ville: "Tunis", taux_tva_defaut: 19 });
  await appeler("entreprise:save", { raison_sociale: "Belvie SARL", inconnu: "ignoré" });
  await appeler("entreprise:save", {});
  await appeler("entreprise:get");
  const logo = await creerImage("logo", "#204080");
  await appeler("entreprise:setLogo", logo); tolererNomsDeFichiers(journal);
  await appeler("entreprise:setLogo", logo); tolererNomsDeFichiers(journal);
  await appeler("entreprise:removeLogo");
  await appeler("entreprise:getEtatWizard");
  await appeler("entreprise:setEtatWizard", "postponed");
  await appeler("entreprise:setEtatWizard", "completed");
  await appeler("entreprise:getEtatWizard");
}));

void test("référentiels : grilles, ratios, déclinaisons, articles, photos", (t) => scenario(t, "ref_articles", async ({ appeler, refuse, journal }) => {
  const trouver = async (type, nom) => (await appeler("listes:list", type, { includeInactive: true })).find((x) => x.nom === nom);
  const catSans = await appeler("listes:create", "categorie", "Divers");
  const veste = await trouver("produit", "Veste");
  const autre = await appeler("listes:create", "produit", "Objet", { parent_id: catSans.id });
  const orphelin = await appeler("listes:create", "produit", "Sans catégorie");
  const fw = await trouver("saison", "Automne–Hiver");
  const homme = await trouver("rayon", "Homme");

  // --- Grilles de tailles
  const grille = await appeler("grillesTailles:creer", "Lettres");
  await refuse("grillesTailles:creer", "  ");
  await appeler("grillesTailles:creer", "Chiffres");
  let g = await appeler("grillesTailles:ajouterValeur", grille.id, "S");
  g = await appeler("grillesTailles:ajouterValeur", grille.id, "M");
  g = await appeler("grillesTailles:ajouterValeur", grille.id, "L");
  g = await appeler("grillesTailles:ajouterValeur", grille.id, "XL");
  await refuse("grillesTailles:ajouterValeur", grille.id, "");
  await appeler("grillesTailles:ajouterValeur", grille.id, "m");
  const grilleLue = await appeler("grillesTailles:get", grille.id);
  const valeurs = (grilleLue && grilleLue.valeurs) || (g && g.valeurs) || [];
  assert.ok(valeurs.length, "branche du scénario non exercée");
  {
    await appeler("grillesTailles:modifierValeur", grille.id, valeurs[0].id, "XS");
    await refuse("grillesTailles:modifierValeur", grille.id, valeurs[0].id, " ");
    await appeler("grillesTailles:reordonnerValeurs", grille.id, valeurs.map((v) => v.id).reverse());
    await appeler("grillesTailles:supprimerValeur", grille.id, valeurs[valeurs.length - 1].id);
  }
  await appeler("grillesTailles:renommer", grille.id, "Lettres (S-XL)");
  await refuse("grillesTailles:renommer", grille.id, "");
  await appeler("grillesTailles:setPourProduit", veste.id, grille.id);
  await appeler("grillesTailles:getPourProduit", veste.id);
  await appeler("grillesTailles:getPourProduit", autre.id);
  await refuse("grillesTailles:supprimer", grille.id);
  await appeler("grillesTailles:setActive", grille.id, false);
  await appeler("grillesTailles:list");
  await appeler("grillesTailles:list", { includeInactive: true });
  await appeler("grillesTailles:setActive", grille.id, true);
  const chiffres = (await appeler("grillesTailles:list")).find((x) => x.nom === "Chiffres");
  await appeler("grillesTailles:supprimer", chiffres.id);
  await appeler("grillesTailles:setPourProduit", autre.id, grille.id);
  await appeler("grillesTailles:setPourProduit", autre.id, null);

  // --- Ratios
  const vals = (await appeler("grillesTailles:get", grille.id)).valeurs || [];
  const ratio = await appeler("ratiosRepartition:enregistrer", { nom: "Standard", grille_id: grille.id, lignes: vals.map((v, i) => ({ taille_id: v.id, poids: i + 1 })) });
  await appeler("ratiosRepartition:enregistrer", { nom: "standard", grille_id: grille.id, lignes: [{ taille_id: vals[0].id, poids: 2.5 }, { taille_id: vals[1].id, poids: 0 }] });
  await appeler("ratiosRepartition:enregistrer", { nom: "Petites tailles", grille_id: grille.id, lignes: [{ taille_id: vals[0].id, poids: 3 }] });
  await refuse("ratiosRepartition:enregistrer", { nom: "", grille_id: grille.id, lignes: [] });
  await refuse("ratiosRepartition:enregistrer", { nom: "X", lignes: [] });
  await refuse("ratiosRepartition:enregistrer", { nom: "X", grille_id: 999999, lignes: [] });
  await refuse("ratiosRepartition:enregistrer", { nom: "X", grille_id: grille.id, lignes: [{ taille_id: vals[0].id, poids: 0 }] });
  await refuse("ratiosRepartition:enregistrer", { nom: "X", grille_id: grille.id, lignes: [{ taille_id: 999999, poids: 1 }] });
  await appeler("ratiosRepartition:listPourGrille", grille.id);
  await appeler("ratiosRepartition:supprimer", ratio.id);
  await refuse("ratiosRepartition:supprimer", ratio.id);
  await appeler("ratiosRepartition:listPourGrille", grille.id);

  // --- Articles
  const art = await appeler("articles:create", { produit_id: veste.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "vst", designation: " Veste Nara " });
  const art2 = await appeler("articles:create", { produit_id: veste.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "BLS" });
  await refuse("articles:create", { produit_id: autre.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "OBJ" });
  await refuse("articles:create", { produit_id: orphelin.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "OBJ" });
  await refuse("articles:create", { saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "OBJ" });
  await refuse("articles:create", { produit_id: veste.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "OBJ" });
  await refuse("articles:create", { produit_id: veste.id, saison_id: fw.id, annee_collection: 2027, abreviation: "OBJ" });
  await refuse("articles:create", { produit_id: veste.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 27, abreviation: "OBJ" });
  await refuse("articles:create", { produit_id: veste.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "O1" });
  await refuse("articles:create", { produit_id: veste.id, saison_id: 999999, rayon_id: homme.id, annee_collection: 2027, abreviation: "OBJ" });
  await appeler("articles:update", art.id, { designation: "Veste Nara II", prix_vente_envisage: 189.9, ignore: 1 });
  await appeler("articles:update", art.id, {});
  await refuse("articles:update", 999999, { designation: "x" });
  await appeler("articles:verifierChangementReference", art.id, "FW27-M-VST-999");
  await appeler("articles:verifierChangementReference", art.id, art2.reference_principale);
  await appeler("articles:preparerDuplication", art.id);
  await refuse("articles:completerReference", art.id, { saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "VST" });
  await appeler("articles:list");
  await appeler("articles:list", { includeIncomplete: false });

  // --- Photos d'article
  const img1 = await creerImage("photo1", "#aa3300");
  const img2 = await creerImage("photo2", "#00aa33");
  await appeler("articles:ajouterPhoto", art.id, img1); tolererNomsDeFichiers(journal);
  const apres = await appeler("articles:ajouterPhoto", art.id, img2); tolererNomsDeFichiers(journal);
  const photos = (apres && apres.photos) || (await appeler("articles:get", art.id)).photos; tolererNomsDeFichiers(journal);
  assert.ok(photos && photos.length >= 2, "branche du scénario non exercée");
  {
    await appeler("articles:definirPhotoPrincipale", photos[1].id); tolererNomsDeFichiers(journal);
    await appeler("articles:retirerPhoto", photos[0].id); tolererNomsDeFichiers(journal);
  }
  await refuse("articles:definirPhotoPrincipale", 999999);
  await refuse("articles:retirerPhoto", 999999);
  await appeler("articles:get", art.id); tolererNomsDeFichiers(journal);
  await appeler("articles:list"); tolererNomsDeFichiers(journal);

  // --- Déclinaisons
  const tCouleur = await appeler("declinaisons:createType", "Couleur", { affichage_couleur: true });
  const tMatiere = await appeler("declinaisons:createType", "Matière");
  await refuse("declinaisons:createType", "couleur");
  await refuse("declinaisons:createType", " ");
  await appeler("declinaisons:updateType", tMatiere.id, { nom: "Matière principale", affichage_couleur: false });
  await refuse("declinaisons:updateType", tMatiere.id, { nom: "Couleur" });
  await refuse("declinaisons:updateType", 999999, { nom: "x" });
  const vNoir = await appeler("declinaisons:createValeur", tCouleur.id, "Noir", { couleur_hex: "#000000" });
  const vBleu = await appeler("declinaisons:createValeur", tCouleur.id, "Bleu", { couleur_hex: "#1A2B3C" });
  await refuse("declinaisons:createValeur", tCouleur.id, "noir");
  await refuse("declinaisons:createValeur", tCouleur.id, "Rouge", { couleur_hex: "rouge" });
  await refuse("declinaisons:createValeur", 999999, "Rouge");
  const vCoton = await appeler("declinaisons:createValeur", tMatiere.id, "Coton");
  const vLin = await appeler("declinaisons:createValeur", tMatiere.id, "Lin");
  await appeler("declinaisons:updateValeur", vBleu.id, { valeur: "Bleu nuit", couleur_hex: null });
  await refuse("declinaisons:updateValeur", vBleu.id, { couleur_hex: "#12" });
  await appeler("declinaisons:reorderTypes", [tMatiere.id, tCouleur.id]);
  await appeler("declinaisons:reorderValeurs", tCouleur.id, [vBleu.id, vNoir.id]);
  await appeler("declinaisons:listTypes");
  await appeler("declinaisons:listValeurs", tCouleur.id, { includeInactive: true });
  await appeler("declinaisons:setArticleTypes", art.id, [tCouleur.id, tMatiere.id]);
  await appeler("declinaisons:getArticleTypes", art.id);
  const selections = { [tCouleur.id]: [vNoir.id, vBleu.id], [tMatiere.id]: [vCoton.id] };
  await appeler("declinaisons:previsualiserImpact", art.id, selections);
  await appeler("declinaisons:appliquerConfiguration", art.id, [tCouleur.id, tMatiere.id], selections);
  await appeler("declinaisons:getArticleValeurs", art.id);
  const gen = await appeler("declinaisons:genererVariantes", art.id, selections);
  await appeler("declinaisons:genererVariantes", art.id, { ...selections, [tMatiere.id]: [vCoton.id, vLin.id] });
  await refuse("declinaisons:genererVariantes", art.id, {});
  await refuse("declinaisons:genererVariantes", 999999, selections);
  await appeler("declinaisons:articleHasVariantes", art.id);
  const variantes = await appeler("declinaisons:listVariantes", art.id, { includeInactive: true });
  await appeler("declinaisons:updateVariante", variantes[0].id, { sku: "SKU-1", code_barres: "123", actif: false });
  await refuse("declinaisons:updateVariante", 999999, { sku: "x" });
  await appeler("declinaisons:getVariante", variantes[0].id);
  await appeler("declinaisons:deleteVariante", variantes[1].id);
  await refuse("declinaisons:deleteVariante", variantes[1].id);
  await appeler("declinaisons:previsualiserImpact", art.id, { [tCouleur.id]: [vNoir.id] });
  await appeler("declinaisons:appliquerConfiguration", art.id, [tCouleur.id], { [tCouleur.id]: [vNoir.id] });
  await appeler("declinaisons:listVariantes", art.id, { includeInactive: true });
  await appeler("declinaisons:listVariantes", art.id);
  await appeler("declinaisons:updateType", tCouleur.id, { actif: false });
  await appeler("declinaisons:updateValeur", vLin.id, { actif: false });
  await appeler("declinaisons:listTypes", { includeInactive: true });
  void gen;
}));

void test("référentiels : modèles de mesures et planning", (t) => scenario(t, "ref_planning", async ({ appeler, refuse, journal }) => {
  const trouver = async (type, nom) => (await appeler("listes:list", type, { includeInactive: true })).find((x) => x.nom === nom);
  const veste = await trouver("produit", "Veste");
  const tshirt = await trouver("produit", "T-shirt");
  const fw = await trouver("saison", "Automne–Hiver");
  const homme = await trouver("rayon", "Homme");
  const atelier = await appeler("listes:create", "atelier", "Atelier Sud");

  // --- Modèles de mesures
  await appeler("modelesMesures:listProduitsAvecStatut");
  const standards = await appeler("modelesMesures:listModelesStandards");
  const m = await appeler("modelesMesures:create", veste.id, "Veste homme");
  await refuse("modelesMesures:create", veste.id, " ");
  let mod = await appeler("modelesMesures:addLigne", m.id, "1/2 poitrine", { repere: "A", unite: "cm", tolerance_plus: "1", tolerance_moins: "0.5" });
  mod = await appeler("modelesMesures:addLigne", m.id, "Longueur totale");
  await appeler("modelesMesures:addLigne", m.id, "1/2 poitrine");
  await refuse("modelesMesures:addLigne", m.id, "  ");
  const idModele = (mod && mod.id) || m.id;
  const lu = await appeler("modelesMesures:getById", idModele);
  const lignes = (lu && lu.lignes) || [];
  assert.ok(lignes.length, "branche du scénario non exercée");
  {
    await appeler("modelesMesures:updateLigne", idModele, lignes[0].id, { repere: "B", commentaire: "", unite: "mm" });
    await appeler("modelesMesures:reorderLignes", idModele, lignes.map((l) => l.id).reverse());
    await appeler("modelesMesures:removeLigne", idModele, lignes[lignes.length - 1].id);
  }
  assert.ok(standards && standards.length, "branche du scénario non exercée");
  {
    await appeler("modelesMesures:chargerModeleStandard", idModele, standards[0].cle);
    const complements = await appeler("modelesMesures:listComplementsStandards", standards[0].cle);
    assert.ok(complements && complements.length);
    await appeler("modelesMesures:chargerComplementStandard", idModele, complements[0].cle);
  }
  await refuse("modelesMesures:chargerModeleStandard", idModele, "inconnu");
  await refuse("modelesMesures:chargerComplementStandard", idModele, "inconnu");
  const copie = await appeler("modelesMesures:dupliquer", idModele, "Veste homme (copie)");
  await refuse("modelesMesures:dupliquer", 999999, "x");
  await appeler("modelesMesures:updateNom", idModele, "Veste homme v2");
  await refuse("modelesMesures:updateNom", idModele, "");
  await appeler("modelesMesures:setActif", idModele, false);
  await appeler("modelesMesures:listByProduitId", veste.id);
  await appeler("modelesMesures:listByProduitId", veste.id, { seulementActifs: true });
  await appeler("modelesMesures:deleteModele", (copie && copie.id) || idModele);
  await appeler("modelesMesures:listProduitsAvecStatut");

  // --- Planning
  const art = await appeler("articles:create", { produit_id: veste.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, abreviation: "VST" });
  const m1 = moisDans(2); const m2 = moisDans(3); const m3 = moisDans(5);
  const p1 = await appeler("planning:creer", { nom_provisoire: "Parka", reference_provisoire: "prk", produit_id: veste.id, saison_id: fw.id, rayon_id: homme.id, annee_collection: 2027, mois_prevu_production: m1, mois_prevu_reception: m2, quantite_previsionnelle: 300, atelier_id: atelier.id, notes: "Essai" });
  const p2 = await appeler("planning:creer", { article_id: art.id, mois_prevu_production: m1, statut: "valide" });
  const p3 = await appeler("planning:creer", { nom_provisoire: "Tee basique", produit_id: tshirt.id, mois_prevu_production: m2 });
  const p4 = await appeler("planning:creer", { nom_provisoire: "Bob", mois_prevu_production: m2 });
  await refuse("planning:creer", { nom_provisoire: "X" });
  await refuse("planning:creer", { nom_provisoire: "X", mois_prevu_production: "2020-01" });
  await refuse("planning:creer", { mois_prevu_production: m1 });
  await refuse("planning:creer", { nom_provisoire: "X", mois_prevu_production: m2, mois_prevu_reception: m1 });
  await refuse("planning:creer", { nom_provisoire: "X", mois_prevu_production: m1, mois_prevu_reception: "2027/01" });
  await appeler("planning:mettreAJour", p1.id, { notes: "Modifié", quantite_previsionnelle: 350, coloris_previsionnels: "Noir, Kaki" });
  await appeler("planning:mettreAJour", p1.id, { mois_prevu_reception: "" });
  await refuse("planning:mettreAJour", p1.id, { mois_prevu_production: "2020-02" });
  await refuse("planning:mettreAJour", p2.id, { quantite_previsionnelle: 10 });
  await appeler("planning:mettreAJour", p2.id, { quantite_previsionnelle: 10, forcer: true });
  await appeler("planning:mettreAJour", p2.id, { notes: "libre" });
  await refuse("planning:mettreAJour", 999999, { notes: "x" });
  await appeler("planning:deplacer", p3.id, "mois_prevu_production", m1, [p3.id, p1.id, p2.id]);
  await refuse("planning:deplacer", p2.id, "mois_prevu_production", m3, [p2.id]);
  await appeler("planning:deplacer", p2.id, "mois_prevu_production", m3, [p2.id], true);
  await refuse("planning:deplacer", p1.id, "autre", m2, []);
  await appeler("planning:reordonner", m1, [p1.id, p3.id]);
  const imgP = await creerImage("planning", "#336699");
  await appeler("planning:ajouterPhoto", p1.id, imgP); tolererNomsDeFichiers(journal);
  await refuse("planning:ajouterPhoto", p2.id, imgP);
  await appeler("planning:ajouterPhoto", p1.id, imgP); tolererNomsDeFichiers(journal);
  await appeler("planning:retirerPhoto", p1.id); tolererNomsDeFichiers(journal);
  await refuse("planning:retirerPhoto", p2.id);
  await appeler("planning:kpis");
  await appeler("planning:list"); tolererNomsDeFichiers(journal);
  await appeler("planning:list", { mois: m1 });
  await appeler("planning:list", { recherche: "PARK" });
  await appeler("planning:list", { statut: "idee", saisonId: fw.id, anneeCollection: 2027 });
  await appeler("planning:get", p1.id); tolererNomsDeFichiers(journal);
  await appeler("planning:convertirEnProduit", p4.id, {});
  await refuse("planning:convertirEnProduit", p4.id, {});
  await refuse("planning:convertirEnProduit", p1.id, {});
  await appeler("planning:convertirEnProduit", p3.id, { abreviation: "TSB" });
  await refuse("planning:supprimerProvisoire", p2.id);
  await appeler("planning:retirerDuPlanning", p2.id);
  await appeler("planning:creer", { nom_provisoire: "À supprimer", mois_prevu_production: m3 });
  const liste = await appeler("planning:list");
  const aSupprimer = liste.find((x) => x.nom_provisoire === "À supprimer");
  await appeler("planning:supprimerProvisoire", aSupprimer.id);
  await refuse("planning:supprimerProvisoire", 999999);
  await appeler("planning:list"); tolererNomsDeFichiers(journal);
  await appeler("planning:kpis");
  await appeler("articles:list"); tolererNomsDeFichiers(journal);
}));

void test("référentiels : données de démonstration", (t) => scenario(t, "ref_demo", async ({ appeler, refuse }) => {
  // Le chargement de la démo échoue dans l'ancienne version comme dans la nouvelle (la série de
  // référence n'est pas déterminable sans type d'article) : on vérifie que l'échec est identique
  // et qu'il ne laisse rien derrière lui (transaction annulée).
  await appeler("listes:create", "produit", "T-shirt Essentiel", { parent_id: 1 });
  await refuse("system:loadDemoData");
  await appeler("listes:list", "produit", { includeInactive: true });
  await appeler("listes:list", "couleur", { includeInactive: true });
  await appeler("articles:list");
  await appeler("commandes:list");
  await appeler("system:clearDemoData");
  await appeler("listes:list", "operateur", { includeInactive: true });
}));
