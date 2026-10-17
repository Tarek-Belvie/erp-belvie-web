// ============================================================================
// POINT D'ENTRÉE DE L'API WEB.
//
// Toute route sous /api/* passe par requireAuth AVANT d'atteindre une route
// métier — appliqué une seule fois ici, jamais dans chaque fichier de route.
// Seul /api/health échappe à l'authentification (vérification de disponibilité).
// ============================================================================

// Charge .env AVANT tout le reste — fallback de developpement uniquement, voir server/lib/env.js.
// En production (Vercel), process.env est deja rempli par la plateforme ; cet appel ne fait rien
// de plus que confirmer l'absence de fichier .env et continuer normalement.
require("./lib/env").chargerEnv();

const express = require("express");
const cors = require("cors");
const { creerMiddlewareAuth } = require("./middleware/auth");

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));

const requireAuth = creerMiddlewareAuth();
app.use("/api", requireAuth);

// Retourne l'utilisateur authentifié courant (id, email, role, actif) — utile
// au frontend juste après connexion, pour adapter l'interface selon le rôle.
app.get("/api/me", (req, res) => res.json(req.user));

app.use("/api/listes", require("./routes/listes"));
app.use("/api/etapes", require("./routes/etapes"));
app.use("/api/declinaisons", require("./routes/declinaisons"));
app.use("/api/articles", require("./routes/articles"));
app.use("/api/planning", require("./routes/planning"));
app.use("/api/commandes", require("./routes/commandes"));
app.use("/api/bc-pf", require("./routes/bcPf"));

app.use((err, req, res, next) => {
  console.error("Erreur non gérée :", err.message);
  res.status(500).json({ error: "Erreur serveur." });
});

const PORT = process.env.PORT || 3001;
if (require.main === module) {
  const { diagnostiquerEnv } = require("./lib/env");
  const presence = diagnostiquerEnv(["DATABASE_URL", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]);
  console.log("Variables d'environnement détectées (présence uniquement, jamais la valeur) :", presence);
  app.listen(PORT, () => console.log(`API démarrée sur le port ${PORT}`));
}

module.exports = app;
