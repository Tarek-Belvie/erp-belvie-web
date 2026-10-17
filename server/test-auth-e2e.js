// ============================================================================
// TEST D'AUTHENTIFICATION BOUT EN BOUT — à exécuter sur votre machine.
//
// Demande votre email/mot de passe LOCALEMENT (jamais affiché ni transmis
// ailleurs que vers Supabase, exactement comme le ferait le futur frontend).
// Se connecte réellement à Supabase Auth, récupère le jeton, puis appelle
// votre API (qui doit tourner en parallèle, voir instructions).
// ============================================================================

const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");
const { chargerEnv } = require("./lib/env");

chargerEnv();

function demander(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (reponse) => { rl.close(); resolve(reponse); }));
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_PUBLISHABLE_KEY) {
    console.error("SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY absentes de .env.");
    process.exit(1);
  }

  const email = await demander("Email du compte administrateur créé dans Supabase : ");
  const password = await demander("Mot de passe (restera visible dans ce terminal, jamais envoyé ailleurs qu'à Supabase) : ");

  console.log("\n=== 1. Connexion à Supabase Auth ===");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_PUBLISHABLE_KEY);
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    console.error("  ECHEC :", error.message);
    process.exit(1);
  }
  console.log("  OK : connecté en tant que", data.user.email);
  const token = data.session.access_token;

  console.log("\n=== 2. Appel de /api/me (votre API doit tourner sur le port 3001) ===");
  try {
    const resMe = await fetch("http://localhost:3001/api/me", { headers: { Authorization: `Bearer ${token}` } });
    const jsonMe = await resMe.json();
    console.log("  status:", resMe.status);
    console.log("  Profil renvoyé par l'API :", JSON.stringify(jsonMe));
    if (resMe.status === 200 && jsonMe.role === "administrateur") {
      console.log("  -> Rôle administrateur correctement reconnu par l'API.");
    }
  } catch (e) {
    console.error("  ECHEC : impossible de joindre l'API sur le port 3001 —", e.message);
    console.error("  Vérifiez qu'un autre terminal exécute bien : node server/index.js");
    process.exit(1);
  }

  console.log("\n=== 3. Appel d'une route métier réelle (GET /api/listes/produit) ===");
  const resListes = await fetch("http://localhost:3001/api/listes/produit", { headers: { Authorization: `Bearer ${token}` } });
  const jsonListes = await resListes.json();
  console.log("  status:", resListes.status, "| nombre d'entrées:", Array.isArray(jsonListes) ? jsonListes.length : jsonListes);

  console.log("\n=== 4. Verification : sans jeton, la meme route doit refuser ===");
  const resSansToken = await fetch("http://localhost:3001/api/listes/produit");
  console.log("  status:", resSansToken.status, "(attendu: 401)");

  console.log("\n=== Test terminé. ===");
}

main().catch((err) => { console.error("Erreur inattendue :", err.message); process.exit(1); });
