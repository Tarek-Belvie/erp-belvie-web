// ================================================================================================
// Configuration — lue UNE fois, depuis les variables d'environnement (fichier .env en local).
// Aucune valeur secrète n'a de valeur par défaut : son absence arrête le démarrage, avec la liste
// de ce qui manque, plutôt qu'un fonctionnement silencieusement dégradé.
// ================================================================================================
const fs = require("fs");
const path = require("path");

function chargerFichierEnv() {
  const candidats = [path.join(process.cwd(), ".env"), path.join(__dirname, "../../../.env")];
  for (const f of candidats) {
    if (!fs.existsSync(f)) continue;
    for (const ligne of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(ligne);
      if (!m || ligne.trim().startsWith("#")) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
    return f;
  }
  return null;
}

function chargerConfiguration() {
  chargerFichierEnv();
  const manquantes = ["DATABASE_URL"].filter((k) => !process.env[k]);
  if (manquantes.length) throw new Error("Variables d'environnement manquantes : " + manquantes.join(", ") + " (voir .env.example).");
  const production = process.env.NODE_ENV === "production";
  return {
    production,
    port: Number(process.env.PORT || 3001),
    databaseUrl: process.env.DATABASE_URL,
    // Origines autorisées à appeler l'API directement (en production, le front passe par la
    // réécriture /api de Vercel : il est sur la même origine et n'en a pas besoin).
    originesAutorisees: (process.env.ORIGINES_AUTORISEES || "").split(",").map((s) => s.trim()).filter(Boolean),
    cookieSecurise: production || process.env.COOKIE_SECURISE === "1",
    dureeSessionJours: Number(process.env.DUREE_SESSION_JOURS || 14),
    // Derrière un proxy (Caddy/Nginx, Vercel) : nécessaire pour l'IP réelle et les cookies Secure.
    // Nombre de proxys de confiance (Caddy = 1). Un NOMBRE : Express lirait une chaîne comme une IP.
    trustProxy: Number(process.env.TRUST_PROXY || (production ? 1 : 0)),
  };
}

module.exports = { chargerConfiguration, chargerFichierEnv };
