// ================================================================================================
// Scénario différentiel « productions et fiches techniques » : référentiels → article → fiche
// technique complète → validation → commandes (cycle de vie) → BC PF → révision de nomenclature.
// Chaque appel passe par le harnais : ancien code (SQLite) et nouveau (PostgreSQL) doivent
// rendre exactement la même chose.
// ================================================================================================
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
// La configuration (.env) doit être chargée AVANT le harnais, qui lit DATABASE_URL au chargement.
require("../../src/config").chargerConfiguration();
const { scenario } = require("./outils");

// Noms de fichiers (croquis, photos) : l'ancien et le nouveau code tirent chacun un UUID au
// hasard. Pour pouvoir comparer les chemins enregistrés, chaque monde reçoit ici la même suite
// d'UUID déterministes (un compteur par monde, reconnu à l'emplacement du code appelant).
function uuidsDeterministes() {
  const crypto = require("crypto");
  const origine = crypto.randomUUID;
  const compteurs = { ancien: 0, nouveau: 0 };
  crypto.randomUUID = () => {
    const monde = /belvie-electron-1\.0\.1/.test(new Error().stack) ? "ancien" : "nouveau";
    const n = ++compteurs[monde];
    return `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
  };
  return () => { crypto.randomUUID = origine; };
}

async function imageTemporaire(nom, couleur) {
  const sharp = require("sharp");
  const f = path.join(os.tmpdir(), `belvie-test-${process.pid}-${nom}.png`);
  await sharp({ create: { width: 64, height: 48, channels: 3, background: couleur } }).png().toFile(f);
  return f;
}

// Référentiels minimaux : catégorie + type d'article, saison, rayon, couleurs, atelier, opérateur, grille.
async function referentiels(appeler, refuse) {
  // Catégories, types d'article, saisons et rayons sont livrés avec l'installation.
  const trouver = async (type, nom) => (await appeler("listes:list", type, { includeInactive: true })).find((x) => x.nom === nom);
  const categorie = await trouver("categorie", "Vestes et Blousons");
  const produit = await trouver("produit", "Blouson");
  const saison = await trouver("saison", "Automne–Hiver");
  const rayon = await trouver("rayon", "Homme");
  await refuse("listes:create", "categorie", "Vestes et blousons");
  await refuse("listes:create", "saison", "Nouvelle", { code: "F W!" });
  const noir = await appeler("listes:create", "couleur", "Noir");
  const marine = await appeler("listes:create", "couleur", "Marine");
  const atelier = await appeler("listes:create", "atelier", "Atelier Sfax", {});
  const operateur = await appeler("listes:create", "operateur", "Tarek");
  await appeler("parametres:setOperateurActif", operateur.id);
  const grille = await appeler("grillesTailles:creer", "Lettres");
  for (const v of ["S", "M", "L", "XL"]) await appeler("grillesTailles:ajouterValeur", grille.id, v);
  await appeler("grillesTailles:setPourProduit", produit.id, grille.id);
  const g = await appeler("grillesTailles:get", grille.id);
  const etapes = await appeler("etapes:list");
  return { categorie, produit, saison, rayon, noir, marine, atelier, operateur, grille: g, etapes };
}

test("productions et fiches techniques : ancien = nouveau", { timeout: 600000 }, (t) => scenario(t, "prod", async ({ appeler, refuse, journal, ancienDb, nouveauDb }) => {
  // Appel direct d'une fonction de module (routes spéciales absentes du registre).
  const ecartsDirects = [];
  const { normaliser, differences } = require("./harnais");
  async function comparerDirect(mod, fn, args) {
    const ancienMod = require(path.join(require("os").tmpdir(), "belvie-electron-1.0.1/electron/ipc", mod));
    const nouveauMod = require(path.join(__dirname, "../../src/modules", mod));
    let a, n, ea = null, en = null;
    try { a = await ancienMod[fn](ancienDb, ...structuredClone(args)); } catch (e) { ea = e.message; }
    try { n = await nouveauMod[fn](nouveauDb, ...structuredClone(args)); } catch (e) { en = e.message.split("\n")[0]; }
    const d = ea || en ? (ea === en ? [] : [`erreur : ancien=${ea} nouveau=${en}`]) : differences(normaliser(a), normaliser(n));
    if (d.length) ecartsDirects.push(`${mod}.${fn} : ${d.join(" | ")}`);
    return n;
  }
  t.after(() => assert.deepEqual(ecartsDirects, [], "écarts sur les appels directs"));
  const ref = await referentiels(appeler, refuse);
  const valeursGrille = ref.grille.valeurs || (await appeler("grillesTailles:get", ref.grille.id)).valeurs;
  assert.ok(Array.isArray(valeursGrille) && valeursGrille.length === 4, "grille de 4 tailles");
  assert.ok(true);

  // ---------------------------------------------------------------- Article
  await refuse("articles:create", { produit_id: ref.produit.id, saison_id: ref.saison.id, rayon_id: ref.rayon.id, annee_collection: 2027, abreviation: "X" });
  const article = await appeler("articles:create", { produit_id: ref.produit.id, saison_id: ref.saison.id, rayon_id: ref.rayon.id, annee_collection: 2027, abreviation: "BOMB", designation: "Blouson bomber" });
  assert.ok(article && article.reference_principale);
  const restaurerUuid = uuidsDeterministes();
  t.after(restaurerUuid);

  // ---------------------------------------------------------------- Fiche technique
  const fiche = await appeler("ficheTechnique:getOrCreateByArticleId", article.id);
  await appeler("ficheTechnique:getOrCreateByArticleId", article.id); // idempotent
  const F = fiche.id;
  await appeler("ficheTechnique:updateNotes", F, "Notes de montage : surpiqûres 3 mm.");
  await appeler("ficheTechnique:updateDescriptionTechnique", F, "<p>Blouson <strong>bomber</strong> doublé, zip YKK n°5.</p><table><tr><td>Poche</td><td>Passepoil</td></tr></table>");
  const coupe = await appeler("listes:create", "coupe", "Droite");
  await appeler("ficheTechnique:updateCoupe", F, coupe.id);

  // Tailles
  await appeler("ficheTechnique:taillesDisponibles", F);
  await appeler("ficheTechnique:analyserChangementGrille", F, ref.grille.id);
  await appeler("ficheTechnique:definirGrille", F, ref.grille.id, {});
  for (const v of valeursGrille.slice(0, 3)) await appeler("ficheTechnique:selectionnerTaille", F, v.id);
  await appeler("ficheTechnique:ajouterTailleExceptionnelle", F, "3XL");
  let ficheLue = await appeler("ficheTechnique:get", F);
  const tailles = ficheLue.grille.tailles;
  if (tailles.length) {
    await appeler("ficheTechnique:tailleAValeurs", tailles[0].id);
    await appeler("ficheTechnique:reorderTailles", F, tailles.map((x) => x.id).reverse());
    await appeler("ficheTechnique:reorderTailles", F, tailles.map((x) => x.id));
    await appeler("ficheTechnique:removeTaille", F, tailles[tailles.length - 1].id);
  }
  await appeler("ficheTechnique:addTaille", F, "XL");
  await appeler("ficheTechnique:searchTaillesCatalogue", "x", 10);
  await appeler("ficheTechnique:confirmerTailles", F);

  // Mesures
  await appeler("ficheTechnique:getMesuresStatut", F);
  await appeler("ficheTechnique:mesuresSuggerees", F);
  const modeles = await appeler("modelesMesures:listByProduitId", ref.produit.id);
  if (modeles && modeles.length) await appeler("ficheTechnique:appliquerModele", F, modeles[0].id);
  else await appeler("ficheTechnique:construireManuellement", F);
  await appeler("ficheTechnique:ensureMesuresGenerees", F);
  await appeler("ficheTechnique:mesuresManquantes", F);
  await appeler("ficheTechnique:searchMesuresCatalogue", "lon", 10);
  await appeler("ficheTechnique:addMesureLigne", F, "Longueur de manche test", { repere: "Z", unite: "cm", tolerance_plus: "1", tolerance_moins: "1" });
  await refuse("ficheTechnique:addMesureLigne", F, "", {});
  await appeler("ficheTechnique:addMesureLigne", F, "Hauteur de col", { repere: "Y", enrichirModele: true, groupe: "detail" });
  await appeler("modelesMesures:listByProduitId", ref.produit.id);
  ficheLue = await appeler("ficheTechnique:get", F);
  const lignes = ficheLue.grille.lignes;
  const taillesF = ficheLue.grille.tailles;
  if (lignes.length && taillesF.length) {
    const m0 = lignes[0].id;
    await appeler("ficheTechnique:updateMesureLigne", F, m0, { tolerance_plus: "0,5", commentaire: "à plat" });
    for (const [i, tt] of taillesF.entries()) await appeler("ficheTechnique:setValeur", F, m0, tt.id, 60 + i * 2);
    await appeler("ficheTechnique:setValeur", F, m0, taillesF[0].id, null);
    await appeler("ficheTechnique:setValeur", F, m0, taillesF[0].id, "58,5");
    await appeler("ficheTechnique:intervallesGradation", F, m0);
    if (taillesF.length > 1) {
      await appeler("ficheTechnique:setGradation", F, m0, taillesF[0].id, taillesF[1].id, 2);
      await appeler("ficheTechnique:simulerGradation", F, m0, taillesF[0].id);
      await appeler("ficheTechnique:appliquerGradation", F, m0, taillesF[0].id, "vides");
    }
    await appeler("ficheTechnique:reorderMesuresLignes", F, lignes.map((l) => l.id).reverse());
    if (lignes.length > 2) await appeler("ficheTechnique:removeMesureLigne", F, lignes[lignes.length - 1].id);
  }
  await refuse("ficheTechnique:ajouterMesuresManquantes", F, []);
  const manquantes = await appeler("ficheTechnique:mesuresManquantes", F);
  if (Array.isArray(manquantes) && manquantes.length) await appeler("ficheTechnique:ajouterMesuresManquantes", F, manquantes.slice(0, 2));
  await appeler("ficheTechnique:getMesuresStatut", F);

  // Croquis et annotations
  const img1 = await imageTemporaire("face", "#223344");
  const img2 = await imageTemporaire("dos", "#884422");
  const c1 = await appeler("ficheTechnique:addCroquis", F, img1, { vue: "face", legende: "Vue de face" });
  const c2 = await appeler("ficheTechnique:addCroquis", F, img2, { vue: "autre", vue_personnalisee: "Intérieur" });
  await refuse("ficheTechnique:addCroquis", F, img2, { vue: "autre" });
  await appeler("ficheTechnique:updateCroquis", c1.id, { legende: "Face (zip fermé)" });
  await appeler("ficheTechnique:reorderCroquis", F, [c2.id, c1.id]);
  const a1 = await appeler("ficheTechnique:addAnnotation", c1.id, { texte: "Zip YKK", ancre_x: 0.4, ancre_y: 0.3, label_x: 0.8, label_y: 0.2 });
  const a2 = await appeler("ficheTechnique:addAnnotation", c1.id, { texte: "Bord-côte", ancre_x: 0.5, ancre_y: 0.9, label_x: 0.9, label_y: 0.9 });
  await appeler("ficheTechnique:updateAnnotation", a1.id, { texte: "Zip YKK n°5" });
  await appeler("ficheTechnique:deleteAnnotation", a2.id);
  await appeler("ficheTechnique:deleteCroquis", c2.id);

  // Matières
  const tissu = await appeler("ficheTechnique:addMatiere", F, { nom: "Nylon satiné", utilisation: "Extérieur", composition: "100% polyamide", unite: "m", consommation_technique: 1.6, perte_pourcent: 5 });
  const doublure = await appeler("ficheTechnique:addMatiere", F, { nom: "Doublure orange", unite: "m", mode_consommation: "par_taille", perte_pourcent: 3 });
  await refuse("ficheTechnique:addMatiere", F, { nom: "Bad", consommation_technique: -1 });
  await refuse("ficheTechnique:addMatiere", F, { nom: "Bad", unite: "litre" });
  await refuse("ficheTechnique:addMatiere", F, { nom: "  " });
  await appeler("ficheTechnique:updateMatiere", tissu.id, { grammage: "120 g/m²", consommation_technique: "1.65" });
  await refuse("ficheTechnique:updateMatiere", tissu.id, { mode_consommation: "n'importe" });
  await appeler("ficheTechnique:searchMatieresCatalogue", "ny", 10);
  const coloNoir = await appeler("ficheTechnique:createMatiereCouleur", tissu.matiere_catalogue_id, { libelle: "Noir", code: "N01", reference: "NY-N01" });
  const coloMarine = await appeler("ficheTechnique:createMatiereCouleur", tissu.matiere_catalogue_id, { libelle: "Marine", code: "M02" });
  await refuse("ficheTechnique:createMatiereCouleur", tissu.matiere_catalogue_id, { libelle: "noir" });
  await appeler("ficheTechnique:listMatiereCouleurs", tissu.matiere_catalogue_id);
  const mc1 = await appeler("ficheTechnique:addMatiereCouleur", tissu.id, { couleur_produit_id: ref.noir.id, matiere_couleur_id: coloNoir.id });
  await appeler("ficheTechnique:addMatiereCouleur", tissu.id, { couleur_produit_id: ref.marine.id, matiere_couleur_id: coloMarine.id });
  await refuse("ficheTechnique:addMatiereCouleur", tissu.id, { couleur_produit_id: ref.noir.id });
  await appeler("ficheTechnique:updateMatiereCouleur", mc1.id, { matiere_couleur_id: coloNoir.id });
  for (const [i, tt] of (await appeler("ficheTechnique:get", F)).grille.tailles.entries()) await appeler("ficheTechnique:setConsommationTaille", doublure.id, tt.id, 1.1 + i * 0.1);
  await appeler("ficheTechnique:listConsommationsTaille", doublure.id);
  await appeler("ficheTechnique:listMatieres", F);
  await appeler("ficheTechnique:reorderMatieres", F, [doublure.id, tissu.id]);
  const jetable = await appeler("ficheTechnique:addMatiere", F, { nom: "Ouatine", unite: "m", consommation_technique: 0.8 });
  await appeler("ficheTechnique:deleteMatiere", jetable.id);

  // Fournitures
  await appeler("ficheTechnique:searchAccessoiresCatalogue", "zip", 10, null);
  const zip = await appeler("ficheTechnique:addAccessoire", F, { nom: "Zip séparable", famille: "composant", reference: "YKK-5", unite: "pièce", consommation_par_piece: 1, emplacement: "Devant" });
  const bouton = await appeler("ficheTechnique:addAccessoire", F, { nom: "Bouton pression", famille: "composant", unite: "pièce", consommation_par_piece: 4 });
  await appeler("ficheTechnique:updateAccessoire", bouton.id, { consommation_par_piece: 6, description: "Pressions cachées" });
  const photoAcc = await imageTemporaire("zip", "#111111");
  await appeler("ficheTechnique:setAccessoirePhoto", zip.id, photoAcc);
  const fc1 = await appeler("ficheTechnique:addFournitureCouleur", zip.id, { couleur_produit_id: ref.noir.id, couleur_fourniture: "Noir", reference: "580" });
  await appeler("ficheTechnique:addFournitureCouleur", zip.id, { couleur_produit_id: ref.marine.id, couleur_fourniture: "Marine", consommation_par_piece: 1 });
  await refuse("ficheTechnique:addFournitureCouleur", zip.id, { couleur_produit_id: ref.noir.id });
  await appeler("ficheTechnique:updateFournitureCouleur", fc1.id, { reference: "580-N" });
  await appeler("ficheTechnique:listFournitureCouleurs", zip.id);
  const toutes = (await appeler("ficheTechnique:get", F)).accessoires || [];
  await appeler("ficheTechnique:reorderAccessoires", F, toutes.map((x) => x.id).reverse());
  const jetableF = await appeler("ficheTechnique:addAccessoire", F, { nom: "Étiquette test", famille: "habillage", unite: "pièce", consommation_par_piece: 1 });
  await appeler("ficheTechnique:deleteAccessoire", jetableF.id);
  const fcJ = await appeler("ficheTechnique:addFournitureCouleur", bouton.id, { couleur_produit_id: ref.noir.id, couleur_fourniture: "Gun" });
  await appeler("ficheTechnique:deleteFournitureCouleur", fcJ.id);

  await appeler("ficheTechnique:get", F);
  await appeler("ficheTechnique:listAll");
  await appeler("ficheTechnique:validerFiche", F);
  await refuse("ficheTechnique:validerFiche", F);
  await refuse("ficheTechnique:addMatiere", F, { nom: "Après validation" });
  await appeler("ficheTechnique:get", F);

  // ---------------------------------------------------------------- Commandes
  const etape = ref.etapes[0];
  const [vS, vM, vL] = valeursGrille;
  const base = {
    article_id: article.id, type_production: "nouveau", responsable_nom: "Sami", atelier_id: ref.atelier.id,
    date_lancement: "2027-01-10", date_fin_prevue: "2027-02-20", etape_id: etape.id, priorite: "haute", commentaires: "Première série",
    lignes: [
      { couleur_id: ref.noir.id, taille_id: vS.id, quantite: 40 }, { couleur_id: ref.noir.id, taille_id: vM.id, quantite: 60 },
      { couleur_id: ref.marine.id, taille_id: vM.id, quantite: 30, reference_libre: "MAR-01" }, { couleur_id: ref.marine.id, taille_id: vL.id, quantite: 20 },
    ],
  };
  await refuse("commandes:create", { ...base, lignes: [] });
  await refuse("commandes:create", { ...base, date_fin_prevue: "2026-12-01" });
  await refuse("commandes:create", { ...base, responsable_nom: " " });
  await refuse("commandes:create", { ...base, lignes: [{ couleur_id: ref.noir.id, taille_id: vS.id, quantite: 0 }] });
  const cmd = await appeler("commandes:create", base);
  await refuse("commandes:create", base); // un seul « nouveau » par article
  assert.equal(cmd.statut, "brouillon");
  assert.equal(cmd.lignes.length, 4);
  const reassort = await appeler("commandes:create", { ...base, type_production: "reassort", commentaires: null, priorite: undefined });
  const reassort2 = await appeler("commandes:create", { ...base, type_production: "reassort", lignes: [{ couleur_id: ref.noir.id, taille_id: vL.id, quantite: 12 }] });
  await appeler("commandes:list");
  await appeler("commandes:update", cmd.id, { commentaires: "Série corrigée", priorite: "normale", lignes: [...base.lignes, { couleur_id: ref.marine.id, taille_id: vS.id, quantite: 10 }] });
  await refuse("commandes:update", cmd.id, { date_lancement: "2027-03-01" });
  await refuse("commandes:update", 999999, { commentaires: "x" });
  await appeler("commandes:besoinsMatieres", cmd.id);

  // Brouillon supprimé
  await appeler("commandes:remove", reassort2.id);
  await refuse("commandes:remove", reassort2.id);

  // Cycle de vie
  await refuse("commandes:lancerProduction", cmd.id);
  await appeler("commandes:valider", cmd.id);
  await refuse("commandes:valider", cmd.id);
  await refuse("commandes:remove", cmd.id);
  await refuse("commandes:update", cmd.id, { article_id: article.id });
  await appeler("commandes:update", cmd.id, { lignes: base.lignes });
  await refuse("commandes:bloquer", cmd.id, "  ");
  await appeler("commandes:bloquer", cmd.id, "Tissu en retard");
  await refuse("commandes:bloquer", cmd.id, "encore");
  await appeler("commandes:debloquer", cmd.id);
  await refuse("commandes:debloquer", cmd.id);
  await appeler("commandes:besoinsMatieres", cmd.id);

  // ---------------------------------------------------------------- BC PF
  // Sans entreprise configurée, l'ancien code échoue déjà sur un paramètre nommé manquant (bug
  // existant, signalé) : on configure l'entreprise comme le fait l'assistant de démarrage.
  await appeler("entreprise:save", { nom_commercial: "Belvie", raison_sociale: "Belvie SARL", matricule_fiscal: "1234567/A/M/000", adresse: "Rue de la Mode", code_postal: "3000", ville: "Sfax", pays: "Tunisie", telephone: "+216 00 000 000", email: "contact@belvie.test" });
  const logo = await imageTemporaire("logo", "#AA3366");
  await appeler("entreprise:setLogo", logo);
  await appeler("bcPf:getByCommandeId", cmd.id);
  const bc = await appeler("bcPf:creer", cmd.id);
  await refuse("bcPf:creer", cmd.id);
  await appeler("bcPf:update", bc.id, { notes_atelier: "Repassage à plat", observations_internes: "Client exigeant" });
  await appeler("commandes:update", cmd.id, { lignes: [...base.lignes, { couleur_id: ref.noir.id, taille_id: vL.id, quantite: 5 }] });
  await appeler("bcPf:mettreAJourDepuisCommande", bc.id);
  await appeler("bcPf:valider", bc.id);
  await refuse("bcPf:valider", bc.id);
  await refuse("bcPf:update", bc.id, { notes_atelier: "trop tard" });
  await refuse("commandes:update", cmd.id, { lignes: base.lignes });
  await refuse("bcPf:remplacer", bc.id, "");
  const bc2 = await appeler("bcPf:remplacer", bc.id, "Erreur de quantités");
  assert.ok(bc2 && (bc2.id || (bc2.nouveau && bc2.nouveau.id)), "le remplacement crée un nouveau BC");
  await appeler("bcPf:listForCommande", cmd.id);
  await appeler("bcPf:get", bc.id);
  await appeler("bcPf:get", bc2.id || (bc2.nouveau && bc2.nouveau.id));

  // Lancement (route spéciale bcPf:lancer = lancerBcPf puis passage en production) — comparé
  // directement module à module, hors registre.
  const idBc2 = bc2.id || (bc2.nouveau && bc2.nouveau.id);
  await appeler("bcPf:valider", idBc2);
  const lance = await comparerDirect("bcPf", "lancerBcPf", [idBc2]);
  assert.equal(lance.statut, "lance");
  await appeler("commandes:lancerProduction", cmd.id);
  await refuse("commandes:lancerProduction", cmd.id);
  await appeler("commandes:entrerEnControleQualite", cmd.id);
  await refuse("commandes:archiver", cmd.id);
  await appeler("commandes:terminerProduction", cmd.id);
  await refuse("commandes:annuler", cmd.id, "trop tard");
  await appeler("commandes:archiver", cmd.id);
  await refuse("commandes:archiver", cmd.id);
  await appeler("commandes:desarchiver", cmd.id);
  await refuse("commandes:desarchiver", cmd.id);

  await appeler("commandes:valider", reassort.id);
  await refuse("commandes:annuler", reassort.id, "");
  await appeler("commandes:annuler", reassort.id, "Client annulé");
  await appeler("commandes:archiver", reassort.id);
  await appeler("commandes:get", cmd.id);
  await appeler("commandes:get", reassort.id);
  await appeler("commandes:list");

  // ---------------------------------------------------------------- Révision de nomenclature
  const r3 = await appeler("commandes:create", { ...base, type_production: "reassort", lignes: [{ couleur_id: ref.marine.id, taille_id: vS.id, quantite: 8 }] });
  await appeler("commandes:valider", r3.id);
  await appeler("ficheTechnique:apercuModification", F);
  await refuse("ficheTechnique:rouvrirPourModification", 999999, {});
  await appeler("ficheTechnique:rouvrirPourModification", F, { motif: "Changement de doublure", operateur_id: ref.operateur.id });
  await refuse("ficheTechnique:rouvrirPourModification", F, { motif: "deux fois" });
  await appeler("ficheTechnique:updateMatiere", doublure.id, { nom: "Doublure bleue" });
  await appeler("ficheTechnique:deleteMatiereCouleur", mc1.id);
  await appeler("ficheTechnique:validerFiche", F);
  const revs = await appeler("ficheTechnique:listRevisions", F);
  assert.ok(revs.length >= 1, "révision archivée");
  for (const rv of revs || []) await appeler("ficheTechnique:getRevision", rv.id);
  await refuse("ficheTechnique:getRevision", 999999);
  await appeler("commandes:besoinsMatieres", r3.id);
  await appeler("ficheTechnique:apercuModification", F);
  await appeler("ficheTechnique:rouvrirPourModification", F, { motif: "Deuxième révision" });
  await appeler("ficheTechnique:validerFiche", F);
  const revsFin = await appeler("ficheTechnique:listRevisions", F);
  assert.equal(revsFin.length, 2);
  const finale = await appeler("commandes:get", cmd.id);
  assert.equal(finale.statut, "terminee");
  assert.equal((await appeler("commandes:get", reassort.id)).statut, "annulee");

  // ---------------------------------------------------------------- HTML des PDF (ancien = nouveau) et vrais PDF
  {
    const dossierAncien = path.join(os.tmpdir(), "belvie-electron-1.0.1/electron/ipc");
    const A = (m) => require(path.join(dossierAncien, m));
    const N = (m) => require(path.join(__dirname, "../../src/modules", m));
    const entA = A("entreprise").get(ancienDb); const entN = await N("entreprise").get(nouveauDb);
    const ficheA = A("ficheTechnique").get(ancienDb, F); const ficheN = await N("ficheTechnique").get(nouveauDb, F);
    const artA = A("articles").get(ancienDb, article.id); const artN = await N("articles").get(nouveauDb, article.id);
    const masquer = (h) => h.replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/g, "<horodatage>").replace(/\d{2}\/\d{2}\/\d{4}/g, "<date>");
    const htmlFicheA = A("ficheTechniquePdf").buildFicheTechniqueHtml(ficheA, artA, entA);
    const htmlFicheN = N("ficheTechniquePdf").buildFicheTechniqueHtml(ficheN, artN, entN);
    assert.equal(masquer(htmlFicheN), masquer(htmlFicheA), "HTML de la fiche technique identique");
    const bcA = A("bcPf").get(ancienDb, idBc2); const bcN = await N("bcPf").get(nouveauDb, idBc2);
    const htmlBcA = A("bcPfPdf").buildBcPfHtml(bcA, entA); const htmlBcN = N("bcPfPdf").buildBcPfHtml(bcN, entN);
    assert.equal(masquer(htmlBcN), masquer(htmlBcA), "HTML du BC PF identique");

    process.env.CHROMIUM_PATH = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium";
    const pdfFiche = path.join(os.tmpdir(), `belvie-test-${process.pid}-fiche.pdf`);
    const pdfBc = path.join(os.tmpdir(), `belvie-test-${process.pid}-bc.pdf`);
    try {
      const rf = await N("ficheTechniquePdf").genererPdfDepuisFenetreDediee(htmlFicheN, pdfFiche);
      const contenuFiche = fs.readFileSync(pdfFiche);
      assert.ok(contenuFiche.length > 5000 && contenuFiche.subarray(0, 5).toString() === "%PDF-", "PDF fiche valide");
      const pagesReelles = (contenuFiche.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
      assert.ok(rf && rf.pages >= 1, "pagination renvoyée");
      assert.equal(pagesReelles, rf.pages, "nombre de pages annoncé = pages du PDF");
      await N("bcPfPdf").genererPdfDepuisFenetreDediee(htmlBcN, pdfBc);
      const contenuBc = fs.readFileSync(pdfBc);
      assert.ok(contenuBc.length > 3000 && contenuBc.subarray(0, 5).toString() === "%PDF-", "PDF BC valide");
    } finally {
      fs.rmSync(pdfFiche, { force: true }); fs.rmSync(pdfBc, { force: true });
      await require("../../src/lib/fenetreImpression").fermerNavigateur();
    }
  }

  // ---------------------------------------------------------------- Mesures : autres parcours
  const article2 = await appeler("articles:create", { produit_id: ref.produit.id, saison_id: ref.saison.id, rayon_id: ref.rayon.id, annee_collection: 2027, abreviation: "PARKA" });
  const f2 = (await appeler("ficheTechnique:getOrCreateByArticleId", article2.id)).id;
  await appeler("ficheTechnique:definirGrille", f2, ref.grille.id, {});
  await appeler("ficheTechnique:selectionnerTaille", f2, vM.id);
  await appeler("ficheTechnique:construireManuellement", f2);
  await appeler("ficheTechnique:reinitialiserChoixMesures", f2);
  await refuse("ficheTechnique:creerTableauMesures", f2, []);
  await appeler("ficheTechnique:creerTableauMesures", f2, [{ nom: "Tour de poitrine", repere: "A", unite: "cm", groupe: "principale" }, { nom: "Longueur dos", repere: "B" }, { nom: "" }]);
  await refuse("ficheTechnique:creerTableauMesures", f2, [{ nom: "Encore" }]);
  await appeler("ficheTechnique:get", f2);
  await appeler("ficheTechnique:archiverFiche", f2);
  await refuse("ficheTechnique:addMatiere", f2, { nom: "Après archivage" });
  await appeler("ficheTechnique:listAll");


  // Refus détectés APRÈS l'insertion de la commande (dans la transaction, donc annulée) : en fin de
  // scénario, car PostgreSQL consomme quand même une valeur de séquence (trou dans les id, sans
  // effet fonctionnel), alors que SQLite la rend. Placés plus tôt, ils décaleraient tous les id.
  await refuse("commandes:create", { ...base, type_production: "reassort", lignes: [{ couleur_id: ref.atelier.id, taille_id: vS.id, quantite: 3 }] });
  await refuse("commandes:create", { ...base, type_production: "reassort", atelier_id: ref.noir.id });

  if (process.env.COUVERTURE) fs.writeFileSync(process.env.COUVERTURE, JSON.stringify(journal.map((e) => e.canal)));
}));
