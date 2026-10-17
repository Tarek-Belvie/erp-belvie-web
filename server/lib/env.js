// ============================================================================
// Chargement de .env — FALLBACK DE DÉVELOPPEMENT UNIQUEMENT.
//
// En production (Vercel), les variables sont déjà injectées directement dans
// process.env par la plateforme — aucun fichier .env n'existe ni n'est
// nécessaire. process.env[cle] || valeur ci-dessous ne remplace JAMAIS une
// variable déjà définie : Vercel reste toujours prioritaire, ce fichier ne
// fait que compléter ce qui manque en local.
//
// Aucune valeur n'est jamais journalisée ici — seule la présence/absence de
// chaque clé peut être diagnostiquée (diagnostiquerEnv), jamais son contenu.
// ============================================================================

const path = require("path");
const fs = require("fs");

function chargerEnvDepuisFichier(cheminEnv) {
  if (!fs.existsSync(cheminEnv)) return false;
  const lignes = fs.readFileSync(cheminEnv, "utf-8").split(/\r?\n/);
  for (const ligne of lignes) {
    const m = ligne.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = process.env[m[1]] || m[2].trim();
  }
  return true;
}

// __dirname est résolu par rapport à l'EMPLACEMENT de ce fichier (server/lib/env.js),
// jamais par rapport au répertoire de travail courant — fonctionne donc à l'identique
// que l'on lance `node server/index.js` depuis la racine ou `node index.js` depuis server/.
function chargerEnv() {
  const racineProjet = path.join(__dirname, "..", "..");
  return chargerEnvDepuisFichier(path.join(racineProjet, ".env"));
}

// Diagnostic sûr : confirme la PRÉSENCE de chaque variable, jamais sa valeur.
function diagnostiquerEnv(cles) {
  return Object.fromEntries(cles.map((c) => [c, process.env[c] !== undefined && process.env[c] !== ""]));
}

module.exports = { chargerEnv, diagnostiquerEnv };
