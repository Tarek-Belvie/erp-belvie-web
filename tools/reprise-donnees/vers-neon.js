#!/usr/bin/env node
// ================================================================================================
// BASCULE DÉFINITIVE : données de Belvie ERP (Electron, sur ce PC) → base de production Neon.
//
//   Windows : double-clic sur reprise-vers-neon.bat
//
// Déroulé (rien n'est écrit avant l'étape 5, et seulement après « OUI ») :
//   1. demande l'URL de la base Neon (ou la lit dans .env : NEON_DATABASE_URL_UNPOOLED) ;
//   2. copie belvie.db (+ -wal, -shm) depuis %APPDATA%\belvie-erp — l'original n'est jamais ouvert
//      en écriture ;
//   3. met le schéma Neon à jour (migrations) ;
//   4. CONTRÔLE À BLANC de la reprise : compatibilité, comptages — rien n'est écrit ;
//   5. après confirmation : reprise en UNE transaction, puis vérification table par table
//      (contenu identique) ; une base Neon qui contient déjà des données est REFUSÉE ;
//   6. création du compte administrateur (mot de passe saisi ici, jamais affiché ni enregistré).
//
// Les images ne sont pas concernées : elles sont déjà dans Cloudflare R2 (envoyer-fichiers-vers-r2.bat).
// ================================================================================================
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { spawnSync } = require("child_process");

const RACINE = path.resolve(__dirname, "../..");
require(path.join(RACINE, "apps/api/src/config")).chargerFichierEnv();

function question(q, { masque = false } = {}) {
  return new Promise((ok) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (masque) {
      rl._writeToOutput = (s) => { if (s.startsWith(q)) process.stdout.write(q); else if (s.includes("\n") || s.includes("\r")) process.stdout.write("\n"); else process.stdout.write("•".repeat(s.length)); };
    }
    rl.question(q, (r) => { rl.close(); ok(r.trim()); });
  });
}
const etape = (t) => console.log(`\n▶ ${t}`);

async function principal() {
  console.log("Belvie ERP — bascule des données vers la base en ligne (Neon)");

  // 1. Base cible
  let url = process.env.NEON_DATABASE_URL_UNPOOLED || "";
  if (!url) {
    console.log("\nURL de la base Neon : Vercel → Storage → base belvie-erp → onglet .env.local →");
    console.log("ligne DATABASE_URL_UNPOOLED (sans les guillemets). Elle n'est enregistrée nulle part.");
    url = await question("URL : ");
  }
  url = url.replace(/^["']|["']$/g, "");
  if (!/^postgres(ql)?:\/\//.test(url)) throw new Error("Ce n'est pas une URL PostgreSQL (elle commence par postgresql://).");
  if (/localhost|127\.0\.0\.1/.test(url) && process.env.BELVIE_TEST_REPRISE !== "1") throw new Error("Cette URL désigne une base locale, pas la base en ligne.");
  if (/-pooler\./.test(url)) throw new Error("URL « pooler » : prendre la ligne DATABASE_URL_UNPOOLED (sans -pooler).");
  const hote = new URL(url).hostname;
  console.log(`Base cible : ${hote}`);

  // 2. Copie de la base Electron
  const dossierElectron = process.platform === "win32" ? path.join(process.env.APPDATA || "", "belvie-erp") : path.join(os.homedir(), ".config", "belvie-erp");
  const source = path.join(dossierElectron, "belvie.db");
  if (!fs.existsSync(source)) throw new Error(`Base Belvie ERP introuvable : ${source}`);
  etape("Copie de la base Belvie ERP (l'original n'est pas modifié)…");
  console.log("  Belvie ERP (Electron) doit être FERMÉ pendant la copie.");
  const copie = path.join(RACINE, ".local", "reprise-neon");
  fs.rmSync(copie, { recursive: true, force: true });
  fs.mkdirSync(copie, { recursive: true });
  for (const s of ["", "-wal", "-shm"]) if (fs.existsSync(source + s)) fs.copyFileSync(source + s, path.join(copie, "belvie.db" + s));
  const date = fs.statSync(source).mtime.toLocaleString("fr-FR");
  console.log(`  Copiée (dernière modification : ${date}).`);

  // 3. Schéma
  etape("Mise à jour du schéma de la base en ligne…");
  const { migrer } = require(path.join(RACINE, "apps/api/src/db/migrer"));
  await migrer({ connectionString: url, journal: (t) => console.log("  " + t) });

  // 4. Contrôle à blanc
  const argsReprise = [path.join(RACINE, "tools/reprise-donnees/reprise.js"), "--sqlite", path.join(copie, "belvie.db"), "--pg", url,
    "--ignorer-table", "ft_tailles_new", "--archive", path.join(copie, "archives")];
  etape("Contrôle à blanc (rien n'est écrit)…");
  if (spawnSync(process.execPath, argsReprise, { stdio: "inherit", cwd: RACINE }).status !== 0) {
    throw new Error("Le contrôle signale un problème (voir ci-dessus) : rien n'a été copié.");
  }

  // 5. Reprise
  const ok = await question(`\nCopier maintenant toutes les données dans la base en ligne (${hote}) ? Tapez OUI : `);
  if (ok !== "OUI") { console.log("Annulé : rien n'a été copié."); return; }
  etape("Reprise (une seule transaction, puis vérification table par table)…");
  if (spawnSync(process.execPath, [...argsReprise, "--executer"], { stdio: "inherit", cwd: RACINE }).status !== 0) {
    throw new Error("La reprise a échoué : la transaction est annulée, la base en ligne est restée vide.");
  }

  // 6. Compte administrateur
  const { creerBase } = require(path.join(RACINE, "apps/api/src/db"));
  const { creerUtilisateur } = require(path.join(RACINE, "apps/api/src/auth"));
  const db = creerBase({ connectionString: url });
  await db.initialiser();
  try {
    const n = Number((await db.prepare("SELECT count(*) AS n FROM utilisateurs").get()).n);
    if (n === 0) {
      etape("Création de votre compte administrateur (pour vous connecter au site)…");
      const email = (await question("E-mail [tarek.bouhejba2@gmail.com] : ")) || "tarek.bouhejba2@gmail.com";
      const nom = (await question("Nom affiché [Tarek Bouhejba] : ")) || "Tarek Bouhejba";
      for (;;) {
        const mdp = await question("Mot de passe (10 caractères minimum, invisible à l'écran) : ", { masque: true });
        const confirmation = await question("Confirmez le mot de passe : ", { masque: true });
        if (mdp !== confirmation) { console.log("  Les deux saisies diffèrent, recommencez."); continue; }
        try { await creerUtilisateur(db, { email, nom, motDePasse: mdp, role: "admin" }); break; }
        catch (err) { console.log(`  ${err.message}`); }
      }
      console.log(`  Compte administrateur créé : ${email}`);
    } else {
      console.log(`\n${n} compte(s) déjà présent(s) : aucun compte créé.`);
    }
  } finally { await db.fermer(); }

  console.log("\n================================================================");
  console.log("  ✔ Données copiées et vérifiées dans la base en ligne.");
  console.log("  À partir de maintenant, utilisez UNIQUEMENT la version web.");
  console.log("================================================================");
}

principal().catch((err) => { console.error(`\n✖ ${err.message}`); process.exitCode = 1; });
