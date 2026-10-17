#!/usr/bin/env node
// ============================================================================
// AUDIT PHOTOS — croise article_photos avec les fichiers physiques.
// LECTURE SEULE STRICTE : aucune écriture en base, aucun fichier créé,
// déplacé ou supprimé. Aucun upload, aucun bucket.
//
//   node audit-photos.js --db="C:\Users\<toi>\AppData\Roaming\Belvie ERP\belvie.db"
//
// Options :
//   --data-dir=<chemin>  Dossier racine des médias. Par défaut le dossier
//                        contenant le .db, ce qui correspond à userData.
//                        À préciser si vous auditez une COPIE de la base.
//   --manifeste          Écrit en plus un manifeste JSON (audit-photos.json)
//                        dans le dossier courant, utile pour l'upload ultérieur.
//   --tout               Audite aussi planning, logo et snapshots BC PF (lot 2).
// ============================================================================

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function lireArgs() {
  const o = {};
  for (const a of process.argv.slice(2)) {
    const m = a.match(/^--([a-z0-9-]+)(?:=(.*))?$/i);
    if (m) o[m[1]] = m[2] === undefined ? true : m[2];
  }
  return o;
}

function ko(n) { return (n / 1024).toFixed(1); }

function verifier(dataDir, relPath) {
  if (!relPath) return { rel: null, etat: "COLONNE VIDE", octets: 0 };
  // Les chemins en base utilisent "/" ; path.join normalise pour Windows.
  const abs = path.join(dataDir, ...String(relPath).split("/"));
  if (!fs.existsSync(abs)) return { rel: relPath, abs, etat: "MANQUANT", octets: 0 };
  const st = fs.statSync(abs);
  if (!st.isFile()) return { rel: relPath, abs, etat: "PAS UN FICHIER", octets: 0 };
  if (st.size === 0) return { rel: relPath, abs, etat: "VIDE (0 octet)", octets: 0 };
  return { rel: relPath, abs, etat: "OK", octets: st.size };
}

function main() {
  const a = lireArgs();
  if (!a.db || a.db === true) {
    console.log("\n--db=<chemin vers belvie.db> est obligatoire.\n");
    console.log('Exemple : node audit-photos.js --db="%APPDATA%\\Belvie ERP\\belvie.db"\n');
    process.exit(2);
  }
  const cheminDb = path.resolve(String(a.db));
  if (!fs.existsSync(cheminDb)) throw new Error(`Base introuvable : ${cheminDb}`);
  const dataDir = a["data-dir"] ? path.resolve(String(a["data-dir"])) : path.dirname(cheminDb);

  console.log("=".repeat(96));
  console.log("AUDIT PHOTOS — LECTURE SEULE");
  console.log("=".repeat(96));
  console.log(`Base          : ${cheminDb}`);
  console.log(`Dossier média : ${dataDir}`);
  console.log(`               (les chemins en base sont relatifs à ce dossier)`);
  if (!fs.existsSync(path.join(dataDir, "images"))) {
    console.log("");
    console.log(`AVERTISSEMENT : ${path.join(dataDir, "images")} est introuvable.`);
    console.log("Si vous auditez une copie de la base, précisez --data-dir=<dossier userData réel>.");
  }
  console.log("");

  const db = new Database(cheminDb, { readonly: true, fileMustExist: true });

  // --- article_photos : le lot 1 ------------------------------------------
  const lignes = db.prepare(`
    SELECT ap.id, ap.article_id, ap.photo_path, ap.photo_thumb_path,
           ap.est_principale, ap.ordre,
           a.reference_principale, lv.nom AS produit
    FROM article_photos ap
    LEFT JOIN articles a ON a.id = ap.article_id
    LEFT JOIN listes_valeurs lv ON lv.id = a.produit_id
    ORDER BY ap.article_id, ap.ordre, ap.id`).all();

  console.log("-".repeat(96));
  console.log("DÉTAIL LIGNE À LIGNE — article_photos");
  console.log("-".repeat(96));
  console.log(
    "id".padStart(4) + "  " + "art".padStart(4) + "  " + "référence".padEnd(20) +
    "  " + "original".padEnd(16) + "  " + "miniature".padEnd(16) + "  princ.");

  const manquantsOrig = [], manquantsThumb = [], memeFichier = [];
  const manifeste = [];
  let okOrig = 0, okThumb = 0, octetsOrig = 0, octetsThumb = 0;

  for (const l of lignes) {
    const o = verifier(dataDir, l.photo_path);
    const t = verifier(dataDir, l.photo_thumb_path);
    if (o.etat === "OK") { okOrig++; octetsOrig += o.octets; } else manquantsOrig.push({ ...l, detail: o });
    if (t.etat === "OK") { okThumb++; octetsThumb += t.octets; } else manquantsThumb.push({ ...l, detail: t });
    if (l.photo_path && l.photo_path === l.photo_thumb_path) memeFichier.push(l);

    const etatO = o.etat === "OK" ? `OK ${ko(o.octets)} Ko` : o.etat;
    const etatT = t.etat === "OK" ? `OK ${ko(t.octets)} Ko` : t.etat;
    console.log(
      String(l.id).padStart(4) + "  " + String(l.article_id).padStart(4) + "  " +
      String(l.reference_principale || l.produit || "?").slice(0, 20).padEnd(20) + "  " +
      etatO.padEnd(16) + "  " + etatT.padEnd(16) + "  " + (l.est_principale ? "oui" : ""));

    manifeste.push({
      id: l.id, article_id: l.article_id, reference: l.reference_principale,
      photo_path: l.photo_path, photo_thumb_path: l.photo_thumb_path,
      original: { etat: o.etat, octets: o.octets },
      miniature: { etat: t.etat, octets: t.octets },
    });
  }

  // --- Fichiers présents sur le disque -------------------------------------
  const dirImages = path.join(dataDir, "images", "commandes");
  const dirThumbs = path.join(dirImages, "thumbs");
  const lister = (d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => {
    try { return fs.statSync(path.join(d, f)).isFile(); } catch { return false; }
  }) : null);
  const fOrig = lister(dirImages);
  const fThumb = lister(dirThumbs);

  const referencesOrig = new Set(lignes.map((l) => l.photo_path).filter(Boolean).map((p) => path.basename(p)));
  const referencesThumb = new Set(lignes.map((l) => l.photo_thumb_path).filter(Boolean).map((p) => path.basename(p)));
  const orphelinsOrig = fOrig ? fOrig.filter((f) => !referencesOrig.has(f)) : [];
  const orphelinsThumb = fThumb ? fThumb.filter((f) => !referencesThumb.has(f)) : [];

  // --- BILAN ---------------------------------------------------------------
  console.log("");
  console.log("=".repeat(96));
  console.log("BILAN");
  console.log("=".repeat(96));
  console.log(`Lignes article_photos          : ${lignes.length}`);
  console.log(`Originaux retrouvés            : ${okOrig} / ${lignes.length}   (${ko(octetsOrig)} Ko)`);
  console.log(`Miniatures retrouvées          : ${okThumb} / ${lignes.length}   (${ko(octetsThumb)} Ko)`);
  console.log(`Total à téléverser             : ${((octetsOrig + octetsThumb) / 1048576).toFixed(2)} Mo`);
  console.log("");
  console.log(`Fichiers dans images/commandes : ${fOrig === null ? "DOSSIER ABSENT" : fOrig.length}`);
  console.log(`Fichiers dans .../thumbs       : ${fThumb === null ? "DOSSIER ABSENT" : fThumb.length}`);
  console.log(`Orphelins (fichier sans ligne) : ${orphelinsOrig.length} original(aux), ${orphelinsThumb.length} miniature(s)`);
  console.log("   Des orphelins sont NORMAUX : ils proviennent de photos remplacées ou");
  console.log("   supprimées. Ils ne seront pas téléversés et ne posent aucun problème.");

  if (memeFichier.length) {
    console.log("");
    console.log(`Miniature identique à l'original : ${memeFichier.length} ligne(s)`);
    console.log("   Repli de photos.js:80 quand sharp a échoué. Sans gravité : la même");
    console.log("   image servira d'aperçu, elle sera simplement plus lourde à charger.");
    memeFichier.forEach((l) => console.log(`   id=${l.id} ${l.photo_path}`));
  }

  if (manquantsOrig.length === 0 && manquantsThumb.length === 0) {
    console.log("");
    console.log("AUCUN FICHIER MANQUANT — la couverture est complète, l'upload peut être planifié.");
  } else {
    console.log("");
    console.log("-".repeat(96));
    console.log("FICHIERS MANQUANTS");
    console.log("-".repeat(96));
    for (const [titre, liste] of [["ORIGINAUX", manquantsOrig], ["MINIATURES", manquantsThumb]]) {
      if (!liste.length) continue;
      console.log(`${titre} (${liste.length}) :`);
      liste.forEach((m) => console.log(
        `   id=${String(m.id).padStart(4)}  article=${String(m.article_id).padStart(4)}  ` +
        `${String(m.reference_principale || "?").padEnd(20)}  ${m.detail.etat.padEnd(16)}  ${m.detail.rel || "(vide)"}`));
    }
    console.log("");
    console.log("NE SUPPRIMEZ AUCUNE LIGNE : elles portent est_principale et ordre,");
    console.log("structurants pour l'affichage. Une ligne sans fichier donnera une image");
    console.log("absente sur le web, exactement comme aujourd'hui — rien n'empire.");
  }

  // --- Lot 2, sur demande --------------------------------------------------
  if (a.tout) {
    console.log("");
    console.log("=".repeat(96));
    console.log("LOT 2 — planning, logo, snapshots BC PF (hors périmètre actuel)");
    console.log("=".repeat(96));
    const autres = [
      ["planning_articles.photo_path", "SELECT id, photo_path AS p FROM planning_articles WHERE photo_path IS NOT NULL"],
      ["planning_articles.photo_thumb_path", "SELECT id, photo_thumb_path AS p FROM planning_articles WHERE photo_thumb_path IS NOT NULL"],
      ["entreprise.logo_path", "SELECT id, logo_path AS p FROM entreprise WHERE logo_path IS NOT NULL"],
      ["bc_pf.photo_snapshot_path", "SELECT id, photo_snapshot_path AS p FROM bc_pf WHERE photo_snapshot_path IS NOT NULL"],
      ["bc_pf.entreprise_logo_snapshot_path", "SELECT id, entreprise_logo_snapshot_path AS p FROM bc_pf WHERE entreprise_logo_snapshot_path IS NOT NULL"],
    ];
    for (const [nom, sql] of autres) {
      let rows = [];
      try { rows = db.prepare(sql).all(); } catch (e) { console.log(`${nom.padEnd(40)} (table absente)`); continue; }
      const present = rows.filter((r) => verifier(dataDir, r.p).etat === "OK").length;
      console.log(`${nom.padEnd(40)} ${String(present).padStart(4)} / ${String(rows.length).padStart(4)} fichier(s) retrouvé(s)`);
    }
  }

  if (a.manifeste) {
    const dest = path.resolve("audit-photos.json");
    fs.writeFileSync(dest, JSON.stringify({
      date: new Date().toISOString(), base: cheminDb, dataDir,
      total: lignes.length, originaux_ok: okOrig, miniatures_ok: okThumb,
      lignes: manifeste,
    }, null, 2));
    console.log("");
    console.log(`Manifeste écrit : ${dest}`);
    console.log("(seul fichier créé par ce script, hors de tout dossier applicatif)");
  }

  db.close();
  console.log("");
  console.log("Fin de l'audit. Aucune écriture en base, aucun fichier média touché.");
}

try { main(); } catch (e) { console.error(`ERREUR : ${e.message}`); process.exit(1); }
