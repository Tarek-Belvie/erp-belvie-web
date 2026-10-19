// ================================================================================================
// Point d'entrée Vercel (fonction serverless) — toute l'API et la route /media passent ici
// (voir les réécritures de vercel.json).
//
// Différences avec apps/api/src/server.js (serveur classique) :
//   * pas de migrations au démarrage : elles sont appliquées pendant le build de production
//     (tools/vercel/build.js), une seule fois, par une connexion directe ;
//   * pas de app.listen : Vercel appelle l'application Express pour chaque requête ;
//   * l'application et le pool de connexions sont créés une fois par instance, puis réutilisés.
// ================================================================================================
const { chargerConfiguration } = require("../apps/api/src/config");
const { creerBase } = require("../apps/api/src/db");
const { creerApp } = require("../apps/api/src/app");

let pret = null;
function application() {
  if (!pret) {
    pret = (async () => {
      const config = chargerConfiguration();
      const db = creerBase({ connectionString: config.databaseUrl });
      await db.initialiser();
      return creerApp({ db, config });
    })();
    pret.catch(() => { pret = null; }); // échec (base momentanément injoignable) : on réessaiera
  }
  return pret;
}

module.exports = async (req, res) => {
  try {
    const app = await application();
    // La fonction ne se termine qu'une fois la réponse envoyée (Express répond de façon asynchrone).
    await new Promise((fin) => { res.on("finish", fin); res.on("close", fin); app(req, res); });
  } catch (err) {
    console.error("Démarrage de l'API impossible :", err);
    res.statusCode = 503;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ erreur: "Service momentanément indisponible. Réessayez dans un instant." }));
  }
};
