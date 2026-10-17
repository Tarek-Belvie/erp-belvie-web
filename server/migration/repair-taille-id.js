#!/usr/bin/env node
// ============================================================================
// REPARATION commande_lignes.taille_id — SQLite local
//
// Solde la dette laissee par migrateGrillesTailles(), jamais executee a cause
// d'une garde defectueuse. Voir plan-correction-taille-id.md.
//
//   --db=<chemin>   OBLIGATOIRE. Aucune base trouvee automatiquement.
//   (defaut)        DRY-RUN : execute TOUT puis ROLLBACK. Rien n'est conserve.
//   --apply         COMMIT reel. Exige une confirmation au clavier.
//
// IDEMPOTENCE : marqueur explicite parametres['migration_grilles_tailles_version'].
// Un second passage constate le marqueur et sort sans rien faire. La detection
// ne repose PAS sur "taille_id absent de grilles_tailles_valeurs" : sur une base
// ou un ancien id listes_valeurs collisionne numeriquement avec un id de grille,
// ce test conclurait a tort que la ligne est conforme. Le marqueur est le seul
// signal semantiquement sur (commande_lignes.taille_nom est NULL partout, y
// compris sur les lignes recentes : insertLignes() ne l'ecrit jamais).
//
// NE TOUCHE PAS a listes_valeurs type taille/pointure.
// ============================================================================

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const Database = require("better-sqlite3");

const MARQUEUR_CLE = "migration_grilles_tailles_version";
const MARQUEUR_VALEUR = "2";

let flux = null;
function log(...a) {
  const l = `[${new Date().toISOString()}] ${a.join(" ")}`;
  console.log(l);
  if (flux) flux.write(l + "\n");
}
function titre(t) { log(""); log("=".repeat(74)); log(t); log("=".repeat(74)); }

function args() {
  const o = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z0-9-]+)(?:=(.*))?$/i);
    if (m) o[m[1]] = m[2] === undefined ? true : m[2];
  }
  return o;
}
function confirmer(q) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((r) => rl.question(q, (x) => { rl.close(); r(x.trim()); }));
}

// --- Empreinte metier : ce qui doit etre STRICTEMENT identique avant/apres ---
// Le libelle est resolu quelle que soit sa source (taille_nom fige, ancien
// listes_valeurs, ou nouvelle grille) : c'est la donnee affichee a l'ecran.
function empreinte(db) {
  // ORDRE DE RESOLUTION CRITIQUE. Un meme entier peut designer une ligne de
  // grilles_tailles_valeurs ET une ligne de listes_valeurs sans rapport (une
  // couleur, un produit...). Interroger listes_valeurs sans restriction de type
  // ferait resoudre le libelle d'une ligne conforme vers un nom de couleur.
  //   1. taille_nom, s'il est deja fige ;
  //   2. grilles_tailles_valeurs — le referentiel cible, prioritaire ;
  //   3. listes_valeurs RESTREINT aux types taille/pointure — l'ancien.
  const lignes = db.prepare(`
    SELECT cl.id, cl.commande_id, cl.couleur_id, cl.quantite,
           COALESCE(
             cl.taille_nom,
             (SELECT gtv.valeur FROM grilles_tailles_valeurs gtv WHERE gtv.id = cl.taille_id),
             (SELECT lv.nom FROM listes_valeurs lv
                WHERE lv.id = cl.taille_id AND lv.type IN ('taille','pointure'))
           ) AS libelle
    FROM commande_lignes cl
    ORDER BY cl.id`).all();
  return {
    lignes,
    n: lignes.length,
    somme: lignes.reduce((s, l) => s + l.quantite, 0),
    commandes: new Set(lignes.map((l) => l.commande_id)).size,
    sha: crypto.createHash("sha256").update(JSON.stringify(lignes)).digest("hex"),
  };
}

async function main() {
  const a = args();
  if (!a.db || a.db === true) {
    console.log("\n--db=<chemin vers belvie.db> est obligatoire.");
    console.log("Par defaut le script est en DRY-RUN (rollback systematique).");
    console.log("Ajoutez --apply pour ecrire reellement.\n");
    process.exit(2);
  }
  const cheminDb = path.resolve(String(a.db));
  if (!fs.existsSync(cheminDb)) throw new Error(`Base introuvable : ${cheminDb}`);
  const APPLIQUER = !!a.apply;

  const dossier = path.join(path.dirname(cheminDb), "journaux-reparation");
  fs.mkdirSync(dossier, { recursive: true });
  flux = fs.createWriteStream(
    path.join(dossier, `reparation-${APPLIQUER ? "apply" : "dryrun"}-${Date.now()}.log`), { flags: "a" });

  titre(APPLIQUER ? "MODE APPLY — ECRITURE REELLE" : "MODE DRY-RUN — ROLLBACK SYSTEMATIQUE");
  log(`Base : ${cheminDb}`);

  const db = new Database(cheminDb);

  // --- 0. Marqueur : idempotence ------------------------------------------
  titre("0. MARQUEUR DE MIGRATION");
  const dejaFait = db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(MARQUEUR_CLE);
  if (dejaFait && dejaFait.valeur === MARQUEUR_VALEUR) {
    log(`${MARQUEUR_CLE} = ${dejaFait.valeur} — reparation deja effectuee. Rien a faire.`);
    db.close();
    return;
  }
  log(`${MARQUEUR_CLE} : ${dejaFait ? dejaFait.valeur : "absent"} — reparation requise.`);

  // --- 1. Sauvegarde ------------------------------------------------------
  titre("1. SAUVEGARDE");
  if (APPLIQUER) {
    db.pragma("wal_checkpoint(TRUNCATE)");
    const dir = path.join(path.dirname(cheminDb), "backups", "pre-reparation-taille-id");
    fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `belvie-avant-reparation-${new Date().toISOString().replace(/[:.]/g, "-")}.db`);
    fs.copyFileSync(cheminDb, dest);
    log(`Sauvegarde : ${dest}`);
    log("Restauration manuelle : fermer l'ERP, recopier ce fichier par-dessus belvie.db,");
    log("puis supprimer belvie.db-wal et belvie.db-shm s'ils existent.");
  } else log("Dry-run : aucune sauvegarde necessaire, aucun COMMIT ne sera emis.");

  // --- 2. Empreinte AVANT --------------------------------------------------
  titre("2. EMPREINTE AVANT");
  const avant = empreinte(db);
  log(`Lignes           : ${avant.n}`);
  log(`Somme quantites  : ${avant.somme}`);
  log(`Commandes        : ${avant.commandes}`);
  log(`SHA empreinte    : ${avant.sha}`);

  // PRAGMA foreign_keys est un no-op dans une transaction ouverte : AVANT BEGIN.
  db.pragma("foreign_keys = OFF");
  db.exec("BEGIN IMMEDIATE");

  try {
    // --- 3. Garde d'ambiguite --------------------------------------------
    // Un id reference par commande_lignes qui existe des DEUX cotes est
    // indecidable : impossible de savoir a quel referentiel il appartient.
    titre("3. GARDE D'AMBIGUITE");
    const ambigus = db.prepare(`
      SELECT lv.id, lv.nom AS nom_ancien, gtv.valeur AS valeur_grille,
             (SELECT COUNT(*) FROM commande_lignes cl WHERE cl.taille_id = lv.id) AS lignes
      FROM listes_valeurs lv
      JOIN grilles_tailles_valeurs gtv ON gtv.id = lv.id
      WHERE lv.type IN ('taille','pointure')
        AND EXISTS (SELECT 1 FROM commande_lignes cl WHERE cl.taille_id = lv.id)`).all();
    if (ambigus.length) {
      ambigus.forEach((x) => log(`   id=${x.id} ancien="${x.nom_ancien}" grille="${x.valeur_grille}" ${x.lignes} ligne(s)`));
      throw new Error(
        `${ambigus.length} identifiant(s) ambigu(s) : present(s) dans listes_valeurs ET grilles_tailles_valeurs. ` +
        `Aucun remappage automatique n'est sur. Arbitrage manuel requis.`);
    }
    log("OK — aucun identifiant present des deux cotes. Le remappage est decidable.");

    // --- 4. Classification -----------------------------------------------
    titre("4. CLASSIFICATION DES LIGNES");
    const anciennes = db.prepare(`
      SELECT cl.id, cl.taille_id, lv.nom AS libelle
      FROM commande_lignes cl
      JOIN listes_valeurs lv ON lv.id = cl.taille_id
      WHERE cl.taille_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)`).all();
    const conformes = db.prepare(`
      SELECT COUNT(*) AS n FROM commande_lignes cl
      JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id`).get().n;
    const sansTaille = db.prepare("SELECT COUNT(*) AS n FROM commande_lignes WHERE taille_id IS NULL").get().n;
    const irrecup = db.prepare(`
      SELECT COUNT(*) AS n FROM commande_lignes cl
      WHERE cl.taille_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)
        AND NOT EXISTS (SELECT 1 FROM listes_valeurs l WHERE l.id = cl.taille_id)`).get().n;
    log(`Sans taille              : ${sansTaille}`);
    log(`Deja conformes           : ${conformes}`);
    log(`Anciennes a remapper     : ${anciennes.length}`);
    log(`Irrecuperables           : ${irrecup}`);
    const total = sansTaille + conformes + anciennes.length + irrecup;
    if (total !== avant.n) throw new Error(`Couverture incomplete : ${total} classees sur ${avant.n} lignes.`);
    if (irrecup > 0) throw new Error(`${irrecup} ligne(s) sans libelle recuperable. Arret.`);
    log(`Couverture : ${total}/${avant.n} — complete.`);

    // --- 5. Figer les libelles AVANT tout remappage -----------------------
    titre("5. FIGEAGE DES LIBELLES (avant remappage)");
    const fige = db.prepare(`
      UPDATE commande_lignes
      SET taille_nom = COALESCE(
            (SELECT gtv.valeur FROM grilles_tailles_valeurs gtv WHERE gtv.id = commande_lignes.taille_id),
            (SELECT lv.nom FROM listes_valeurs lv
               WHERE lv.id = commande_lignes.taille_id AND lv.type IN ('taille','pointure')))
      WHERE taille_id IS NOT NULL AND taille_nom IS NULL`).run();
    log(`${fige.changes} libelle(s) figes.`);
    const restantNull = db.prepare(
      "SELECT COUNT(*) AS n FROM commande_lignes WHERE taille_id IS NOT NULL AND taille_nom IS NULL").get().n;
    if (restantNull) throw new Error(`${restantNull} ligne(s) restent sans libelle apres figeage.`);
    log("OK — aucune ligne avec taille_id ne reste sans libelle.");
    log("A partir d'ici, meme un echec total laisse l'affichage correct.");

    // --- 6. Derivation du mapping (jamais code en dur) --------------------
    titre("6. DERIVATION DU MAPPING");
    const grilleCible = db.prepare(`
      SELECT gtv.grille_id AS id, COUNT(*) AS n FROM commande_lignes cl
      JOIN grilles_tailles_valeurs gtv ON gtv.id = cl.taille_id
      GROUP BY gtv.grille_id ORDER BY n DESC LIMIT 1`).get();
    if (!grilleCible) throw new Error("Aucune grille cible identifiable : aucune ligne conforme.");
    const nomGrille = db.prepare("SELECT nom FROM grilles_tailles WHERE id = ?").get(grilleCible.id);
    log(`Grille cible : id=${grilleCible.id} "${nomGrille ? nomGrille.nom : "?"}" (${grilleCible.n} lignes conformes)`);

    const ancienIds = [...new Set(anciennes.map((l) => l.taille_id))];
    const mapping = {};
    for (const ancienId of ancienIds) {
      const lib = anciennes.find((l) => l.taille_id === ancienId).libelle;
      const cibles = db.prepare(`
        SELECT id, valeur FROM grilles_tailles_valeurs
        WHERE grille_id = ? AND lower(trim(valeur)) = lower(trim(?))`).all(grilleCible.id, lib);
      const nb = db.prepare("SELECT COUNT(*) AS n FROM commande_lignes WHERE taille_id = ?").get(ancienId).n;
      if (cibles.length === 0) throw new Error(`Aucune cible pour ${ancienId} "${lib}" dans la grille ${grilleCible.id}.`);
      if (cibles.length > 1) throw new Error(`${cibles.length} cibles pour ${ancienId} "${lib}" — ambigu.`);
      mapping[ancienId] = cibles[0].id;
      log(`   ${String(ancienId).padStart(4)} "${lib}"  ->  ${String(cibles[0].id).padStart(4)} "${cibles[0].valeur}"   ${nb} ligne(s)`);
    }

    // --- 7. Verification du mapping avant ecriture ------------------------
    titre("7. VERIFICATION DU MAPPING");
    const couvertes = ancienIds.reduce(
      (s, id) => s + db.prepare("SELECT COUNT(*) AS n FROM commande_lignes WHERE taille_id = ?").get(id).n, 0);
    log(`Correspondances : ${ancienIds.length}   Lignes couvertes : ${couvertes} / ${anciennes.length}`);
    if (couvertes !== anciennes.length) throw new Error("Le mapping ne couvre pas toutes les lignes anciennes.");
    const cibles = Object.values(mapping);
    if (new Set(cibles).size !== cibles.length) throw new Error("Mapping non injectif : deux anciens ids vers la meme cible.");
    log("OK — mapping complet et injectif.");

    // --- 8. Remappage -----------------------------------------------------
    titre("8. REMAPPAGE");
    const upd = db.prepare("UPDATE commande_lignes SET taille_id = ? WHERE taille_id = ?");
    let n = 0;
    // Ordre decroissant des anciens ids : evite qu'un UPDATE ne reecrive une
    // ligne deja traitee si un ancien id egalait une cible (ecarte en 3, garde ici).
    for (const ancienId of ancienIds.sort((x, y) => y - x)) n += upd.run(mapping[ancienId], ancienId).changes;
    log(`${n} ligne(s) remappee(s).`);
    if (n !== anciennes.length) throw new Error(`${n} remappees, ${anciennes.length} attendues.`);

    // --- 9. Reconstruction de la table (seul moyen de changer une FK) -----
    titre("9. RECONSTRUCTION AVEC LA FK CORRECTE");
    db.exec(`
      CREATE TABLE commande_lignes_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        commande_id INTEGER NOT NULL REFERENCES commandes(id) ON DELETE CASCADE,
        couleur_id INTEGER NOT NULL REFERENCES listes_valeurs(id),
        reference_libre TEXT,
        taille_id INTEGER REFERENCES grilles_tailles_valeurs(id),
        taille_nom TEXT,
        quantite INTEGER NOT NULL CHECK (quantite > 0)
      );
      INSERT INTO commande_lignes_new (id, commande_id, couleur_id, reference_libre, taille_id, taille_nom, quantite)
        SELECT id, commande_id, couleur_id, reference_libre, taille_id, taille_nom, quantite FROM commande_lignes;
    `);
    const copiees = db.prepare("SELECT COUNT(*) AS n FROM commande_lignes_new").get().n;
    if (copiees !== avant.n) throw new Error(`Copie incomplete : ${copiees} sur ${avant.n}.`);
    log(`${copiees} ligne(s) copiees, verifiees avant tout DROP.`);
    db.exec("DROP TABLE commande_lignes; ALTER TABLE commande_lignes_new RENAME TO commande_lignes;");
    log("Table remplacee.");

    // --- 10. Index (perdus au DROP) ---------------------------------------
    titre("10. INDEX");
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_commande_lignes_commande ON commande_lignes(commande_id);
      CREATE INDEX IF NOT EXISTS idx_commande_lignes_couleur  ON commande_lignes(couleur_id);
      CREATE INDEX IF NOT EXISTS idx_commande_lignes_taille   ON commande_lignes(taille_id);
    `);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='commande_lignes' AND name LIKE 'idx_%'").all();
    log(`${idx.length} index recrees : ${idx.map((i) => i.name).join(", ")}`);
    if (idx.length !== 3) throw new Error(`${idx.length} index au lieu de 3.`);

    // --- 11. Controles dans la transaction --------------------------------
    titre("11. CONTROLES AVANT COMMIT");
    const fk = db.prepare("PRAGMA foreign_key_check").all();
    if (fk.length) { fk.slice(0, 10).forEach((v) => log(`   ${JSON.stringify(v)}`)); throw new Error(`${fk.length} violation(s) de FK.`); }
    log("foreign_key_check : vide");

    const orph = db.prepare(`
      SELECT COUNT(*) AS n FROM commande_lignes cl WHERE cl.taille_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM grilles_tailles_valeurs g WHERE g.id = cl.taille_id)`).get().n;
    if (orph) throw new Error(`${orph} taille_id orphelin(s).`);
    log("taille_id orphelins : 0");

    const apres = empreinte(db);
    log(`Lignes          : ${apres.n} (avant ${avant.n})`);
    log(`Somme quantites : ${apres.somme} (avant ${avant.somme})`);
    log(`Commandes       : ${apres.commandes} (avant ${avant.commandes})`);
    log(`SHA empreinte   : ${apres.sha}`);
    if (apres.n !== avant.n) throw new Error("Nombre de lignes modifie.");
    if (apres.somme !== avant.somme) throw new Error("Somme des quantites modifiee.");
    if (apres.commandes !== avant.commandes) throw new Error("Nombre de commandes modifie.");
    if (apres.sha !== avant.sha) {
      const diff = apres.lignes.filter((l, i) => JSON.stringify(l) !== JSON.stringify(avant.lignes[i])).slice(0, 5);
      diff.forEach((d, i) => log(`   AVANT ${JSON.stringify(avant.lignes[avant.lignes.findIndex((x) => x.id === d.id)])}\n   APRES ${JSON.stringify(d)}`));
      throw new Error("EMPREINTE METIER MODIFIEE — une donnee affichee a change. Arret.");
    }
    log("EMPREINTE IDENTIQUE — id, commande, couleur, quantite et libelle inchanges ligne a ligne.");

    const sql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='commande_lignes'").get().sql;
    if (!/REFERENCES grilles_tailles_valeurs\(id\)/.test(sql)) throw new Error("La FK n'a pas ete corrigee.");
    log("FK reelle : REFERENCES grilles_tailles_valeurs(id)");

    // --- 12. Marqueur -----------------------------------------------------
    titre("12. MARQUEUR D'IDEMPOTENCE");
    db.prepare("INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur")
      .run(MARQUEUR_CLE, MARQUEUR_VALEUR);
    log(`${MARQUEUR_CLE} = ${MARQUEUR_VALEUR}`);

    // --- 13. COMMIT ou ROLLBACK -------------------------------------------
    if (!APPLIQUER) {
      db.exec("ROLLBACK");
      titre("DRY-RUN TERMINE — ROLLBACK EMIS, BASE INCHANGEE");
      log("Tous les controles ci-dessus ont ete executes sur des donnees reelles,");
      log("puis annules. Relancez avec --apply pour conserver le resultat.");
    } else {
      const rep = await confirmer("Tapez REPARER pour valider definitivement : ");
      if (rep !== "REPARER") { db.exec("ROLLBACK"); titre("ANNULE — ROLLBACK EMIS"); }
      else { db.exec("COMMIT"); titre("REPARATION COMMITEE"); }
    }
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch (_) { /* transaction deja close */ }
    titre("ECHEC — ROLLBACK EMIS");
    log(`Erreur : ${err.message}`);
    log("Aucune modification conservee : CREATE, INSERT, DROP, ALTER et UPDATE sont");
    log("tous transactionnels sous SQLite. La table d'origine est intacte.");
    process.exitCode = 1;
  } finally {
    db.pragma("foreign_keys = ON");
    const ic = db.prepare("PRAGMA integrity_check").all().map((r) => r.integrity_check).join("; ");
    log(`integrity_check : ${ic}`);
    if (ic !== "ok") process.exitCode = 1;
    db.close();
  }
}

main().catch((e) => { log(`ERREUR FATALE : ${e.message}`); process.exit(1); });
