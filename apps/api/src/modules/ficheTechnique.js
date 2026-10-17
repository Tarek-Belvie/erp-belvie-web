const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("../lib/asyncArray.js");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const { dossierDonnees } = require("../lib/plateforme");
const sharp = require("sharp");
const { normalizeNom, stripAccents } = require("../lib/normalize");
const modelesMesuresApi = require("./modelesMesures");
const { assainirDescription } = require("./descriptionTechnique");

const ALLOWED_EXT = [".jpg", ".jpeg", ".png", ".webp"];
const MAX_SIZE_BYTES = 10 * 1024 * 1024;

function getUserDataDir() { return dossierDonnees(); }
function getCroquisDir() { return path.join(getUserDataDir(), "images", "fiches-techniques"); }
function getAccessoiresDir() { return path.join(getUserDataDir(), "images", "fiches-techniques-accessoires"); }
function ensureDir(dir) { fs.mkdirSync(dir, { recursive: true }); }
function toRelative(absPath) { return path.relative(getUserDataDir(), absPath).split(path.sep).join("/"); }

function validateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) throw new Error("Format d'image non pris en charge. Utilisez JPG, JPEG, PNG ou WEBP.");
  if (!fs.existsSync(filePath)) throw new Error("Le fichier sélectionné est introuvable.");
  if (fs.statSync(filePath).size > MAX_SIZE_BYTES) throw new Error("L'image dépasse la taille maximale autorisée (10 Mo).");
  return { ext };
}

// Copie le croquis dans le stockage de l'ERP, en corrigeant l'orientation EXIF mais sans
// recompresser agressivement : un croquis technique doit rester net à l'impression, contrairement
// à une simple miniature d'aperçu.
async function copyIntoStore(sourcePath, dir) {
  ensureDir(dir);
  const { ext } = validateFile(sourcePath);
  const uniqueName = `${crypto.randomUUID()}${ext}`;
  const destAbs = path.join(dir, uniqueName);
  await sharp(sourcePath).rotate().toFile(destAbs);
  return toRelative(destAbs);
}

function removeFile(relPath) {
  if (!relPath) return;
  try {
    const abs = path.join(getUserDataDir(), relPath);
    if (fs.existsSync(abs)) fs.unlinkSync(abs);
  } catch (err) {
    console.error("Suppression du fichier impossible (non bloquant) :", err);
  }
}

// --- Fiche technique ---

// Fournitures d'habillage posées d'office sur une fiche NEUVE : ce sont celles qui reviennent sur
// pratiquement chaque modèle, les préremplir évite de les ressaisir à chaque fois.
// Consommation 1 pièce/pièce par défaut, modifiable comme n'importe quelle autre ligne.
const HABILLAGE_INITIAL = [
  "Étiquette de marque", "Étiquette de composition", "Étiquette branding",
  "Hang tag", "Fil / attache hang tag", "Emballage transparent", "Étiquette code à barre",
];

async function getOrCreateByArticleId(db, articleId) {
  let fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE article_id = ?").get(articleId);
  if (!fiche) {
    const info = await db.prepare("INSERT INTO fiches_techniques (article_id) VALUES (?)").run(articleId);
    fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(info.lastInsertRowid);
    // Placé DANS la branche de création, et nulle part ailleurs. getOrCreateByArticleId est appelée
    // à chaque ouverture de la fiche : c'est ce `if (!fiche)` qui garantit que le préremplissage
    // n'a lieu qu'une fois dans la vie de la fiche. Une ligne supprimée volontairement ne peut donc
    // JAMAIS réapparaître, sans qu'aucun marqueur ni colonne supplémentaire ne soit nécessaire.
    // La double sécurité (comptage ci-dessous) couvre le cas théorique d'une fiche recréée avec un
    // id réutilisé après suppression.
    const dejaDesLignes = (await db.prepare("SELECT COUNT(*) AS n FROM ft_accessoires WHERE fiche_id = ?").get(fiche.id)).n;
    if (dejaDesLignes === 0) {
      try {
        const tx = db.transaction(async () => {
          for (const nom of HABILLAGE_INITIAL) {
            await addAccessoire(db, fiche.id, {
              nom: nom, famille: "habillage", unite: "pièce", consommation_par_piece: 1,
            });
          }
        });
        await tx();
      } catch (err) {
        // Le préremplissage est un confort, jamais une condition d'ouverture : si une ligne pose
        // problème, la fiche s'ouvre quand même, vide, et l'utilisateur ajoute à la main.
        console.error("Preremplissage Habillage impossible (non bloquant) :", err);
      }
    }
  }
  return fiche;
}

async function updateNotes(db, ficheId, notes) {
  await assertModifiable(db, ficheId);
  await db.prepare("UPDATE fiches_techniques SET notes = ? WHERE id = ?").run(notes || null, ficheId);
  return await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
}

// Description technique : le HTML reçu de l'éditeur est TOUJOURS réduit à la liste blanche avant
// d'être écrit. L'interface empêche déjà de produire autre chose, mais c'est ici que la garantie
// est réellement tenue : même un appel direct ou un copier-coller exotique ne peut pas faire
// entrer en base une police, une couleur ou un script. Une description vide est enregistrée à
// NULL, jamais sous la forme d'un paragraphe vide qui ferait croire à une section remplie.
async function updateDescriptionTechnique(db, ficheId, html) {
  await assertModifiable(db, ficheId);
  const propre = assainirDescription(html);
  await db.prepare("UPDATE fiches_techniques SET description_technique = ? WHERE id = ?").run(propre, ficheId);
  return await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
}

async function updateCoupe(db, ficheId, coupeId) {
  await assertModifiable(db, ficheId);
  await db.prepare("UPDATE fiches_techniques SET coupe_id = ? WHERE id = ?").run(coupeId || null, ficheId);
  return await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
}

async function assertModifiable(db, ficheId) {
  const fiche = await db.prepare("SELECT statut FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  if (fiche.statut !== "brouillon") {
    throw new Error("Cette fiche n'est plus en brouillon : elle ne peut plus être modifiée dans cette version.");
  }
}

async function ficheIdFromCroquisId(db, croquisId) {
  const row = await db.prepare("SELECT fiche_id FROM ft_croquis WHERE id = ?").get(croquisId);
  if (!row) throw new Error("Croquis introuvable.");
  return row.fiche_id;
}

async function ficheIdFromAnnotationId(db, annotationId) {
  const row = await db.prepare("SELECT c.fiche_id AS fiche_id FROM ft_annotations a JOIN ft_croquis c ON c.id = a.croquis_id WHERE a.id = ?").get(annotationId);
  if (!row) throw new Error("Annotation introuvable.");
  return row.fiche_id;
}

async function ficheIdFromAccessoireId(db, accessoireId) {
  const row = await db.prepare("SELECT fiche_id FROM ft_accessoires WHERE id = ?").get(accessoireId);
  if (!row) throw new Error("Accessoire introuvable.");
  return row.fiche_id;
}

/**
 * Valide une fiche — et attribue automatiquement son numéro de révision.
 *
 * La règle tient en une phrase : le numéro désigne une version VALIDÉE. Il n'avance donc qu'ici,
 * et seulement si la version précédente a réellement été archivée, c'est-à-dire si la fiche a été
 * rouverte pour modification. Une première validation reste donc en V1, et une fiche rouverte
 * puis revalidée passe en V2, V3, etc. L'utilisateur n'a rien à saisir ni à gérer.
 *
 * Le test « une archive porte-t-elle déjà ce numéro ? » est volontairement préféré à un drapeau
 * posé à la réouverture : il se fonde sur un fait vérifiable en base, pas sur un état qu'un
 * incident pourrait laisser de travers.
 */
async function validerFiche(db, ficheId) {
  const fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  if (fiche.statut !== "brouillon") throw new Error("Seule une fiche en brouillon peut être validée.");

  let revision = fiche.revision != null ? Number(fiche.revision) : 1;
  const archiveExiste = (await tableRevisionsPresente(db))
    && !!(await db.prepare(
      "SELECT 1 FROM fiches_techniques_revisions WHERE fiche_id = ? AND revision = ?"
    ).get(ficheId, revision));
  if (archiveExiste) revision += 1;

  if (await colonneRevisionPresente(db)) {
    await db.prepare(
      "UPDATE fiches_techniques SET statut = 'validee', validated_at = maintenant(), revision = ? WHERE id = ?"
    ).run(revision, ficheId);
  } else {
    await db.prepare("UPDATE fiches_techniques SET statut = 'validee', validated_at = maintenant() WHERE id = ?").run(ficheId);
  }
  return await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
}

// Gardes de compatibilité : une base qui n'aurait pas encore reçu la migration des révisions
// continue de fonctionner exactement comme avant, sans numéro et sans archive.
async function tableRevisionsPresente(db) {
  return !!(await db.prepare(
    "SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'fiches_techniques_revisions'"
  ).get());
}
async function colonneRevisionPresente(db) {
  return (await db.colonnes("fiches_techniques")).some((c) => c.name === "revision");
}

async function archiverFiche(db, ficheId) {
  await db.prepare("UPDATE fiches_techniques SET statut = 'archivee', archived_at = maintenant() WHERE id = ?").run(ficheId);
  return await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
}

async function get(db, ficheId) {
  const fiche = await db.prepare(
    "SELECT ft.*, lv.nom AS coupe_nom FROM fiches_techniques ft LEFT JOIN listes_valeurs lv ON lv.id = ft.coupe_id WHERE ft.id = ?"
  ).get(ficheId);
  if (!fiche) return null;
  return Object.assign({}, fiche, {
    croquis: await listCroquis(db, ficheId),
    grille: await getGrille(db, ficheId),
    accessoires: await listAccessoires(db, ficheId),
    matieres: await listMatieres(db, ficheId),
  });
}

// Vue d'ensemble pour le menu principal : chaque fiche avec le contexte de son article, un
// indicateur d'avancement (nombre de croquis/mesures/accessoires déjà renseignés), sans charger
// le détail complet de chacune (get() reste l'appel dédié pour ouvrir une fiche précise).
async function listAll(db) {
  const fiches = await db.prepare(
    "SELECT ft.*, ar.reference_principale, ar.saison_id, p.nom AS produit, s.nom AS saison " +
    "FROM fiches_techniques ft " +
    "JOIN articles ar ON ar.id = ft.article_id " +
    "JOIN listes_valeurs p ON p.id = ar.produit_id " +
    "LEFT JOIN listes_valeurs s ON s.id = ar.saison_id " +
    "ORDER BY ft.updated_at DESC"
  ).all();
  const nbCroquis = db.prepare("SELECT COUNT(*) AS n FROM ft_croquis WHERE fiche_id = ?");
  const nbMesures = db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes WHERE fiche_id = ?");
  const nbAccessoires = db.prepare("SELECT COUNT(*) AS n FROM ft_accessoires WHERE fiche_id = ?");
  const nbMatieres = db.prepare("SELECT COUNT(*) AS n FROM ft_matieres WHERE fiche_id = ?");
  return await mapSeq(fiches, async f => Object.assign({}, f, {
    nb_croquis: (await nbCroquis.get(f.id)).n,
    nb_mesures: (await nbMesures.get(f.id)).n,
    nb_accessoires: (await nbAccessoires.get(f.id)).n,
    nb_matieres: (await nbMatieres.get(f.id)).n,
  }));
}

// --- Croquis (plusieurs vues : face / dos / detail / autre) ---

const VUES_VALIDES = ["face", "dos", "detail", "autre"];

async function addCroquis(db, ficheId, sourcePath, options) {
  await assertModifiable(db, ficheId);
  const opts = options || {};
  const vue = VUES_VALIDES.includes(opts.vue) ? opts.vue : "face";
  if (vue === "autre" && !String(opts.vue_personnalisee || "").trim()) {
    throw new Error("Merci de préciser le nom de la vue personnalisée.");
  }
  const imagePath = await copyIntoStore(sourcePath, getCroquisDir());
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_croquis WHERE fiche_id = ?").get(ficheId)).m || 0;
  const info = await db.prepare(
    "INSERT INTO ft_croquis (fiche_id, vue, vue_personnalisee, image_path, legende, ordre) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(ficheId, vue, vue === "autre" ? opts.vue_personnalisee.trim() : null, imagePath, opts.legende || null, maxOrdre + 1);
  return await db.prepare("SELECT * FROM ft_croquis WHERE id = ?").get(info.lastInsertRowid);
}

async function updateCroquis(db, croquisId, patch) {
  const current = await db.prepare("SELECT * FROM ft_croquis WHERE id = ?").get(croquisId);
  if (!current) throw new Error("Croquis introuvable.");
  await assertModifiable(db, current.fiche_id);
  const vue = patch.vue !== undefined ? patch.vue : current.vue;
  if (!VUES_VALIDES.includes(vue)) throw new Error("Vue invalide.");
  const vuePerso = vue === "autre" ? String(patch.vue_personnalisee !== undefined ? patch.vue_personnalisee : current.vue_personnalisee || "").trim() : null;
  if (vue === "autre" && !vuePerso) throw new Error("Merci de préciser le nom de la vue personnalisée.");
  const legende = patch.legende !== undefined ? (patch.legende || null) : current.legende;
  await db.prepare("UPDATE ft_croquis SET vue = ?, vue_personnalisee = ?, legende = ? WHERE id = ?").run(vue, vuePerso, legende, croquisId);
  return await db.prepare("SELECT * FROM ft_croquis WHERE id = ?").get(croquisId);
}

async function deleteCroquis(db, croquisId) {
  const c = await db.prepare("SELECT * FROM ft_croquis WHERE id = ?").get(croquisId);
  if (!c) return { deleted: false };
  await assertModifiable(db, c.fiche_id);
  await db.prepare("DELETE FROM ft_croquis WHERE id = ?").run(croquisId); // ON DELETE CASCADE supprime les annotations liées
  removeFile(c.image_path);
  return { deleted: true };
}

async function reorderCroquis(db, ficheId, orderedIds) {
  await assertModifiable(db, ficheId);
  const update = db.prepare("UPDATE ft_croquis SET ordre = ? WHERE id = ? AND fiche_id = ?");
  const tx = db.transaction(async () => {
    for (const [i, id] of orderedIds.entries()) {
      await update.run(i, id, ficheId);
    }
  });
  await tx();
  return await listCroquis(db, ficheId);
}

async function listCroquis(db, ficheId) {
  const croquis = await db.prepare("SELECT * FROM ft_croquis WHERE fiche_id = ? ORDER BY ordre, id").all(ficheId);
  const annStmt = db.prepare("SELECT * FROM ft_annotations WHERE croquis_id = ? ORDER BY ordre, id");
  return await mapSeq(
    croquis,
    async c => Object.assign({}, c, { annotations: await annStmt.all(c.id) })
  );
}

// --- Annotations : jamais fusionnées dans l'image, coordonnées normalisées 0-1 ---

const ANNOTATION_CHAMPS_OPTIONNELS = ["style_fleche", "couleur", "epaisseur", "orientation_texte", "visible_impression"];

async function addAnnotation(db, croquisId, payload) {
  await assertModifiable(db, await ficheIdFromCroquisId(db, croquisId));
  const t = String(payload.texte || "").trim();
  if (!t) throw new Error("Le texte de l'annotation est obligatoire.");
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_annotations WHERE croquis_id = ?").get(croquisId)).m || 0;
  const info = await db.prepare(
    "INSERT INTO ft_annotations (croquis_id, ancre_x, ancre_y, label_x, label_y, texte, ordre) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(croquisId, payload.ancre_x, payload.ancre_y, payload.label_x, payload.label_y, t, maxOrdre + 1);
  const id = info.lastInsertRowid;
  await applyAnnotationOptions(db, id, payload);
  return await db.prepare("SELECT * FROM ft_annotations WHERE id = ?").get(id);
}

async function applyAnnotationOptions(db, annotationId, payload) {
  const fields = ANNOTATION_CHAMPS_OPTIONNELS.filter((f) => payload[f] !== undefined);
  if (fields.length === 0) return;
  const params = { id: annotationId };
  fields.forEach((f) => { params[f] = f === "visible_impression" ? (payload[f] ? 1 : 0) : payload[f]; });
  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  await db.prepare(`UPDATE ft_annotations SET ${setClause} WHERE id = @id`).run(params);
}

async function updateAnnotation(db, annotationId, patch) {
  const current = await db.prepare("SELECT * FROM ft_annotations WHERE id = ?").get(annotationId);
  if (!current) throw new Error("Annotation introuvable.");
  await assertModifiable(db, await ficheIdFromAnnotationId(db, annotationId));
  const ancre_x = patch.ancre_x !== undefined ? patch.ancre_x : current.ancre_x;
  const ancre_y = patch.ancre_y !== undefined ? patch.ancre_y : current.ancre_y;
  const label_x = patch.label_x !== undefined ? patch.label_x : current.label_x;
  const label_y = patch.label_y !== undefined ? patch.label_y : current.label_y;
  const texte = patch.texte !== undefined ? String(patch.texte).trim() : current.texte;
  if (!texte) throw new Error("Le texte de l'annotation est obligatoire.");
  await db.prepare("UPDATE ft_annotations SET ancre_x = ?, ancre_y = ?, label_x = ?, label_y = ?, texte = ? WHERE id = ?")
    .run(ancre_x, ancre_y, label_x, label_y, texte, annotationId);
  await applyAnnotationOptions(db, annotationId, patch);
  return await db.prepare("SELECT * FROM ft_annotations WHERE id = ?").get(annotationId);
}

async function deleteAnnotation(db, annotationId) {
  await assertModifiable(db, await ficheIdFromAnnotationId(db, annotationId));
  await db.prepare("DELETE FROM ft_annotations WHERE id = ?").run(annotationId);
  return { deleted: true };
}

// --- Catalogue des mesures (grandit avec l'usage) ---

async function searchMesuresCatalogue(db, query, limit) {
  const q = stripAccents(normalizeNom(query || ""));
  const all = await db.prepare("SELECT * FROM mesures_catalogue WHERE actif = 1 ORDER BY ordre, nom").all();
  const filtered = q ? all.filter((m) => stripAccents(m.nom_normalise).includes(q)) : all;
  return filtered.slice(0, limit || (q ? 8 : 20));
}

async function getOrCreateMesureCatalogue(db, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la mesure est obligatoire.");
  const nomNormalise = normalizeNom(nomTrim);
  let entry = await db.prepare("SELECT * FROM mesures_catalogue WHERE nom_normalise = ?").get(nomNormalise);
  if (!entry) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM mesures_catalogue").get()).m || 0;
    const info = await db.prepare("INSERT INTO mesures_catalogue (nom, nom_normalise, ordre) VALUES (?, ?, ?)").run(nomTrim, nomNormalise, maxOrdre + 1);
    entry = await db.prepare("SELECT * FROM mesures_catalogue WHERE id = ?").get(info.lastInsertRowid);
  }
  return entry;
}

// --- Lignes de mesures de la fiche (avec repère, unité, tolérances, commentaire) ---

const MESURE_LIGNE_CHAMPS = ["repere", "unite", "tolerance_plus", "tolerance_moins", "commentaire", "nom_local", "groupe"];

// Normalisation IDENTIQUE à celle de l'index partiel idx_ft_mesures_repere_unique :
// UPPER(TRIM(...)). "A", "a" et " A " sont donc le même repère, en base comme ici.
function normaliserRepere(r) {
  return String(r == null ? "" : r).trim().toUpperCase();
}

// Un repère est FACULTATIF, mais unique dans une fiche. Le contrôle est fait ici pour produire un
// message lisible ; l'index partiel reste le filet de sécurité, actif même sur écriture directe.
async function assertRepereLibre(db, ficheId, repere, mesureCatalogueIdExclue) {
  const norm = normaliserRepere(repere);
  if (norm === "") return;   // plusieurs lignes sans repère : toujours autorisé
  const conflit = await db.prepare(
    "SELECT l.mesure_catalogue_id, COALESCE(l.nom_local, mc.nom) AS nom FROM ft_mesures_lignes l " +
    "JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
    "WHERE l.fiche_id = ? AND UPPER(TRIM(COALESCE(l.repere,''))) = ? AND l.mesure_catalogue_id <> ?"
  ).get(ficheId, norm, mesureCatalogueIdExclue == null ? -1 : mesureCatalogueIdExclue);
  if (conflit) {
    throw new Error(`Repère ${norm} déjà utilisé par « ${conflit.nom} » sur cette fiche.`);
  }
}

async function addMesureLigne(db, ficheId, nom, options) {
  await assertModifiable(db, ficheId);
  if (options && options.repere !== undefined) await assertRepereLibre(db, ficheId, options.repere, null);
  const catalogue = await getOrCreateMesureCatalogue(db, nom);
  const existing = await db.prepare("SELECT 1 FROM ft_mesures_lignes WHERE fiche_id = ? AND mesure_catalogue_id = ?").get(ficheId, catalogue.id);
  if (!existing) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_mesures_lignes WHERE fiche_id = ?").get(ficheId)).m || 0;
    const opts = options || {};
    await db.prepare(
      "INSERT INTO ft_mesures_lignes (fiche_id, mesure_catalogue_id, repere, unite, tolerance_plus, tolerance_moins, commentaire, groupe, ordre) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(ficheId, catalogue.id, opts.repere || null, opts.unite || null, opts.tolerance_plus || null, opts.tolerance_moins || null, opts.commentaire || null,
      opts.groupe === "detail" || opts.groupe === "principale" ? opts.groupe : modelesMesuresApi.groupeDeMesure(catalogue.nom), maxOrdre + 1);

    // APPRENTISSAGE — uniquement si demande explicitement (case cochee par defaut cote interface).
    // La mesure enrichit le modele du TYPE de l'article, donc les prochaines fiches de ce type.
    // Decochee, elle reste strictement locale a cette fiche.
    if (opts.enrichirModele) {
      try { await enrichirModeleDuType(db, ficheId, catalogue.nom, opts); }
      catch (err) { console.error("Enrichissement du modele impossible (non bloquant) :", err); }
    }
  }
  return await getGrille(db, ficheId);
}

// Ajoute la mesure au modele du type de l'article. Ne cree un modele QUE si aucun n'existe et que
// l'enrichissement est demande : on ne fabrique jamais de modele inutile.
// L'index UNIQUE(modele_id, mesure_catalogue_id) garantit l'absence de doublon, et addLigne ignore
// deja une mesure presente. Les tableaux DEJA crees ne sont jamais modifies retroactivement :
// on n'ecrit que dans le modele, jamais dans les autres ft_mesures_lignes.
async function enrichirModeleDuType(db, ficheId, nom, opts) {
  const fiche = await db.prepare("SELECT article_id FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) return null;
  const article = await db.prepare("SELECT produit_id FROM articles WHERE id = ?").get(fiche.article_id);
  if (!article || !article.produit_id) return null;

  const modeles = await modelesMesuresApi.listByProduitId(db, article.produit_id);
  let modeleId;
  if (modeles.length === 1) modeleId = modeles[0].id;
  else if (modeles.length === 0) {
    const t = await db.prepare("SELECT nom FROM listes_valeurs WHERE id = ?").get(article.produit_id);
    modeleId = (await modelesMesuresApi.create(db, article.produit_id, t ? t.nom : "Modèle")).id;
  } else {
    return null;   // plusieurs modeles : on ne choisit pas a la place de l'utilisateur
  }
  await modelesMesuresApi.addLigne(db, modeleId, nom, {
    unite: opts.unite || null,
    groupe: opts.groupe === "detail" || opts.groupe === "principale" ? opts.groupe : modelesMesuresApi.groupeDeMesure(nom),
  });
  return modeleId;
}

async function updateMesureLigne(db, ficheId, mesureCatalogueId, patch) {
  await assertModifiable(db, ficheId);
  if (patch.repere !== undefined) await assertRepereLibre(db, ficheId, patch.repere, mesureCatalogueId);
  const fields = MESURE_LIGNE_CHAMPS.filter((f) => patch[f] !== undefined);
  if (fields.length > 0) {
    const params = { fiche_id: ficheId, mesure_catalogue_id: mesureCatalogueId };
    fields.forEach((f) => { params[f] = patch[f] || null; });
    const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
    await db.prepare(`UPDATE ft_mesures_lignes SET ${setClause} WHERE fiche_id = @fiche_id AND mesure_catalogue_id = @mesure_catalogue_id`).run(params);
  }
  return await getGrille(db, ficheId);
}

async function removeMesureLigne(db, ficheId, mesureCatalogueId) {
  await assertModifiable(db, ficheId);
  const tx = db.transaction(async () => {
    await db.prepare("DELETE FROM ft_mesures_lignes WHERE fiche_id = ? AND mesure_catalogue_id = ?").run(ficheId, mesureCatalogueId);
    await db.prepare("DELETE FROM ft_mesures_valeurs WHERE fiche_id = ? AND mesure_catalogue_id = ?").run(ficheId, mesureCatalogueId);
  });
  await tx();
  return await getGrille(db, ficheId);
}

async function reorderMesuresLignes(db, ficheId, orderedCatalogueIds) {
  await assertModifiable(db, ficheId);
  const update = db.prepare("UPDATE ft_mesures_lignes SET ordre = ? WHERE fiche_id = ? AND mesure_catalogue_id = ?");
  const tx = db.transaction(async () => {
    for (const [i, id] of orderedCatalogueIds.entries()) {
      await update.run(i, ficheId, id);
    }
  });
  await tx();
  return await getGrille(db, ficheId);
}

// --- Catalogue des tailles (grandit avec l'usage, comme les mesures et les accessoires) ---

async function searchTaillesCatalogue(db, query, limit) {
  const q = stripAccents(normalizeNom(query || ""));
  const all = await db.prepare("SELECT * FROM tailles_catalogue WHERE actif = 1 ORDER BY ordre, nom").all();
  const filtered = q ? all.filter((t) => stripAccents(t.nom_normalise).includes(q)) : all;
  return filtered.slice(0, limit || (q ? 8 : 20));
}

async function getOrCreateTailleCatalogue(db, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la taille est obligatoire.");
  const nomNormalise = normalizeNom(nomTrim);
  let entry = await db.prepare("SELECT * FROM tailles_catalogue WHERE nom_normalise = ?").get(nomNormalise);
  if (!entry) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM tailles_catalogue").get()).m || 0;
    const info = await db.prepare("INSERT INTO tailles_catalogue (nom, nom_normalise, ordre) VALUES (?, ?, ?)").run(nomTrim, nomNormalise, maxOrdre + 1);
    entry = await db.prepare("SELECT * FROM tailles_catalogue WHERE id = ?").get(info.lastInsertRowid);
  }
  return entry;
}

// --- Tailles (colonnes) : entièrement propres à la fiche, aucun lien vers les Déclinaisons ---

async function addTaille(db, ficheId, nom) {
  await assertModifiable(db, ficheId);
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la taille est obligatoire.");

  // CORRECTION DU BUG HISTORIQUE — ne JAMAIS écrire ici un id de tailles_catalogue.
  // ft_tailles.grille_valeur_id référence grilles_tailles_valeurs(id). L'ancienne version y
  // insérait getOrCreateTailleCatalogue(...).id, c'est-à-dire un identifiant d'une TOUTE AUTRE
  // table : sur une base où grilles_tailles_valeurs était vide, l'insertion échouait en
  // FOREIGN KEY ; sur une base peuplée, elle passait en pointant silencieusement vers une valeur
  // arbitraire (une taille nommée "M" désignant la valeur de grille "38").
  // Désormais : on ne renseigne grille_valeur_id que si le nom correspond EXACTEMENT à une valeur
  // de la grille applicable à la fiche. Sinon NULL — état légitime d'une taille hors grille
  // (Taille unique, Sur-mesure), et jamais une invention.
  let grilleValeurId = null;
  try {
    const applicable = await getGrilleApplicable(db, ficheId);
    if (applicable.grille) {
      const v = await db.prepare(
        "SELECT id FROM grilles_tailles_valeurs WHERE grille_id = ? AND valeur_normalisee = ? AND actif = 1"
      ).get(applicable.grille.id, normalizeNom(nomTrim));
      if (v) grilleValeurId = v.id;
    }
  } catch (err) {
    // Résolution impossible : on reste sur NULL plutôt que de bloquer l'ajout de la taille.
    console.error("Resolution de la grille impossible pour la taille (non bloquant) :", err);
  }

  const existe = (await db.prepare("SELECT id, nom FROM ft_tailles WHERE fiche_id = ?").all(ficheId))
    .some((t) => normalizeNom(t.nom) === normalizeNom(nomTrim));
  if (existe) throw new Error(`La taille « ${nomTrim} » est déjà présente sur cette fiche.`);

  // Le catalogue continue d'alimenter l'autocomplétion des tailles exceptionnelles, mais son
  // identifiant n'est plus jamais écrit dans grille_valeur_id.
  await getOrCreateTailleCatalogue(db, nomTrim);

  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_tailles WHERE fiche_id = ?").get(ficheId)).m || 0;
  await db.prepare("INSERT INTO ft_tailles (fiche_id, nom, grille_valeur_id, ordre) VALUES (?, ?, ?, ?)")
    .run(ficheId, nomTrim, grilleValeurId, maxOrdre + 1);
  return await getGrille(db, ficheId);
}

// À appeler côté interface AVANT removeTaille, pour savoir s'il faut demander confirmation.
async function tailleAValeurs(db, ftTailleId) {
  const row = await db.prepare(
    "SELECT COUNT(*) AS n FROM ft_mesures_valeurs WHERE ft_taille_id = ? AND valeur IS NOT NULL AND TRIM(valeur) != ''"
  ).get(ftTailleId);
  return row.n > 0;
}

async function removeTaille(db, ficheId, ftTailleId) {
  await assertModifiable(db, ficheId);
  await db.prepare("DELETE FROM ft_tailles WHERE id = ? AND fiche_id = ?").run(ftTailleId, ficheId); // cascade sur ft_mesures_valeurs
  return await taillesDisponibles(db, ficheId);
}

async function reorderTailles(db, ficheId, orderedFtTailleIds) {
  await assertModifiable(db, ficheId);
  const update = db.prepare("UPDATE ft_tailles SET ordre = ? WHERE id = ? AND fiche_id = ?");
  const tx = db.transaction(async () => {
    for (const [i, id] of orderedFtTailleIds.entries()) {
      await update.run(i, id, ficheId);
    }
  });
  await tx();
  return await getGrille(db, ficheId);
}

// L'étape "tailles" n'est jamais irréversible : confirmer ne fait que révéler le tableau et
// tenter, si un seul modèle de mesures existe pour ce type de produit, l'appliquer aussitôt.
// Ajouter/supprimer/réordonner des tailles reste possible ensuite tant que la fiche est en
// brouillon (cf. addTaille / removeTaille / reorderTailles, appelables à tout moment).
async function confirmerTailles(db, ficheId) {
  await assertModifiable(db, ficheId);
  await db.prepare("UPDATE fiches_techniques SET tailles_confirmees = 1 WHERE id = ?").run(ficheId);
  return await ensureMesuresGenerees(db, ficheId);
}

// --- Valeurs de la grille ---

async function setValeur(db, ficheId, mesureCatalogueId, ftTailleId, valeur) {
  await assertModifiable(db, ficheId);
  const v = valeur == null ? null : String(valeur).trim() || null;
  await db.prepare(
    "INSERT INTO ft_mesures_valeurs (fiche_id, mesure_catalogue_id, ft_taille_id, valeur) VALUES (?, ?, ?, ?) " +
    "ON CONFLICT(mesure_catalogue_id, ft_taille_id) DO UPDATE SET valeur = excluded.valeur"
  ).run(ficheId, mesureCatalogueId, ftTailleId, v);
  return await getGrille(db, ficheId);
}

// Renvoie la grille complète : lignes (mesures + repère/unité/tolérances), colonnes (tailles
// locales à la fiche, dans l'ordre), et les valeurs déjà saisies, indexables côté frontend par
// [mesureCatalogueId][ftTailleId].
async function getGrille(db, ficheId) {
  const lignes = await db.prepare(
    // COALESCE : le libellé propre à la fiche prime, sinon celui du catalogue. nom_catalogue est
    // renvoyé en plus pour que l'interface puisse proposer « revenir au nom du catalogue ».
    "SELECT mc.id, COALESCE(l.nom_local, mc.nom) AS nom, mc.nom AS nom_catalogue, l.nom_local, " +
    "l.repere, l.unite, l.tolerance_plus, l.tolerance_moins, l.commentaire, l.ordre, " +
    // NULL = non classee, traitee comme principale : les lignes anterieures restent visibles.
    "COALESCE(l.groupe, 'principale') AS groupe " +
    "FROM ft_mesures_lignes l JOIN mesures_catalogue mc ON mc.id = l.mesure_catalogue_id " +
    // Tri GROUPE puis ordre : reordonner un groupe n'entremele jamais les deux.
    "WHERE l.fiche_id = ? ORDER BY CASE COALESCE(l.groupe,'principale') WHEN 'principale' THEN 0 ELSE 1 END, l.ordre, mc.nom"
  ).all(ficheId);
  const tailles = await db.prepare(
    "SELECT id, nom, grille_valeur_id, ordre FROM ft_tailles WHERE fiche_id = ? ORDER BY ordre"
  ).all(ficheId);
  const valeurs = await db.prepare("SELECT mesure_catalogue_id, ft_taille_id, valeur FROM ft_mesures_valeurs WHERE fiche_id = ?").all(ficheId);
  return { lignes, tailles, valeurs };
}

// Applique un modèle précis à la fiche : copie ses lignes de mesures (une fois, jamais de lien
// vivant ensuite). Les tailles (colonnes) existent déjà sur la fiche depuis l'étape précédente
// (tailles_confirmees) — un modèle ne fournit plus que des lignes, jamais de colonnes.
async function appliquerModele(db, ficheId, modeleId) {
  await assertModifiable(db, ficheId);
  const modele = await modelesMesuresApi.getById(db, modeleId);
  if (!modele) throw new Error("Modèle de mesures introuvable.");

  for (const l of modele.lignes) {
    await addMesureLigne(db, ficheId, l.nom, {
      repere: l.repere, unite: l.unite, tolerance_plus: l.tolerance_plus, tolerance_moins: l.tolerance_moins, commentaire: l.commentaire,
    });
  }

  await db.prepare("UPDATE fiches_techniques SET mesures_etat = 'genere_depuis_modele', modele_mesures_id = ? WHERE id = ?").run(modeleId, ficheId);
  return await getMesuresStatut(db, ficheId);
}

// Chemin exceptionnel : aucun modèle choisi, l'utilisateur ajoute ses mesures à la main (via
// addMesureLigne, déjà disponible une fois cet état atteint). Les tailles existent déjà.
async function construireManuellement(db, ficheId) {
  await assertModifiable(db, ficheId);
  await db.prepare("UPDATE fiches_techniques SET mesures_etat = 'construit_manuellement' WHERE id = ?").run(ficheId);
  return await getMesuresStatut(db, ficheId);
}

// Point d'entrée appelé à l'ouverture de l'onglet. Ne modifie la fiche que si les tailles sont
// déjà confirmées ET que mesures_etat vaut encore 'non_genere' — jamais avant, jamais deux fois,
// jamais rétroactivement. Gère aussi le cas de reprise : tailles confirmées lors d'une session
// précédente sans qu'aucun modèle n'existait encore à ce moment-là, un modèle créé depuis.
async function ensureMesuresGenerees(db, ficheId) {
  const fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  // PLUS AUCUNE application automatique de modele. Le tableau n'est cree que sur action
  // explicite (creerTableauMesures), a partir des mesures que l'utilisateur a cochees.
  // Le modele n'est plus une structure imposee mais une BIBLIOTHEQUE DE SUGGESTIONS.
  return await getMesuresStatut(db, ficheId);
}

// Mesures proposees pour cette fiche, deduites du TYPE d'article via ses modeles. C'est une
// suggestion : rien n'est ecrit ici. `suggeree` vaut true pour les lignes issues d'un modele,
// qui seront prechochees dans l'interface.
async function mesuresSuggerees(db, ficheId) {
  const fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  const article = await db.prepare(
    "SELECT a.*, p.nom AS produit_nom FROM articles a LEFT JOIN listes_valeurs p ON p.id = a.produit_id WHERE a.id = ?"
  ).get(fiche.article_id);
  const modeles = article && article.produit_id ? await modelesMesuresApi.listByProduitId(db, article.produit_id) : [];

  const vues = new Set();
  const mesures = [];
  modeles.forEach((m) => {
    m.lignes.forEach((l) => {
      const cle = normalizeNom(l.nom);
      if (vues.has(cle)) return;
      vues.add(cle);
      mesures.push({
        nom: l.nom, repere: l.repere, unite: l.unite,
        tolerance_plus: l.tolerance_plus, tolerance_moins: l.tolerance_moins,
        groupe: l.groupe || modelesMesuresApi.groupeDeMesure(l.nom),
        suggeree: true, modele: m.nom,
      });
    });
  });
  return {
    type_produit: article ? article.produit_nom : null,
    nb_lignes_existantes: (await db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes WHERE fiche_id = ?").get(ficheId)).n,
    mesures: mesures,
  };
}

// Cree le tableau a partir des SEULES mesures retenues par l'utilisateur.
// Refuse si la fiche contient deja des lignes : aucun tableau existant n'est jamais regenere.
async function creerTableauMesures(db, ficheId, mesures) {
  await assertModifiable(db, ficheId);
  const nb = (await db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes WHERE fiche_id = ?").get(ficheId)).n;
  if (nb > 0) throw new Error("Cette fiche contient déjà des mesures : le tableau ne peut pas être recréé.");
  const liste = Array.isArray(mesures) ? mesures.filter((m) => m && String(m.nom || "").trim()) : [];
  if (liste.length === 0) throw new Error("Sélectionnez au moins une mesure.");

  const tx = db.transaction(async () => {
    for (const m of liste) {
      await addMesureLigne(db, ficheId, String(m.nom).trim(), {
        repere: m.repere || null, unite: m.unite || null,
        tolerance_plus: m.tolerance_plus || null, tolerance_moins: m.tolerance_moins || null,
        groupe: m.groupe || null,
      });
    }

    await db.prepare("UPDATE fiches_techniques SET mesures_etat = 'construit_manuellement' WHERE id = ?").run(ficheId);
  });
  await tx();
  return await getMesuresStatut(db, ficheId);
}

// Renvoie tout ce dont le frontend a besoin pour décider quoi afficher : les tailles sont-elles
// confirmées, état des lignes, grille, et si rien n'est encore généré, les modèles disponibles
// pour ce produit. Plus aucune référence à l'article au-delà de son produit_id (pour retrouver
// les modèles) — aucun lien vers ses déclinaisons.
// Réversibilité du choix "Remplir manuellement" / "Appliquer un modèle".
// Remet SEULEMENT mesures_etat à 'non_genere' pour rouvrir l'écran de choix. Ne touche ni aux
// lignes de mesures, ni aux valeurs saisies, ni aux tailles : rien n'est supprimé ici.
// Si l'utilisateur applique ensuite un modèle, appliquerModele fusionne (addMesureLigne ignore une
// ligne déjà présente) — aucune valeur existante n'est écrasée non plus.
// ================================================================================================
// GRILLE DE TAILLES DE LA FICHE
// ================================================================================================
// La fiche technique NE DÉCIDE PAS du format des tailles : elle affiche les valeurs de la grille
// applicable. Lettres (S, M, L, 2XL), chiffres (29, 30, 38, 40) ou toute autre valeur sont
// traités strictement de la même façon — grilles_tailles_valeurs.valeur est du TEXT libre, et
// l'ordre vient TOUJOURS de la colonne `ordre`, jamais d'un tri sur la valeur (un tri
// alphabétique donnerait L, M, S, XL ; un tri numérique sur du texte donnerait 36, 4XL, 38).

async function listGrilles(db) {
  return await db.prepare(
    "SELECT g.id, g.nom, g.actif, (SELECT COUNT(*) FROM grilles_tailles_valeurs WHERE grille_id = g.id AND actif = 1) AS nb_valeurs " +
    "FROM grilles_tailles g WHERE g.actif = 1 ORDER BY LOWER(g.nom) COLLATE ucs_basic ASC"
  ).all();
}

// Grille applicable, par ordre de priorité décroissante. Les niveaux 2 et 3 PROPOSENT, ils
// n'affectent jamais : la suggestion n'est renvoyée que si elle est NON AMBIGUË.
//   1. fiches_techniques.grille_id       -> choix explicite sur cette fiche
//   2. produit_grille_taille             -> association du produit, si elle existe un jour
//   3. grilles des autres fiches du même produit -> suggestion, et seulement s'il n'y en a qu'une
async function getGrilleApplicable(db, ficheId) {
  const fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");

  if (fiche.grille_id) {
    const g = await db.prepare("SELECT id, nom, actif FROM grilles_tailles WHERE id = ?").get(fiche.grille_id);
    if (g) return { grille: g, origine: "fiche", suggestions: [] };
  }

  const article = await db.prepare("SELECT * FROM articles WHERE id = ?").get(fiche.article_id);
  if (article && article.produit_id) {
    const assoc = await db.prepare(
      "SELECT g.id, g.nom, g.actif FROM produit_grille_taille p JOIN grilles_tailles g ON g.id = p.grille_id WHERE p.produit_id = ?"
    ).get(article.produit_id);
    if (assoc) return { grille: assoc, origine: "produit", suggestions: [] };

    // Heuristique volontairement SIMPLE : on ne devine que si toutes les autres fiches du même
    // produit s'accordent sur une seule grille. Deux grilles différentes = aucune suggestion,
    // on renvoie la liste pour information et l'utilisateur tranche.
    const utilisees = await db.prepare(
      "SELECT DISTINCT g.id, g.nom, g.actif FROM fiches_techniques f " +
      "JOIN articles a ON a.id = f.article_id JOIN grilles_tailles g ON g.id = f.grille_id " +
      "WHERE a.produit_id = ? AND f.id != ? AND f.grille_id IS NOT NULL"
    ).all(article.produit_id, ficheId);
    if (utilisees.length === 1) return { grille: utilisees[0], origine: "suggestion", suggestions: utilisees };
    if (utilisees.length > 1) return { grille: null, origine: "ambigu", suggestions: utilisees };
  }
  return { grille: null, origine: "aucune", suggestions: [] };
}

// Pastilles à afficher. Deux sources fusionnées :
//   - les valeurs ACTIVES de la grille applicable ;
//   - les tailles DÉJÀ utilisées par la fiche, même si elles ne sont dans aucune grille active
//     (taille exceptionnelle, valeur désactivée depuis, ou fiche historique à grille_id NULL).
// Sans ce second apport, une fiche existante verrait ses colonnes disparaître de l'écran.
async function taillesDisponibles(db, ficheId) {
  const applicable = await getGrilleApplicable(db, ficheId);
  const utilisees = await db.prepare(
    "SELECT id AS ft_taille_id, nom, grille_valeur_id, ordre FROM ft_tailles WHERE fiche_id = ? ORDER BY ordre, id"
  ).all(ficheId);
  const parNom = new Map(utilisees.map((t) => [normalizeNom(t.nom), t]));

  const pastilles = [];
  if (applicable.grille) {
    const valeurs = await db.prepare(
      "SELECT id, valeur, valeur_normalisee, ordre FROM grilles_tailles_valeurs " +
      "WHERE grille_id = ? AND actif = 1 ORDER BY ordre, id"
    ).all(applicable.grille.id);
    valeurs.forEach((v) => {
      const dejaLa = parNom.get(normalizeNom(v.valeur));
      pastilles.push({
        valeur: v.valeur,
        grille_valeur_id: v.id,
        selectionnee: !!dejaLa,
        ft_taille_id: dejaLa ? dejaLa.ft_taille_id : null,
        hors_grille: false,
      });
      if (dejaLa) parNom.delete(normalizeNom(v.valeur));
    });
  }
  // Ce qui reste : tailles de la fiche sans correspondance dans la grille. Toujours affichées,
  // toujours sélectionnées — ce sont des colonnes réelles du tableau.
  parNom.forEach((t) => {
    pastilles.push({
      valeur: t.nom, grille_valeur_id: t.grille_valeur_id,
      selectionnee: true, ft_taille_id: t.ft_taille_id, hors_grille: true,
    });
  });

  return {
    grille: applicable.grille,
    origine: applicable.origine,
    suggestions: applicable.suggestions,
    grilles: await listGrilles(db),
    pastilles: pastilles,
  };
}

// Sélection d'une pastille : crée la ft_taille avec le BON grille_valeur_id (celui de
// grilles_tailles_valeurs), ce qui évite le défaut historique de addTaille() où un identifiant de
// tailles_catalogue était écrit dans une colonne référençant grilles_tailles_valeurs.
async function selectionnerTaille(db, ficheId, grilleValeurId) {
  // Validation EXPLICITE des deux clés avant toute écriture. Sans cela, un identifiant invalide
  // produisait un « SqliteError: FOREIGN KEY constraint failed » opaque, qui ne disait ni QUELLE
  // clé était en cause ni quelle valeur avait été transmise — impossible à diagnostiquer depuis
  // l'interface. Les messages ci-dessous nomment la clé fautive et sa valeur.
  const fid = Number(ficheId);
  const gvid = Number(grilleValeurId);
  if (!Number.isInteger(fid) || fid <= 0) {
    throw new Error(`Identifiant de fiche technique invalide (reçu : ${JSON.stringify(ficheId)}).`);
  }
  if (!Number.isInteger(gvid) || gvid <= 0) {
    throw new Error(`Identifiant de taille invalide (reçu : ${JSON.stringify(grilleValeurId)}).`);
  }
  const fiche = await db.prepare("SELECT id FROM fiches_techniques WHERE id = ?").get(fid);
  if (!fiche) throw new Error(`Fiche technique ${fid} introuvable : l'écran affiche peut-être une fiche supprimée ou obsolète. Rouvrez la fiche.`);

  await assertModifiable(db, fid);
  const v = await db.prepare("SELECT * FROM grilles_tailles_valeurs WHERE id = ?").get(gvid);
  if (!v) throw new Error(`Taille ${gvid} introuvable dans les grilles : la grille a peut-être changé depuis l'affichage. Rechargez la fiche.`);
  ficheId = fid;
  grilleValeurId = gvid;
  // Deja presente : soit par grille_valeur_id, soit par NOM. Le second cas couvre les tailles
  // historiques creees avant la correction de addTaille(), dont le grille_valeur_id peut differer
  // alors qu'il s'agit bien de la meme taille — sans ce controle, un doublon « 3XL » apparaissait.
  const existe = (await db.prepare(
    "SELECT id, nom, grille_valeur_id FROM ft_tailles WHERE fiche_id = ?"
  ).all(ficheId)).find((t) => t.grille_valeur_id === grilleValeurId || normalizeNom(t.nom) === normalizeNom(v.valeur));
  if (existe) {
    // Realigne le pointeur si la ligne existait sous un identifiant historique errone.
    if (existe.grille_valeur_id !== grilleValeurId) {
      await db.prepare("UPDATE ft_tailles SET grille_valeur_id = ? WHERE id = ?").run(grilleValeurId, existe.id);
    }
    return await taillesDisponibles(db, ficheId);
  }

  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_tailles WHERE fiche_id = ?").get(ficheId)).m || 0;

  const info = await db.prepare("INSERT INTO ft_tailles (fiche_id, nom, grille_valeur_id, ordre) VALUES (?, ?, ?, ?)")
    .run(ficheId, v.valeur, v.id, maxOrdre + 1);

  // Verification APRES ecriture : si la ligne n'est pas relisible, on le dit au lieu de renvoyer
  // un succes silencieux que l'interface afficherait comme un echec inexplicable.
  const relu = await db.prepare("SELECT id FROM ft_tailles WHERE id = ?").get(info.lastInsertRowid);
  if (!relu) throw new Error(`La taille « ${v.valeur} » n'a pas pu être enregistrée.`);

  // On renvoie l'ETAT COMPLET des pastilles, pas seulement la grille : l'interface se met a jour
  // depuis cette reponse faisant autorite, sans second aller-retour. C'etait la faille — les
  // pastilles etaient peintes depuis taillesDisponibles() alors que cette fonction renvoyait
  // getGrille(), obligeant a un rechargement separe qui pouvait echouer ou arriver en retard.
  return await taillesDisponibles(db, ficheId);
}

// Taille EXCEPTIONNELLE (Taille unique, Sur-mesure, valeur absente de la grille) :
// grille_valeur_id reste NULL, ce qui est l'état légitime pour une taille hors grille.
async function ajouterTailleExceptionnelle(db, ficheId, nom) {
  await assertModifiable(db, ficheId);
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la taille est obligatoire.");
  const doublon = await findSeq(
    await db.prepare("SELECT id FROM ft_tailles WHERE fiche_id = ?").all(ficheId),
    async t => normalizeNom((await db.prepare("SELECT nom FROM ft_tailles WHERE id = ?").get(t.id)).nom) === normalizeNom(nomTrim)
  );
  if (doublon) throw new Error(`La taille « ${nomTrim} » est déjà présente sur cette fiche.`);
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_tailles WHERE fiche_id = ?").get(ficheId)).m || 0;
  await db.prepare("INSERT INTO ft_tailles (fiche_id, nom, grille_valeur_id, ordre) VALUES (?, ?, NULL, ?)")
    .run(ficheId, nomTrim, maxOrdre + 1);
  return await taillesDisponibles(db, ficheId);
}

// Ce qu'un changement de grille impliquerait — SANS RIEN MODIFIER. Sert à afficher une
// confirmation précise : quelles tailles sont conservées, lesquelles seraient retirées, et
// combien de valeurs de mesures seraient perdues avec elles.
async function analyserChangementGrille(db, ficheId, nouvelleGrilleId) {
  const tailles = await db.prepare("SELECT id, nom FROM ft_tailles WHERE fiche_id = ? ORDER BY ordre, id").all(ficheId);
  const valeurs = nouvelleGrilleId
    ? await db.prepare("SELECT id, valeur, valeur_normalisee FROM grilles_tailles_valeurs WHERE grille_id = ? AND actif = 1").all(nouvelleGrilleId)
    : [];
  const parNorm = new Map(valeurs.map((v) => [v.valeur_normalisee, v]));
  const conservees = [];
  const retirees = [];

  for (const t of tailles) {
    const corr = parNorm.get(normalizeNom(t.nom));
    const nbValeurs = (await db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_valeurs WHERE ft_taille_id = ? AND valeur IS NOT NULL").get(t.id)).n;
    if (corr) conservees.push({ ft_taille_id: t.id, nom: t.nom, grille_valeur_id: corr.id, nb_valeurs: nbValeurs });
    else retirees.push({ ft_taille_id: t.id, nom: t.nom, nb_valeurs: nbValeurs });
  }

  return {
    conservees: conservees,
    retirees: retirees,
    valeurs_perdues: retirees.reduce((s, t) => s + t.nb_valeurs, 0),
  };
}

// Applique le changement. Par défaut, RIEN n'est supprimé : les tailles sans correspondance sont
// conservées telles quelles (elles deviennent simplement « hors grille » et restent affichées).
// La suppression n'a lieu que si l'appelant la demande explicitement, après confirmation.
async function definirGrille(db, ficheId, grilleId, options) {
  await assertModifiable(db, ficheId);
  const opts = options || {};
  if (grilleId != null) {
    const g = await db.prepare("SELECT id FROM grilles_tailles WHERE id = ?").get(grilleId);
    if (!g) throw new Error("Grille de tailles introuvable.");
  }
  const analyse = await analyserChangementGrille(db, ficheId, grilleId);

  const tx = db.transaction(async () => {
    await db.prepare("UPDATE fiches_techniques SET grille_id = ? WHERE id = ?").run(grilleId, ficheId);

    for (const t of analyse.conservees) {
      await db.prepare("UPDATE ft_tailles SET grille_valeur_id = ? WHERE id = ?").run(t.grille_valeur_id, t.ft_taille_id);
    }

    if (opts.supprimerHorsGrille) {
      for (const t of analyse.retirees) {
        await db.prepare("DELETE FROM ft_tailles WHERE id = ?").run(t.ft_taille_id); // cascade sur les valeurs
      }
    }
  });
  await tx();
  return await getMesuresStatut(db, ficheId);
}

// ================================================================================================
// GRADATION
// ================================================================================================
// Écart entre deux tailles CONSÉCUTIVES, pour une mesure. Les deux extrémités sont stockées
// explicitement : voir le commentaire de la table dans schema.sql pour la raison — sans cela,
// supprimer une taille intermédiaire faisait changer un intervalle de sens en silence.
//
// L'ORDRE des tailles est la seule chose qui compte. Aucun code n'interprète jamais « S », « XL »,
// « 34 » ou « 36 » : le passage 34 -> 36 ne vaut +2 que si quelqu'un l'a écrit.

async function listGradations(db, ficheId, mesureCatalogueId) {
  return await db.prepare(
    "SELECT g.id, g.mesure_catalogue_id, g.taille_depart_id, g.taille_arrivee_id, g.valeur, " +
    "d.nom AS depart_nom, a.nom AS arrivee_nom, a.ordre AS arrivee_ordre " +
    "FROM ft_mesures_gradations g " +
    "JOIN ft_tailles d ON d.id = g.taille_depart_id JOIN ft_tailles a ON a.id = g.taille_arrivee_id " +
    "WHERE g.fiche_id = ?" + (mesureCatalogueId ? " AND g.mesure_catalogue_id = ?" : "") +
    " ORDER BY a.ordre"
  ).all(...(mesureCatalogueId ? [ficheId, mesureCatalogueId] : [ficheId]));
}

// Les intervalles ATTENDUS, déduits de l'ordre des tailles de la fiche, chacun accompagné de sa
// gradation si elle existe. Un intervalle sans gradation ressort avec valeur = null : c'est ce
// qui rend un « trou » visible et empêche de le franchir au calcul.
async function intervallesGradation(db, ficheId, mesureCatalogueId) {
  const tailles = await db.prepare("SELECT id, nom, ordre FROM ft_tailles WHERE fiche_id = ? ORDER BY ordre, id").all(ficheId);
  const existantes = await listGradations(db, ficheId, mesureCatalogueId);
  const cle = (a, b) => a + ">" + b;
  const parCle = new Map(existantes.map((g) => [cle(g.taille_depart_id, g.taille_arrivee_id), g]));
  const intervalles = [];
  for (let i = 1; i < tailles.length; i += 1) {
    const g = parCle.get(cle(tailles[i - 1].id, tailles[i].id));
    intervalles.push({
      taille_depart_id: tailles[i - 1].id, depart_nom: tailles[i - 1].nom,
      taille_arrivee_id: tailles[i].id, arrivee_nom: tailles[i].nom,
      valeur: g ? g.valeur : null,
    });
  }
  return intervalles;
}

// Contrôle applicatif du même invariant que le trigger, mais avec un message lisible : la FK
// garantit que la taille existe, jamais qu'elle appartient à CETTE fiche.
async function assertTaillesDeLaFiche(db, ficheId, ...tailleIds) {
  for (const id of tailleIds) {
    const t = await db.prepare("SELECT fiche_id FROM ft_tailles WHERE id = ?").get(id);
    if (!t) throw new Error("Taille introuvable.");
    if (t.fiche_id !== ficheId) throw new Error("Cette taille n'appartient pas à cette fiche technique.");
  }
}

// Accepte "1,5" comme 1.5 : la conversion virgule -> point se fait UNE FOIS, ici, à l'entrée.
function normaliserGradation(valeur) {
  if (valeur == null || valeur === "") return null;
  const n = Number(String(valeur).replace(",", "."));
  if (!Number.isFinite(n)) throw new Error("La gradation doit être un nombre (ex. 1 ou 0,5).");
  return n;
}

async function setGradation(db, ficheId, mesureCatalogueId, tailleDepartId, tailleArriveeId, valeur) {
  await assertModifiable(db, ficheId);
  if (tailleDepartId === tailleArriveeId) throw new Error("Une gradation relie deux tailles différentes.");
  await assertTaillesDeLaFiche(db, ficheId, tailleDepartId, tailleArriveeId);
  const v = normaliserGradation(valeur);
  if (v === null) {
    // Vider une gradation SUPPRIME la ligne : l'absence est le seul moyen d'exprimer « intervalle
    // non renseigné », et un 0 stocké signifierait « aucun écart », ce qui est très différent.
    await db.prepare(
      "DELETE FROM ft_mesures_gradations WHERE fiche_id = ? AND mesure_catalogue_id = ? AND taille_depart_id = ? AND taille_arrivee_id = ?"
    ).run(ficheId, mesureCatalogueId, tailleDepartId, tailleArriveeId);
  } else {
    await db.prepare(
      "INSERT INTO ft_mesures_gradations (fiche_id, mesure_catalogue_id, taille_depart_id, taille_arrivee_id, valeur) " +
      "VALUES (?, ?, ?, ?, ?) ON CONFLICT(fiche_id, mesure_catalogue_id, taille_depart_id, taille_arrivee_id) " +
      "DO UPDATE SET valeur = excluded.valeur"
    ).run(ficheId, mesureCatalogueId, tailleDepartId, tailleArriveeId, v);
  }
  return await intervallesGradation(db, ficheId, mesureCatalogueId);
}

// Calcule ce que produirait « Appliquer la gradation », SANS RIEN ÉCRIRE.
// Propagation depuis une cellule de référence : vers la droite en ajoutant, vers la gauche en
// soustrayant. Un intervalle sans gradation ARRÊTE la propagation de ce côté — on ne devine
// jamais une valeur au-delà d'un trou.
async function simulerGradation(db, ficheId, mesureCatalogueId, tailleReferenceId) {
  const tailles = await db.prepare("SELECT id, nom, ordre FROM ft_tailles WHERE fiche_id = ? ORDER BY ordre, id").all(ficheId);
  const valeurs = await db.prepare(
    "SELECT ft_taille_id, valeur FROM ft_mesures_valeurs WHERE fiche_id = ? AND mesure_catalogue_id = ?"
  ).all(ficheId, mesureCatalogueId);
  const parTaille = new Map(valeurs.map((v) => [v.ft_taille_id, v.valeur]));

  // Référence : celle demandée, sinon la première cellule renseignée dans l'ordre des tailles.
  let refIdx = tailleReferenceId ? tailles.findIndex((t) => t.id === tailleReferenceId) : -1;
  if (refIdx === -1) refIdx = tailles.findIndex((t) => { const v = parTaille.get(t.id); return v != null && String(v).trim() !== ""; });
  if (refIdx === -1) {
    return { possible: false, raison: "Aucune valeur de référence saisie sur cette ligne.", cellules: [], intervalles_manquants: [] };
  }
  const brut = parTaille.get(tailles[refIdx].id);
  const base = Number(String(brut == null ? "" : brut).replace(",", "."));
  if (!Number.isFinite(base)) {
    return { possible: false, raison: `La valeur de référence (${tailles[refIdx].nom}) n'est pas un nombre.`, cellules: [], intervalles_manquants: [] };
  }

  const intervalles = await intervallesGradation(db, ficheId, mesureCatalogueId);
  const grad = new Map(intervalles.map((i) => [i.taille_arrivee_id, i]));
  const cellules = [];
  const manquants = [];
  const pousser = (t, val) => {
    const actuelle = parTaille.get(t.id);
    cellules.push({
      ft_taille_id: t.id, taille_nom: t.nom,
      valeur: String(Math.round(val * 1000) / 1000).replace(".", ","),
      existante: actuelle != null && String(actuelle).trim() !== "" ? String(actuelle) : null,
    });
  };
  pousser(tailles[refIdx], base);

  let courant = base;
  for (let i = refIdx + 1; i < tailles.length; i += 1) {
    const g = grad.get(tailles[i].id);
    if (!g || g.valeur == null) { manquants.push(`${tailles[i - 1].nom} → ${tailles[i].nom}`); break; }
    courant += g.valeur;
    pousser(tailles[i], courant);
  }
  courant = base;
  for (let i = refIdx - 1; i >= 0; i -= 1) {
    const g = grad.get(tailles[i + 1].id);   // l'intervalle porte la taille d'arrivée
    if (!g || g.valeur == null) { manquants.push(`${tailles[i].nom} → ${tailles[i + 1].nom}`); break; }
    courant -= g.valeur;
    pousser(tailles[i], courant);
  }

  cellules.sort((a, b) => {
    const oa = tailles.findIndex((t) => t.id === a.ft_taille_id);
    const ob = tailles.findIndex((t) => t.id === b.ft_taille_id);
    return oa - ob;
  });
  return {
    possible: true, raison: null, cellules: cellules,
    intervalles_manquants: manquants,
    reference: { ft_taille_id: tailles[refIdx].id, taille_nom: tailles[refIdx].nom },
    ecrasables: cellules.filter((c) => c.existante != null && c.ft_taille_id !== tailles[refIdx].id).length,
  };
}

// Écrit le résultat. mode 'vides' (DÉFAUT) ne touche AUCUNE cellule déjà renseignée ;
// 'tout' remplace, et n'est utilisable qu'après un choix explicite de l'utilisateur.
// Les valeurs produites sont des valeurs ORDINAIRES : rien ne les ramènera à la règle, la
// gradation est une aide au calcul et non une contrainte permanente.
async function appliquerGradation(db, ficheId, mesureCatalogueId, tailleReferenceId, mode) {
  await assertModifiable(db, ficheId);
  const sim = await simulerGradation(db, ficheId, mesureCatalogueId, tailleReferenceId);
  if (!sim.possible) throw new Error(sim.raison);
  const remplacerTout = mode === "tout";
  let ecrites = 0;
  const tx = db.transaction(async () => {
    for (const c of sim.cellules) {
      if (c.ft_taille_id === sim.reference.ft_taille_id)
        continue;      // on ne réécrit pas la référence
      if (!remplacerTout && c.existante != null)
        continue;              // cellule déjà remplie : intouchée
      await setValeur(db, ficheId, mesureCatalogueId, c.ft_taille_id, c.valeur);
      ecrites += 1;
    }
  });
  await tx();
  return { ecrites: ecrites, grille: await getGrille(db, ficheId) };
}

// Mesures presentes dans le modele du TYPE mais absentes de la fiche. LECTURE SEULE : rien n'est
// ecrit ici. Sert a n'afficher l'action que lorsqu'il y a effectivement quelque chose a ajouter.
// La comparaison porte sur mesure_catalogue_id, pas sur le libelle : une ligne renommee
// localement (nom_local) est donc bien reconnue comme deja presente.
async function mesuresManquantes(db, ficheId) {
  const fiche = await db.prepare("SELECT article_id FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  const article = await db.prepare(
    "SELECT a.produit_id, p.nom AS produit_nom FROM articles a LEFT JOIN listes_valeurs p ON p.id = a.produit_id WHERE a.id = ?"
  ).get(fiche.article_id);
  if (!article || !article.produit_id) return { type_produit: null, mesures: [] };

  const presentes = new Set(
    (await db.prepare("SELECT mesure_catalogue_id FROM ft_mesures_lignes WHERE fiche_id = ?").all(ficheId))
      .map((r) => r.mesure_catalogue_id)
  );
  const vues = new Set();
  const mesures = [];
  (await modelesMesuresApi.listByProduitId(db, article.produit_id)).forEach((m) => {
    m.lignes.forEach((l) => {
      if (presentes.has(l.mesure_catalogue_id)) return;   // deja sur la fiche : jamais reproposee
      if (vues.has(l.mesure_catalogue_id)) return;
      vues.add(l.mesure_catalogue_id);
      mesures.push({
        nom: l.nom, repere: l.repere, unite: l.unite,
        tolerance_plus: l.tolerance_plus, tolerance_moins: l.tolerance_moins,
        groupe: l.groupe || modelesMesuresApi.groupeDeMesure(l.nom),
      });
    });
  });
  return { type_produit: article.produit_nom, mesures: mesures };
}

// Ajoute UNIQUEMENT les mesures retenues. Purement additif : aucune ligne existante n'est
// supprimee ni modifiee — ni sa valeur, ni son repere, ni sa tolerance, ni son groupe.
// addMesureLigne ignore d'ailleurs toute mesure deja presente (garde `if (!existing)`), ce qui
// rend l'operation sure meme si la liste transmise contient une mesure entre-temps ajoutee.
async function ajouterMesuresManquantes(db, ficheId, mesures) {
  await assertModifiable(db, ficheId);
  const liste = Array.isArray(mesures) ? mesures.filter((m) => m && String(m.nom || "").trim()) : [];
  if (liste.length === 0) throw new Error("Sélectionnez au moins une mesure.");

  const avant = (await db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes WHERE fiche_id = ?").get(ficheId)).n;
  const tx = db.transaction(async () => {
    for (const m of liste) {
      await addMesureLigne(db, ficheId, String(m.nom).trim(), {
        repere: m.repere || null, unite: m.unite || null,
        tolerance_plus: m.tolerance_plus || null, tolerance_moins: m.tolerance_moins || null,
        groupe: m.groupe || null,
        // Jamais d'enrichissement ici : ces mesures VIENNENT du modele.
      });
    }
  });
  await tx();
  const apres = (await db.prepare("SELECT COUNT(*) AS n FROM ft_mesures_lignes WHERE fiche_id = ?").get(ficheId)).n;
  return { ajoutees: apres - avant, grille: await getGrille(db, ficheId) };
}

async function reinitialiserChoixMesures(db, ficheId) {
  await assertModifiable(db, ficheId);
  await db.prepare("UPDATE fiches_techniques SET mesures_etat = 'non_genere' WHERE id = ?").run(ficheId);
  return await getMesuresStatut(db, ficheId);
}

async function getMesuresStatut(db, ficheId) {
  const fiche = await db.prepare("SELECT * FROM fiches_techniques WHERE id = ?").get(ficheId);
  if (!fiche) throw new Error("Fiche technique introuvable.");
  const base = {
    taillesConfirmees: !!fiche.tailles_confirmees,
    etat: fiche.mesures_etat,
    grille: await getGrille(db, ficheId),
    modeleUtilise: null,
    modelesDisponibles: [],
  };

  if (fiche.modele_mesures_id) {
    base.modeleUtilise = await modelesMesuresApi.getById(db, fiche.modele_mesures_id);
  }
  if (fiche.tailles_confirmees && fiche.mesures_etat === "non_genere") {
    const article = await db.prepare("SELECT * FROM articles WHERE id = ?").get(fiche.article_id);
    base.modelesDisponibles = article ? await modelesMesuresApi.listByProduitId(db, article.produit_id) : [];
  }
  return base;
}

// --- Catalogue des accessoires (grandit avec l'usage) ---

// famille optionnelle : filtre les suggestions sur Habillage OU Composants. Sans famille, tout le
// catalogue est renvoye — le prereglage guide la saisie, il ne l'enferme jamais.
async function searchAccessoiresCatalogue(db, query, limit, famille) {
  const q = stripAccents(normalizeNom(query || ""));
  const all = famille
    ? await db.prepare("SELECT * FROM accessoires_catalogue WHERE actif = 1 AND famille = ? ORDER BY ordre, nom").all(normaliserFamille(famille))
    : await db.prepare("SELECT * FROM accessoires_catalogue WHERE actif = 1 ORDER BY ordre, nom").all();
  const filtered = q ? all.filter((a) => stripAccents(a.nom_normalise).includes(q)) : all;
  return filtered.slice(0, limit || (q ? 8 : 20));
}

// La famille est transmise a la CREATION : une designation saisie depuis la section Habillage
// doit entrer au catalogue en 'habillage', sinon elle serait classee en 'composant' par defaut et
// ne reapparaitrait jamais dans les suggestions de sa propre section.
// Une entree DEJA au catalogue n'est jamais reclassee : sa famille appartient a l'utilisateur.
async function getOrCreateAccessoireCatalogue(db, nom, famille) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) return null;
  const nomNormalise = normalizeNom(nomTrim);
  let entry = await db.prepare("SELECT * FROM accessoires_catalogue WHERE nom_normalise = ?").get(nomNormalise);
  if (!entry) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM accessoires_catalogue").get()).m || 0;
    const info = await db.prepare(
      "INSERT INTO accessoires_catalogue (nom, nom_normalise, famille, ordre) VALUES (?, ?, ?, ?)"
    ).run(nomTrim, nomNormalise, normaliserFamille(famille), maxOrdre + 1);
    entry = await db.prepare("SELECT * FROM accessoires_catalogue WHERE id = ?").get(info.lastInsertRowid);
  }
  return entry;
}

// --- Accessoires de la fiche ---

// FOURNITURES (l'onglet s'appelle Fournitures ; la table reste ft_accessoires).
// "famille" separe Habillage & Branding des Composants de confection.
// Seul "nom" est obligatoire : couleur, taille/dimension, reference, emplacement et photo restent
// facultatifs selon la fourniture — c'etait deja le cas, rien n'a ete durci.
const ACCESSOIRE_CHAMPS = [
  "famille", "emplacement", "reference", "couleur", "taille_dimension",
  "consommation_par_piece", "unite", "description",
];

const FAMILLES_FOURNITURE = ["habillage", "composant"];

function normaliserFamille(valeur) {
  const f = String(valeur || "").trim() || "composant";
  if (FAMILLES_FOURNITURE.indexOf(f) === -1) {
    throw new Error("Famille de fourniture inconnue (habillage ou composant).");
  }
  return f;
}

async function addAccessoire(db, ficheId, payload) {
  await assertModifiable(db, ficheId);
  const nomTrim = String(payload.nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la fourniture est obligatoire.");
  const familleDemandee = normaliserFamille(payload.famille);
  const catalogue = await getOrCreateAccessoireCatalogue(db, nomTrim, familleDemandee);
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_accessoires WHERE fiche_id = ?").get(ficheId)).m || 0;

  const info = await db.prepare(
    "INSERT INTO ft_accessoires (fiche_id, accessoire_catalogue_id, famille, nom, emplacement, reference, " +
    "couleur, taille_dimension, consommation_par_piece, unite, description, ordre) " +
    "VALUES (@fiche_id, @accessoire_catalogue_id, @famille, @nom, @emplacement, @reference, " +
    "@couleur, @taille_dimension, @consommation_par_piece, @unite, @description, @ordre)"
  ).run({
    fiche_id: ficheId,
    accessoire_catalogue_id: catalogue ? catalogue.id : null,
    // Famille explicite, sinon celle proposee par le catalogue, sinon composant.
    // La famille explicitement demandee prime toujours ; le catalogue ne sert qu'a proposer.
    famille: payload.famille ? familleDemandee : normaliserFamille(catalogue ? catalogue.famille : null),
    nom: nomTrim,
    emplacement: payload.emplacement || null,
    reference: payload.reference || null,
    couleur: payload.couleur || null,
    taille_dimension: payload.taille_dimension || null,
    consommation_par_piece: payload.consommation_par_piece != null && payload.consommation_par_piece !== ""
      ? Number(payload.consommation_par_piece) : null,
    // unite reste du texte LIBRE (piece, m, cm, paire, jeu, bobine...) : contrairement aux
    // matieres, aucune contrainte CHECK — l'interface propose des suggestions, sans imposer.
    unite: payload.unite || null,
    description: payload.description || null,
    ordre: maxOrdre + 1,
  });
  return await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(info.lastInsertRowid);
}

async function updateAccessoire(db, accessoireId, patch) {
  const current = await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(accessoireId);
  if (!current) throw new Error("Accessoire introuvable.");
  await assertModifiable(db, current.fiche_id);
  const fields = ["nom"].concat(ACCESSOIRE_CHAMPS).filter((f) => patch[f] !== undefined);
  if (fields.length === 0) return current;
  if (patch.nom !== undefined && !String(patch.nom).trim()) throw new Error("Le nom de la fourniture est obligatoire.");

  const params = { id: accessoireId };
  fields.forEach((f) => {
    let v = patch[f];
    if (f === "consommation_par_piece") v = v != null && v !== "" ? Number(v) : null;
    else if (f === "famille") v = normaliserFamille(v);
    else if (typeof v === "string") v = v.trim() || null;
    params[f] = v;
  });
  if (patch.nom !== undefined) {
    const catalogue = await getOrCreateAccessoireCatalogue(db, params.nom);
    params.accessoire_catalogue_id = catalogue ? catalogue.id : null;
    fields.push("accessoire_catalogue_id");
  }
  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  await db.prepare(`UPDATE ft_accessoires SET ${setClause} WHERE id = @id`).run(params);
  return await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(accessoireId);
}

async function setAccessoirePhoto(db, accessoireId, sourcePath) {
  const current = await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(accessoireId);
  if (!current) throw new Error("Accessoire introuvable.");
  await assertModifiable(db, current.fiche_id);
  const photoPath = await copyIntoStore(sourcePath, getAccessoiresDir());
  await db.prepare("UPDATE ft_accessoires SET photo_path = ? WHERE id = ?").run(photoPath, accessoireId);
  if (current.photo_path) removeFile(current.photo_path);
  return await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(accessoireId);
}

async function deleteAccessoire(db, accessoireId) {
  const current = await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(accessoireId);
  if (current) await assertModifiable(db, current.fiche_id);
  await db.prepare("DELETE FROM ft_accessoires WHERE id = ?").run(accessoireId);
  if (current && current.photo_path) removeFile(current.photo_path);
  return { deleted: true };
}

async function reorderAccessoires(db, ficheId, orderedIds) {
  await assertModifiable(db, ficheId);
  const update = db.prepare("UPDATE ft_accessoires SET ordre = ? WHERE id = ? AND fiche_id = ?");
  const tx = db.transaction(async () => {
    for (const [i, id] of orderedIds.entries()) {
      await update.run(i, id, ficheId);
    }
  });
  await tx();
  return await listAccessoires(db, ficheId);
}

// Habillage & Branding en premier, puis Composants de confection : l'ordre d'affichage de
// l'onglet et du document atelier.
async function listAccessoires(db, ficheId) {
  const lignes = await db.prepare(
    "SELECT * FROM ft_accessoires WHERE fiche_id = ? " +
    "ORDER BY CASE famille WHEN 'habillage' THEN 0 ELSE 1 END, ordre, id"
  ).all(ficheId);
  // `couleurs` s'ajoute à côté des colonnes existantes, exactement comme listMatieres le fait pour
  // les matières. Aucun champ n'est retiré ni renommé : le document atelier et le PDF continuent
  // de lire ce qu'ils lisaient.
  return await mapSeq(
    lignes,
    async a => Object.assign({}, a, { couleurs: await listFournitureCouleurs(db, a.id) })
  );
}

// ================================================================================================
// COLORIS DES FOURNITURES — déclinaison d'une fourniture selon la COULEUR PRODUIT
// ================================================================================================
// Un pantalon Noir reçoit un cordon noir, le même pantalon en Beige un cordon beige : UNE ligne de
// fourniture, plusieurs coloris. Sans cette table, la seule façon de modéliser le cas était de
// créer deux lignes de fourniture — chacune consommant alors sur la production ENTIÈRE, ce qui
// doublait le besoin (580 pièces devenaient 1 160).
//
// Différence assumée avec les matières : le coloris d'une fourniture est du TEXTE LIBRE, et non une
// entrée d'un catalogue de coloris. Un zip noir n'a pas de nuancier fournisseur à référencer.
// C'est pourquoi il n'existe pas de createFournitureCouleur à part : la saisie suffit.
//
// consommation_par_piece est FACULTATIVE ici. Vide, la consommation de la ligne s'applique à toutes
// les couleurs ; renseignée, elle prime pour cette couleur-là (règle couleur du moteur). Elle n'est
// jamais remplacée par zéro ni par une moyenne.

// La colonne consommation_par_piece est ajoutée par migrationsApprovisionnement. La lecture la
// contourne si la migration n'a pas encore tourné : une colonne absente dans un SELECT fait échouer
// la préparation de la requête, donc tout l'onglet Fournitures, et pas seulement cette ligne.
async function colonneConsoColorisPresente(db) {
  try {
    return (await db.colonnes("ft_fourniture_couleurs"))
      .some((c) => c.name === "consommation_par_piece");
  } catch (_) { return false; }
}

async function selectFournitureCouleur(db) {
  const champConso = (await colonneConsoColorisPresente(db)) ? "fc.consommation_par_piece" : "NULL AS consommation_par_piece";
  return "SELECT fc.id, fc.ft_accessoire_id, fc.couleur_produit_id, fc.couleur_fourniture, fc.reference, " +
    champConso + ", lv.nom AS couleur_produit_nom " +
    "FROM ft_fourniture_couleurs fc " +
    "JOIN listes_valeurs lv ON lv.id = fc.couleur_produit_id ";
}

async function listFournitureCouleurs(db, ftAccessoireId) {
  return await db.prepare(
    (await selectFournitureCouleur(db)) + "WHERE fc.ft_accessoire_id = ? ORDER BY LOWER(lv.nom) COLLATE ucs_basic ASC"
  ).all(ftAccessoireId);
}

// Les écritures rendent la ligne RELUE avec le nom de la couleur produit, et non la ligne brute :
// l'interface affiche ce nom, elle n'a donc pas à recharger la fiche entière pour l'obtenir.
async function getFournitureCouleur(db, id) {
  return await db.prepare((await selectFournitureCouleur(db)) + "WHERE fc.id = ?").get(id);
}

// Une consommation saisie doit être un nombre strictement positif. Zéro est refusé à la saisie :
// enregistré, il voudrait dire « cette couleur ne consomme rien », ce qui n'est jamais ce que
// l'utilisateur veut exprimer quand il laisse un champ à 0 par accident. Vide = « non précisée »,
// et c'est la seule façon de revenir en arrière.
function normaliserConsoColoris(valeur) {
  if (valeur == null || valeur === "") return null;
  const n = Number(valeur);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error("La consommation du coloris doit être un nombre supérieur à zéro, ou laissée vide.");
  }
  return n;
}

function texteOuNull(valeur) {
  if (valeur == null) return null;
  const t = String(valeur).trim();
  return t || null;
}

async function addFournitureCouleur(db, ftAccessoireId, payload) {
  const fourniture = await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(ftAccessoireId);
  if (!fourniture) throw new Error("Fourniture introuvable.");
  await assertModifiable(db, fourniture.fiche_id);

  const p = payload || {};
  const couleurProduitId = Number(p.couleur_produit_id);
  if (!Number.isInteger(couleurProduitId)) throw new Error("Sélectionnez une couleur produit.");
  await assertCouleurProduit(db, couleurProduitId);

  const existe = await db.prepare(
    "SELECT id FROM ft_fourniture_couleurs WHERE ft_accessoire_id = ? AND couleur_produit_id = ?"
  ).get(ftAccessoireId, couleurProduitId);
  if (existe) throw new Error("Cette couleur produit est déjà déclarée pour cette fourniture.");

  const conso = normaliserConsoColoris(p.consommation_par_piece);
  const avecConso = await colonneConsoColorisPresente(db);
  const colonnes = ["ft_accessoire_id", "couleur_produit_id", "couleur_fourniture", "reference"]
    .concat(avecConso ? ["consommation_par_piece"] : []);
  const valeurs = [ftAccessoireId, couleurProduitId, texteOuNull(p.couleur_fourniture), texteOuNull(p.reference)]
    .concat(avecConso ? [conso] : []);

  const insert = db.prepare(
    "INSERT INTO ft_fourniture_couleurs (" + colonnes.join(", ") + ") " +
    "VALUES (" + colonnes.map(() => "?").join(", ") + ")"
  );
  const info = await insert.run(...valeurs);
  return await getFournitureCouleur(db, info.lastInsertRowid);
}

// Les quatre champs se modifient indépendamment : on déclare d'abord qu'une couleur produit utilise
// cette fourniture, on précise le coloris, la référence et la consommation ensuite. Un champ absent
// du patch n'est pas touché — passer explicitement null l'efface.
async function updateFournitureCouleur(db, id, patch) {
  const current = await db.prepare("SELECT * FROM ft_fourniture_couleurs WHERE id = ?").get(id);
  if (!current) throw new Error("Coloris de fourniture introuvable.");
  const fourniture = await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(current.ft_accessoire_id);
  if (!fourniture) throw new Error("Fourniture introuvable.");
  await assertModifiable(db, fourniture.fiche_id);

  const p = patch || {};
  const champs = [];
  const valeurs = [];

  if (p.couleur_produit_id !== undefined) {
    const cid = Number(p.couleur_produit_id);
    await assertCouleurProduit(db, cid);
    const doublon = await db.prepare(
      "SELECT id FROM ft_fourniture_couleurs WHERE ft_accessoire_id = ? AND couleur_produit_id = ? AND id != ?"
    ).get(current.ft_accessoire_id, cid, id);
    if (doublon) throw new Error("Cette couleur produit est déjà déclarée pour cette fourniture.");
    champs.push("couleur_produit_id"); valeurs.push(cid);
  }
  if (p.couleur_fourniture !== undefined) {
    champs.push("couleur_fourniture"); valeurs.push(texteOuNull(p.couleur_fourniture));
  }
  if (p.reference !== undefined) {
    champs.push("reference"); valeurs.push(texteOuNull(p.reference));
  }
  if (p.consommation_par_piece !== undefined) {
    if (!(await colonneConsoColorisPresente(db))) {
      throw new Error("La consommation par coloris nécessite la mise à jour de la base (redémarrez l'application).");
    }
    champs.push("consommation_par_piece"); valeurs.push(normaliserConsoColoris(p.consommation_par_piece));
  }
  if (champs.length === 0) return current;

  const update = db.prepare(
    "UPDATE ft_fourniture_couleurs SET " + champs.map((c) => c + " = ?").join(", ") + " WHERE id = ?"
  );
  await update.run(...valeurs, id);
  return await getFournitureCouleur(db, id);
}

async function deleteFournitureCouleur(db, id) {
  const current = await db.prepare("SELECT * FROM ft_fourniture_couleurs WHERE id = ?").get(id);
  if (current) {
    const fourniture = await db.prepare("SELECT * FROM ft_accessoires WHERE id = ?").get(current.ft_accessoire_id);
    if (fourniture) await assertModifiable(db, fourniture.fiche_id);
  }
  await db.prepare("DELETE FROM ft_fourniture_couleurs WHERE id = ?").run(id);
  return { deleted: true };
}

// ================================================================================================
// MATIÈRES DE LA FICHE
// ================================================================================================
// Matières (jersey, molleton, interlock, doublure...) — les accessoires (zip, bouton, élastique)
// restent entièrement dans le bloc précédent, inchangé.
//
// Trois responsabilités séparées, jamais mélangées : la fiche porte la RECETTE par pièce, la
// commande de production portera le BESOIN total (chantier suivant), Achats/Finance porte le prix
// réel et les affectations. Aucun prix n'est donc saisi ni stocké ici.

async function searchMatieresCatalogue(db, query, limit) {
  const q = stripAccents(normalizeNom(query || ""));
  const all = await db.prepare("SELECT * FROM matieres_catalogue WHERE actif = 1 ORDER BY ordre, nom").all();
  const filtered = q ? all.filter((m) => stripAccents(m.nom_normalise).includes(q)) : all;
  return filtered.slice(0, limit || (q ? 8 : 20));
}

async function getOrCreateMatiereCatalogue(db, nom) {
  const nomTrim = String(nom || "").trim();
  if (!nomTrim) return null;
  const nomNormalise = normalizeNom(nomTrim);
  let entry = await db.prepare("SELECT * FROM matieres_catalogue WHERE nom_normalise = ?").get(nomNormalise);
  if (!entry) {
    const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM matieres_catalogue").get()).m || 0;
    const info = await db.prepare(
      "INSERT INTO matieres_catalogue (nom, nom_normalise, ordre) VALUES (?, ?, ?)"
    ).run(nomTrim, nomNormalise, maxOrdre + 1);
    entry = await db.prepare("SELECT * FROM matieres_catalogue WHERE id = ?").get(info.lastInsertRowid);
  }
  return entry;
}

// --- Coloris matière (catalogue partagé, rattaché à une matière) ---

async function listMatiereCouleurs(db, matiereCatalogueId) {
  if (!matiereCatalogueId) return [];
  return await db.prepare(
    "SELECT * FROM matiere_couleurs WHERE matiere_catalogue_id = ? AND actif = 1 ORDER BY ordre, libelle"
  ).all(matiereCatalogueId);
}

// Créé à la volée depuis le formulaire Matières (pas d'écran Paramètres dédié dans cette V1).
// L'unicité est vérifiée AVANT l'insertion pour renvoyer un message lisible plutôt que l'erreur
// brute de la contrainte UNIQUE ; celle-ci reste le filet de sécurité en base.
async function createMatiereCouleur(db, matiereCatalogueId, payload) {
  const p = payload || {};
  if (!matiereCatalogueId) throw new Error("Sélectionnez d'abord une matière du catalogue.");
  const matiere = await db.prepare("SELECT id FROM matieres_catalogue WHERE id = ?").get(matiereCatalogueId);
  if (!matiere) throw new Error("Matière du catalogue introuvable.");

  const libelle = String(p.libelle || "").trim();
  if (!libelle) throw new Error("Le libellé du coloris matière est obligatoire.");
  const libelleNormalise = normalizeNom(libelle);
  const code = p.code != null ? String(p.code).trim() || null : null;
  const reference = p.reference != null ? String(p.reference).trim() || null : null;

  const doublonLibelle = await db.prepare(
    "SELECT id FROM matiere_couleurs WHERE matiere_catalogue_id = ? AND libelle_normalise = ?"
  ).get(matiereCatalogueId, libelleNormalise);
  if (doublonLibelle) throw new Error(`Le coloris « ${libelle} » existe déjà pour cette matière.`);

  if (code) {
    const doublonCode = await db.prepare(
      "SELECT id FROM matiere_couleurs WHERE matiere_catalogue_id = ? AND code = ?"
    ).get(matiereCatalogueId, code);
    if (doublonCode) throw new Error(`Le code « ${code} » est déjà utilisé pour cette matière.`);
  }

  const maxOrdre = (await db.prepare(
    "SELECT MAX(ordre) AS m FROM matiere_couleurs WHERE matiere_catalogue_id = ?"
  ).get(matiereCatalogueId)).m || 0;

  const info = await db.prepare(
    "INSERT INTO matiere_couleurs (matiere_catalogue_id, code, libelle, libelle_normalise, reference, ordre) " +
    "VALUES (?, ?, ?, ?, ?, ?)"
  ).run(matiereCatalogueId, code, libelle, libelleNormalise, reference, maxOrdre + 1);
  return await db.prepare("SELECT * FROM matiere_couleurs WHERE id = ?").get(info.lastInsertRowid);
}

// --- Lignes de matière de la fiche ---

const MATIERE_CHAMPS = [
  "utilisation", "composition", "grammage", "unite",
  "consommation_technique", "perte_pourcent", "mode_consommation",
];

const UNITES_MATIERE = ["kg", "m", "piece", "lot"];

function normaliserChampMatiere(champ, valeur) {
  if (champ === "consommation_technique") {
    if (valeur == null || valeur === "") return null;
    const n = Number(valeur);
    if (!Number.isFinite(n) || n <= 0) throw new Error("La consommation technique doit être un nombre supérieur à zéro.");
    return n;
  }
  if (champ === "perte_pourcent") {
    if (valeur == null || valeur === "") return 0;
    const n = Number(valeur);
    if (!Number.isFinite(n) || n < 0) throw new Error("La perte doit être un pourcentage positif ou nul.");
    return n;
  }
  if (champ === "unite") {
    const u = String(valeur || "").trim() || "kg";
    if (UNITES_MATIERE.indexOf(u) === -1) throw new Error("Unité non prise en charge (kg, m, piece ou lot).");
    return u;
  }
  if (champ === "mode_consommation") {
    const m = String(valeur || "").trim() || "moyenne";
    if (m !== "moyenne" && m !== "par_taille") throw new Error("Mode de consommation inconnu.");
    return m;
  }
  if (typeof valeur === "string") return valeur.trim() || null;
  return valeur == null ? null : valeur;
}

async function ficheIdFromMatiereId(db, ftMatiereId) {
  const row = await db.prepare("SELECT fiche_id FROM ft_matieres WHERE id = ?").get(ftMatiereId);
  if (!row) throw new Error("Matière introuvable.");
  return row.fiche_id;
}

async function addMatiere(db, ficheId, payload) {
  await assertModifiable(db, ficheId);
  const p = payload || {};
  const nomTrim = String(p.nom || "").trim();
  if (!nomTrim) throw new Error("Le nom de la matière est obligatoire.");
  const catalogue = await getOrCreateMatiereCatalogue(db, nomTrim);
  const maxOrdre = (await db.prepare("SELECT MAX(ordre) AS m FROM ft_matieres WHERE fiche_id = ?").get(ficheId)).m || 0;

  const info = await db.prepare(
    "INSERT INTO ft_matieres (fiche_id, matiere_catalogue_id, nom, utilisation, composition, grammage, " +
    "unite, consommation_technique, perte_pourcent, mode_consommation, ordre) " +
    "VALUES (@fiche_id, @matiere_catalogue_id, @nom, @utilisation, @composition, @grammage, " +
    "@unite, @consommation_technique, @perte_pourcent, @mode_consommation, @ordre)"
  ).run({
    fiche_id: ficheId,
    matiere_catalogue_id: catalogue ? catalogue.id : null,
    nom: nomTrim,
    utilisation: normaliserChampMatiere("utilisation", p.utilisation),
    composition: normaliserChampMatiere("composition", p.composition),
    grammage: normaliserChampMatiere("grammage", p.grammage),
    unite: normaliserChampMatiere("unite", p.unite != null && p.unite !== "" ? p.unite : (catalogue ? catalogue.unite_defaut : "kg")),
    consommation_technique: normaliserChampMatiere("consommation_technique", p.consommation_technique),
    perte_pourcent: normaliserChampMatiere("perte_pourcent", p.perte_pourcent),
    mode_consommation: normaliserChampMatiere("mode_consommation", p.mode_consommation),
    ordre: maxOrdre + 1,
  });
  return await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(info.lastInsertRowid);
}

async function updateMatiere(db, ftMatiereId, patch) {
  const current = await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(ftMatiereId);
  if (!current) throw new Error("Matière introuvable.");
  await assertModifiable(db, current.fiche_id);

  const fields = ["nom"].concat(MATIERE_CHAMPS).filter((f) => patch[f] !== undefined);
  if (fields.length === 0) return current;
  if (patch.nom !== undefined && !String(patch.nom).trim()) throw new Error("Le nom de la matière est obligatoire.");

  const params = { id: ftMatiereId };
  fields.forEach((f) => {
    params[f] = f === "nom" ? String(patch[f]).trim() : normaliserChampMatiere(f, patch[f]);
  });
  // Renommer relie la ligne à l'entrée de catalogue correspondante (et la crée au besoin), même
  // logique que updateAccessoire — c'est ce qui fait grandir le catalogue avec l'usage.
  if (patch.nom !== undefined) {
    const catalogue = await getOrCreateMatiereCatalogue(db, params.nom);
    params.matiere_catalogue_id = catalogue ? catalogue.id : null;
    fields.push("matiere_catalogue_id");
  }
  const setClause = fields.map((f) => `${f} = @${f}`).join(", ");
  await db.prepare(`UPDATE ft_matieres SET ${setClause} WHERE id = @id`).run(params);
  return await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(ftMatiereId);
}

async function deleteMatiere(db, ftMatiereId) {
  const current = await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(ftMatiereId);
  if (current) await assertModifiable(db, current.fiche_id);
  // Cascade en base sur ft_matiere_couleurs et ft_matiere_consommations_taille.
  await db.prepare("DELETE FROM ft_matieres WHERE id = ?").run(ftMatiereId);
  return { deleted: true };
}

async function reorderMatieres(db, ficheId, orderedIds) {
  await assertModifiable(db, ficheId);
  const update = db.prepare("UPDATE ft_matieres SET ordre = ? WHERE id = ? AND fiche_id = ?");
  const tx = db.transaction(async () => {
    for (const [i, id] of orderedIds.entries()) {
      await update.run(i, id, ficheId);
    }
  });
  await tx();
  return await listMatieres(db, ficheId);
}

// --- Correspondance couleur produit -> coloris matière ---

// listes_valeurs mélange tous les référentiels (produits, couleurs, ateliers...) dans une seule
// table : une clé étrangère seule accepterait donc un atelier comme "couleur produit". SQLite ne
// sachant pas contraindre une FK sur type = 'couleur', le contrôle est applicatif — exactement la
// situation de commande_lignes.couleur_id, dont ce champ doit rester le miroir exact pour que le
// besoin matière puisse un jour être croisé avec les quantités réellement commandées.
async function assertCouleurProduit(db, couleurProduitId) {
  const row = await db.prepare("SELECT id, type FROM listes_valeurs WHERE id = ?").get(couleurProduitId);
  if (!row) throw new Error("Couleur produit introuvable.");
  if (row.type !== "couleur") {
    throw new Error("La couleur produit doit provenir de la liste des couleurs.");
  }
  return row;
}

// Le coloris matière doit appartenir à LA matière de cette ligne : rattacher "Gris 014" du jersey
// à une ligne de molleton produirait une référence fournisseur fausse, silencieusement.
async function assertMatiereCouleurCoherente(db, ftMatiere, matiereCouleurId) {
  if (matiereCouleurId == null) return null;
  const mc = await db.prepare("SELECT * FROM matiere_couleurs WHERE id = ?").get(matiereCouleurId);
  if (!mc) throw new Error("Coloris matière introuvable.");
  if (!ftMatiere.matiere_catalogue_id || mc.matiere_catalogue_id !== ftMatiere.matiere_catalogue_id) {
    throw new Error("Ce coloris n'appartient pas à la matière sélectionnée.");
  }
  return mc;
}

async function addMatiereCouleur(db, ftMatiereId, payload) {
  const matiere = await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(ftMatiereId);
  if (!matiere) throw new Error("Matière introuvable.");
  await assertModifiable(db, matiere.fiche_id);

  const p = payload || {};
  const couleurProduitId = Number(p.couleur_produit_id);
  if (!Number.isInteger(couleurProduitId)) throw new Error("Sélectionnez une couleur produit.");
  await assertCouleurProduit(db, couleurProduitId);
  const matiereCouleurId = p.matiere_couleur_id != null && p.matiere_couleur_id !== "" ? Number(p.matiere_couleur_id) : null;
  await assertMatiereCouleurCoherente(db, matiere, matiereCouleurId);

  const existe = await db.prepare(
    "SELECT id FROM ft_matiere_couleurs WHERE ft_matiere_id = ? AND couleur_produit_id = ?"
  ).get(ftMatiereId, couleurProduitId);
  if (existe) throw new Error("Cette couleur produit est déjà associée à cette matière.");

  const info = await db.prepare(
    "INSERT INTO ft_matiere_couleurs (ft_matiere_id, couleur_produit_id, matiere_couleur_id) VALUES (?, ?, ?)"
  ).run(ftMatiereId, couleurProduitId, matiereCouleurId);
  return await db.prepare("SELECT * FROM ft_matiere_couleurs WHERE id = ?").get(info.lastInsertRowid);
}

// Sert surtout à renseigner le coloris matière APRÈS coup (matiere_couleur_id est nullable : on
// déclare d'abord qu'une couleur produit utilise cette matière, on choisit le coloris ensuite).
async function updateMatiereCouleur(db, ftMatiereCouleurId, patch) {
  const current = await db.prepare("SELECT * FROM ft_matiere_couleurs WHERE id = ?").get(ftMatiereCouleurId);
  if (!current) throw new Error("Correspondance de coloris introuvable.");
  const matiere = await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(current.ft_matiere_id);
  await assertModifiable(db, matiere.fiche_id);

  const p = patch || {};
  if (p.matiere_couleur_id !== undefined) {
    const id = p.matiere_couleur_id != null && p.matiere_couleur_id !== "" ? Number(p.matiere_couleur_id) : null;
    await assertMatiereCouleurCoherente(db, matiere, id);
    await db.prepare("UPDATE ft_matiere_couleurs SET matiere_couleur_id = ? WHERE id = ?").run(id, ftMatiereCouleurId);
  }
  if (p.couleur_produit_id !== undefined) {
    const cid = Number(p.couleur_produit_id);
    await assertCouleurProduit(db, cid);
    const doublon = await db.prepare(
      "SELECT id FROM ft_matiere_couleurs WHERE ft_matiere_id = ? AND couleur_produit_id = ? AND id != ?"
    ).get(current.ft_matiere_id, cid, ftMatiereCouleurId);
    if (doublon) throw new Error("Cette couleur produit est déjà associée à cette matière.");
    await db.prepare("UPDATE ft_matiere_couleurs SET couleur_produit_id = ? WHERE id = ?").run(cid, ftMatiereCouleurId);
  }
  return await db.prepare("SELECT * FROM ft_matiere_couleurs WHERE id = ?").get(ftMatiereCouleurId);
}

async function deleteMatiereCouleur(db, ftMatiereCouleurId) {
  const current = await db.prepare("SELECT * FROM ft_matiere_couleurs WHERE id = ?").get(ftMatiereCouleurId);
  if (current) {
    const matiere = await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(current.ft_matiere_id);
    if (matiere) await assertModifiable(db, matiere.fiche_id);
  }
  await db.prepare("DELETE FROM ft_matiere_couleurs WHERE id = ?").run(ftMatiereCouleurId);
  return { deleted: true };
}

// --- Consommation par taille (préparée en base, non exposée dans l'interface V1) ---

// ft_taille_id désigne une COLONNE de la fiche (ft_tailles), pas une valeur de grille : la
// consommation par taille porte ainsi exactement sur les mêmes tailles que le tableau de mesures,
// comme ft_mesures_valeurs. Une valeur nulle/vide efface la ligne plutôt que d'enregistrer un
// zéro qui serait interprété comme "ne consomme rien".
async function setConsommationTaille(db, ftMatiereId, ftTailleId, valeur) {
  const matiere = await db.prepare("SELECT * FROM ft_matieres WHERE id = ?").get(ftMatiereId);
  if (!matiere) throw new Error("Matière introuvable.");
  await assertModifiable(db, matiere.fiche_id);

  const taille = await db.prepare("SELECT * FROM ft_tailles WHERE id = ? AND fiche_id = ?").get(ftTailleId, matiere.fiche_id);
  if (!taille) throw new Error("Cette taille n'appartient pas à cette fiche technique.");

  if (valeur == null || valeur === "") {
    await db.prepare("DELETE FROM ft_matiere_consommations_taille WHERE ft_matiere_id = ? AND ft_taille_id = ?")
      .run(ftMatiereId, ftTailleId);
    return await listConsommationsTaille(db, ftMatiereId);
  }
  const n = Number(valeur);
  if (!Number.isFinite(n) || n <= 0) throw new Error("La consommation doit être un nombre supérieur à zéro.");
  await db.prepare(
    "INSERT INTO ft_matiere_consommations_taille (ft_matiere_id, ft_taille_id, consommation_technique) VALUES (?, ?, ?) " +
    "ON CONFLICT(ft_matiere_id, ft_taille_id) DO UPDATE SET consommation_technique = excluded.consommation_technique"
  ).run(ftMatiereId, ftTailleId, n);
  return await listConsommationsTaille(db, ftMatiereId);
}

async function listConsommationsTaille(db, ftMatiereId) {
  return await db.prepare(
    "SELECT ct.id, ct.ft_matiere_id, ct.ft_taille_id, ct.consommation_technique, t.nom AS taille_nom, t.ordre " +
    "FROM ft_matiere_consommations_taille ct JOIN ft_tailles t ON t.id = ct.ft_taille_id " +
    "WHERE ct.ft_matiere_id = ? ORDER BY t.ordre"
  ).all(ftMatiereId);
}

// --- Lecture ---

// consommation_budgetee est CALCULÉE ici, jamais lue depuis une colonne : aucune table ne la
// stocke, et c'est délibéré. Exposée en lecture seule au renderer pour que le calcul reste écrit
// à un seul endroit.
function consommationBudgetee(consommationTechnique, pertePourcent) {
  if (consommationTechnique == null) return null;
  return consommationTechnique * (1 + (pertePourcent || 0) / 100);
}

async function listMatieres(db, ficheId) {
  const matieres = await db.prepare(
    "SELECT m.*, mc.unite_defaut AS catalogue_unite_defaut " +
    "FROM ft_matieres m LEFT JOIN matieres_catalogue mc ON mc.id = m.matiere_catalogue_id " +
    "WHERE m.fiche_id = ? ORDER BY m.ordre, m.id"
  ).all(ficheId);

  const couleursStmt = db.prepare(
    "SELECT fmc.id, fmc.ft_matiere_id, fmc.couleur_produit_id, fmc.matiere_couleur_id, " +
    "lv.nom AS couleur_produit_nom, " +
    "mcol.libelle AS matiere_couleur_libelle, mcol.code AS matiere_couleur_code, " +
    "mcol.reference AS matiere_couleur_reference " +
    "FROM ft_matiere_couleurs fmc " +
    "JOIN listes_valeurs lv ON lv.id = fmc.couleur_produit_id " +
    "LEFT JOIN matiere_couleurs mcol ON mcol.id = fmc.matiere_couleur_id " +
    "WHERE fmc.ft_matiere_id = ? ORDER BY LOWER(lv.nom) COLLATE ucs_basic ASC"
  );

  return await mapSeq(matieres, async m => Object.assign({}, m, {
    consommation_budgetee: consommationBudgetee(m.consommation_technique, m.perte_pourcent),
    couleurs: await couleursStmt.all(m.id),
    consommations_taille: await listConsommationsTaille(db, m.id),
  }));
}

module.exports = {
  getOrCreateByArticleId, updateNotes, updateDescriptionTechnique, updateCoupe, get, listAll, validerFiche, archiverFiche,
  addCroquis, updateCroquis, deleteCroquis, reorderCroquis, listCroquis,
  addAnnotation, updateAnnotation, deleteAnnotation,
  searchMesuresCatalogue, addMesureLigne, updateMesureLigne, removeMesureLigne, reorderMesuresLignes,
  searchTaillesCatalogue, addTaille, tailleAValeurs, removeTaille, reorderTailles, confirmerTailles,
  setValeur, getGrille, ensureMesuresGenerees, getMesuresStatut, appliquerModele, construireManuellement,
  reinitialiserChoixMesures, normaliserRepere, assertRepereLibre,
  mesuresSuggerees, creerTableauMesures, enrichirModeleDuType,
  mesuresManquantes, ajouterMesuresManquantes,
  listGradations, intervallesGradation, setGradation, simulerGradation, appliquerGradation,
  listGrilles, getGrilleApplicable, taillesDisponibles, selectionnerTaille,
  ajouterTailleExceptionnelle, analyserChangementGrille, definirGrille,
  searchAccessoiresCatalogue, addAccessoire, updateAccessoire, setAccessoirePhoto, deleteAccessoire, reorderAccessoires, listAccessoires,
  listFournitureCouleurs, getFournitureCouleur, addFournitureCouleur, updateFournitureCouleur, deleteFournitureCouleur,
  searchMatieresCatalogue, listMatiereCouleurs, createMatiereCouleur,
  addMatiere, updateMatiere, deleteMatiere, reorderMatieres, listMatieres,
  addMatiereCouleur, updateMatiereCouleur, deleteMatiereCouleur,
  setConsommationTaille, listConsommationsTaille,
};
