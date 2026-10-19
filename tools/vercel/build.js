#!/usr/bin/env node
// ================================================================================================
// BUILD VERCEL (commande « npm run vercel-build », appelée par vercel.json)
//
//   1. Construction de l'interface (apps/web/dist) ;
//   2. déploiement de PRODUCTION uniquement, en DERNIER : migrations de la base (connexion directe
//      DATABASE_URL_UNPOOLED, une transaction par fichier). Les prévisualisations n'y touchent jamais.
//
// ATTENTION : la version précédente continue de servir pendant le build et jusqu'à la bascule, sur le
// schéma déjà migré ; un « Instant Rollback » Vercel la remettrait aussi en service. Une migration doit
// donc rester COMPATIBLE avec le code précédent : ajouter d'abord (colonne, table), ne retirer ou
// renommer que dans une version ultérieure (règle D31, docs/regles-developpement.md).
// ================================================================================================
const path = require("path");
const { spawnSync } = require("child_process");

const RACINE = path.resolve(__dirname, "../..");

async function principal() {
  // Interface d'ABORD : si elle ne se construit pas, le build échoue sans avoir touché à la base.
  console.log("▶ Construction de l'interface…");
  const r = spawnSync("npm", ["run", "build:sans-typage", "--workspace", "apps/web"], { cwd: RACINE, stdio: "inherit" });
  if (r.status !== 0) throw new Error("La construction de l'interface a échoué.");

  const environnement = process.env.VERCEL_ENV || "local";
  if (environnement !== "production") {
    console.log(`▶ Environnement « ${environnement} » : migrations non appliquées (production uniquement).`);
    return;
  }
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL absente : relier la base Neon au projet Vercel (onglet Storage).");
  console.log("▶ Migrations de la base de production (dernière étape du build)…");
  const { migrer } = require(path.join(RACINE, "apps/api/src/db/migrer"));
  await migrer({ connectionString: url, journal: (t) => console.log("  " + t) });
}

principal().catch((err) => { console.error(`✖ ${err.message}`); process.exit(1); });
