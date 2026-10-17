// Point d'entrée de l'API : configuration → migrations → connexions → écoute.
const { chargerConfiguration } = require("./config");
const { migrer } = require("./db/migrer");
const { creerBase } = require("./db");
const { creerApp } = require("./app");
const { nettoyerTeleversements } = require("./lib/plateforme");
const { fermerNavigateur } = require("./lib/fenetreImpression");

process.on("unhandledRejection", (err) => console.error(`[${new Date().toISOString()}] Rejet non géré :`, err));

async function demarrer() {
  const config = chargerConfiguration();
  if (process.env.MIGRER_AU_DEMARRAGE !== "0") await migrer({ connectionString: config.databaseUrl });

  const db = creerBase({ connectionString: config.databaseUrl });
  // Connexions de LECTURE : toute écriture y est refusée par PostgreSQL. Les routes GET les
  // utilisent, ce qui garantit qu'une lecture ne modifie jamais rien, même par erreur.
  const dbLecture = creerBase({ connectionString: config.databaseUrl, options: "-c default_transaction_read_only=on" });
  await db.initialiser();
  await dbLecture.initialiser();

  const app = creerApp({ db, dbLecture, config });
  const serveur = app.listen(config.port, () => console.log(`Belvie ERP — API à l'écoute sur le port ${config.port}`));

  nettoyerTeleversements();
  const minuteur = setInterval(() => nettoyerTeleversements(), 3600 * 1000);

  const arreter = async () => {
    clearInterval(minuteur);
    serveur.close();
    await fermerNavigateur();
    await db.fermer(); await dbLecture.fermer();
    process.exit(0);
  };
  process.on("SIGTERM", arreter);
  process.on("SIGINT", arreter);
}

demarrer().catch((err) => { console.error("Démarrage impossible :", err.message); process.exit(1); });
