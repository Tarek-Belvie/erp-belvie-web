#!/usr/bin/env node
// Gestion des comptes en ligne de commande (sur le serveur) :
//   npm run utilisateur -- creer  <email> "<Nom>" [admin|utilisateur]   (mot de passe demandé, ou MOT_DE_PASSE=…)
//   npm run utilisateur -- mot-de-passe <email>
//   npm run utilisateur -- desactiver <email>
//   npm run utilisateur -- lister
const readline = require("readline");
const bcrypt = require("bcryptjs");
const { chargerConfiguration } = require("../src/config");
const { creerBase } = require("../src/db");
const { creerUtilisateur } = require("../src/auth");

function demander(question) {
  if (process.env.MOT_DE_PASSE) return Promise.resolve(process.env.MOT_DE_PASSE);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((ok) => rl.question(question, (r) => { rl.close(); ok(r); }));
}

(async () => {
  const [action, email, nom, role] = process.argv.slice(2);
  const db = creerBase({ connectionString: chargerConfiguration().databaseUrl });
  await db.initialiser();
  try {
    if (action === "creer") {
      const id = await creerUtilisateur(db, { email, nom, role: role || "utilisateur", motDePasse: await demander("Mot de passe (10 caractères minimum) : ") });
      console.log(`Compte créé (id ${id}).`);
    } else if (action === "mot-de-passe") {
      const mdp = await demander("Nouveau mot de passe : ");
      if (String(mdp).length < 10) throw new Error("10 caractères minimum.");
      const r = await db.run("UPDATE utilisateurs SET mot_de_passe_hash = ? WHERE lower(email) = lower(?)", await bcrypt.hash(mdp, 12), email);
      await db.run("DELETE FROM sessions WHERE utilisateur_id IN (SELECT id FROM utilisateurs WHERE lower(email) = lower(?))", email);
      console.log(r.changes ? "Mot de passe changé, sessions fermées." : "Compte introuvable.");
    } else if (action === "desactiver") {
      const r = await db.run("UPDATE utilisateurs SET actif = 0 WHERE lower(email) = lower(?)", email);
      await db.run("DELETE FROM sessions WHERE utilisateur_id IN (SELECT id FROM utilisateurs WHERE lower(email) = lower(?))", email);
      console.log(r.changes ? "Compte désactivé." : "Compte introuvable.");
    } else if (action === "lister") {
      console.table(await db.all("SELECT id, email, nom, role, actif, derniere_connexion FROM utilisateurs ORDER BY id"));
    } else {
      console.log("Actions : creer <email> <nom> [admin|utilisateur] | mot-de-passe <email> | desactiver <email> | lister");
    }
  } catch (err) { console.error(err.message); process.exitCode = 1; } finally { await db.fermer(); }
})();
