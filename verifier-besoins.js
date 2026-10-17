// Relevé des besoins de TOUTES les commandes approvisionnables, dans un fichier texte.
//
// À quoi ça sert : lancer ce relevé AVANT une mise à jour, puis APRÈS, et comparer les deux
// fichiers. S'ils sont identiques, aucun chiffre n'a bougé — la preuve est mécanique, pas
// visuelle. C'est le test M3, en une commande au lieu d'une série de captures d'écran.
//
// Ce script LIT, il n'écrit rien dans la base : elle est ouverte en lecture seule, et aucune
// migration n'est déclenchée. Le seul fichier écrit est le relevé demandé.
//
// Utilisation (invite de commandes Windows, depuis le dossier du projet) :
//
//     set ELECTRON_RUN_AS_NODE=1
//     npx electron verifier-besoins.js besoins-avant.txt
//
// Pourquoi `npx electron` et non `node` : better-sqlite3 est compilé pour Electron (voir le
// script postinstall du projet). Lancé avec le `node` du système, il refuserait de se charger.
// ELECTRON_RUN_AS_NODE fait tourner Electron comme un Node ordinaire, sans fenêtre, avec la
// bonne version du module.
//
// Si la base n'est pas à l'emplacement habituel, donnez-le en second argument :
//
//     npx electron verifier-besoins.js besoins-avant.txt "D:\\chemin\\vers\\belvie.db"

const fs = require("fs");
const path = require("path");

const STATUTS = ["validee", "en_production", "controle_qualite"];

function cheminBaseParDefaut() {
  // Même emplacement que celui calculé par Electron : app.getPath("userData"), qui vaut
  // %APPDATA%\<nom de l'application> sous Windows. Le nom vient de package.json ("belvie-erp").
  if (process.platform === "win32" && process.env.APPDATA) {
    return path.join(process.env.APPDATA, "belvie-erp", "belvie.db");
  }
  if (process.platform === "darwin") {
    return path.join(process.env.HOME || "", "Library", "Application Support", "belvie-erp", "belvie.db");
  }
  return path.join(process.env.HOME || "", ".config", "belvie-erp", "belvie.db");
}

/**
 * Ouvre la base en lecture seule. On essaie better-sqlite3 (celui du projet), puis le module
 * sqlite intégré à Node en secours — les deux exposent prepare().get()/.all(), c'est tout ce
 * dont on a besoin ici.
 */
function ouvrirEnLecture(chemin) {
  try {
    const Database = require("better-sqlite3");
    return { db: new Database(chemin, { readonly: true, fileMustExist: true }), moteur: "better-sqlite3" };
  } catch (err) {
    try {
      const { DatabaseSync } = require("node:sqlite");
      return { db: new DatabaseSync(chemin, { readOnly: true }), moteur: "node:sqlite" };
    } catch (err2) {
      throw new Error(
        "Impossible d'ouvrir la base.\n" +
        "  better-sqlite3 : " + (err && err.message) + "\n" +
        "  node:sqlite    : " + (err2 && err2.message) + "\n" +
        "Relancez avec Electron :  set ELECTRON_RUN_AS_NODE=1  puis  npx electron verifier-besoins.js <fichier>"
      );
    }
  }
}

function nb(v) {
  if (v == null) return "-";
  return Number(v).toFixed(3);
}

function main() {
  const sortie = process.argv[2];
  if (!sortie) {
    console.error("Usage : npx electron verifier-besoins.js <fichier-de-sortie.txt> [chemin\\vers\\belvie.db]");
    process.exit(1);
  }
  const cheminDb = process.argv[3] || cheminBaseParDefaut();
  if (!fs.existsSync(cheminDb)) {
    console.error("Base introuvable : " + cheminDb);
    console.error("Donnez son chemin en second argument si elle est ailleurs.");
    process.exit(1);
  }

  const { db, moteur } = ouvrirEnLecture(cheminDb);
  const { calculerPourCommande } = require("./electron/ipc/besoins.js");

  const commandes = db.prepare(
    "SELECT id, numero, statut FROM commandes WHERE deleted_at IS NULL AND statut IN ('" +
    STATUTS.join("','") + "') ORDER BY id"
  ).all();

  const lignes = [];
  lignes.push("RELEVÉ DES BESOINS — " + new Date().toISOString().slice(0, 19).replace("T", " "));
  lignes.push("base   : " + cheminDb);
  lignes.push("moteur : " + moteur);
  lignes.push("commandes approvisionnables : " + commandes.length);
  lignes.push("");
  lignes.push("Ce relevé ne contient QUE des chiffres de besoin : comparez deux relevés avec `fc`.");
  lignes.push("La date et le chemin ci-dessus diffèrent évidemment d'un relevé à l'autre ;");
  lignes.push("`fc` les signalera, et c'est normal. Seules les lignes BESOIN doivent être identiques.");
  lignes.push("=".repeat(100));

  let total = 0;
  let erreurs = 0;

  commandes.forEach((c) => {
    lignes.push("");
    lignes.push("COMMANDE " + (c.numero || ("id=" + c.id)) + "  [" + c.statut + "]");
    try {
      const r = calculerPourCommande(db, c.id);
      // Tri stable : deux relevés doivent se comparer ligne à ligne, quelle que soit la base.
      const triees = r.lignes.slice().sort((a, b) =>
        String(a.composant_nom + "|" + a.cible_libelle + "|" + (a.unite || ""))
          .localeCompare(String(b.composant_nom + "|" + b.cible_libelle + "|" + (b.unite || ""))));
      triees.forEach((l) => {
        total += 1;
        lignes.push(
          "BESOIN  " +
          String(l.composant_nom).padEnd(34).slice(0, 34) + " | " +
          String(l.cible_libelle).padEnd(28).slice(0, 28) + " | " +
          String(l.unite || "-").padEnd(6) + " | " +
          "brut " + nb(l.besoin_brut).padStart(12) + " | " +
          "nec " + nb(l.quantite_necessaire).padStart(12) + " | " +
          "cmd " + nb(l.quantite_commandee).padStart(12) + " | " +
          "recu " + nb(l.quantite_recue).padStart(12) + " | " +
          "reste " + nb(l.reste_a_commander).padStart(12) + " | " +
          (l.anomalies.length ? l.anomalies.join(",") : "-")
        );
      });
      if (triees.length === 0) lignes.push("BESOIN  (aucune ligne)");
    } catch (err) {
      erreurs += 1;
      lignes.push("ERREUR  " + ((err && err.message) || "calcul impossible"));
    }
  });

  lignes.push("");
  lignes.push("=".repeat(100));
  lignes.push("TOTAL   " + total + " lignes de besoin, " + erreurs + " commande(s) en erreur");

  fs.writeFileSync(sortie, lignes.join("\r\n"), "utf-8");
  console.log("Relevé écrit : " + path.resolve(sortie));
  console.log("  " + commandes.length + " commandes, " + total + " lignes de besoin, " + erreurs + " erreur(s)");
  if (typeof db.close === "function") db.close();
}

main();
