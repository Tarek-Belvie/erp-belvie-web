// ================================================================================================
// Application Express — assemblage. Ne contient aucune règle métier.
// ================================================================================================
const express = require("express");
const cookieParser = require("cookie-parser");
const { creerAuth } = require("./auth");
const { monterRegistre } = require("./routes/index");
const { monterSpeciales, routeMedias } = require("./routes/speciales");

function creerApp({ db, dbLecture, config }) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy > 0 ? config.trustProxy : false);
  app.use(express.json({ limit: "5mb" }));
  app.use(cookieParser());

  // Accès direct depuis une autre origine (développement, outils) : uniquement les origines listées.
  app.use((req, res, next) => {
    const origine = req.get("origin");
    if (origine && config.originesAutorisees.includes(origine)) {
      res.setHeader("Access-Control-Allow-Origin", origine);
      res.setHeader("Access-Control-Allow-Credentials", "true");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Belvie");
      res.setHeader("Vary", "Origin");
      if (req.method === "OPTIONS") return res.status(204).end();
    }
    next();
  });

  // Protection CSRF : toute écriture doit porter l'en-tête X-Belvie (qu'un formulaire d'un autre
  // site ne peut pas ajouter) en plus du cookie SameSite=Lax.
  app.use("/api", (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS" && req.get("x-belvie") !== "1") {
      return res.status(403).json({ erreur: "Requête refusée (en-tête X-Belvie manquant)." });
    }
    next();
  });

  app.get("/api/sante", async (_req, res) => {
    try { await db.prepare("SELECT 1 AS ok").get(); res.json({ resultat: { statut: "ok" } }); }
    catch (_) { res.status(503).json({ erreur: "Base de données injoignable." }); }
  });

  const auth = creerAuth({ db, config });
  app.post("/api/auth/connexion", auth.connexion);
  app.post("/api/auth/deconnexion", auth.deconnexion);
  app.use("/api", auth.exigerSession);
  app.get("/api/auth/moi", (req, res) => res.json({ resultat: req.utilisateur }));

  app.use("/media", auth.exigerSession, routeMedias());
  app.use("/api", monterSpeciales({ db, dbLecture, exigerAdmin: auth.exigerAdmin }));
  app.use("/api", monterRegistre({ db, dbLecture }));
  app.use("/api", (_req, res) => res.status(404).json({ erreur: "Route inconnue." }));

  // Erreurs : une règle métier (Error levée par un module) → 400 avec son message, tel que
  // l'affichait l'application Electron. Une erreur technique (PostgreSQL, fichier…) → 500, le
  // détail reste dans le journal du serveur.
  app.use((err, req, res, _next) => {
    if (err && err.name === "MulterError") {
      const msg = err.code === "LIMIT_FILE_SIZE" ? "Le fichier dépasse la taille maximale autorisée (10 Mo)." : "Envoi de fichier refusé.";
      return res.status(400).json({ erreur: msg });
    }
    const technique = !!(err && (err.code || err.severity || err instanceof TypeError || err instanceof ReferenceError));
    if (technique || !(err instanceof Error)) {
      console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl} —`, err, err && err.sql ? `\n  SQL : ${err.sql}` : "");
      return res.status(500).json({ erreur: "Erreur technique sur le serveur. Elle a été enregistrée dans le journal." });
    }
    if (err.message && /Unexpected token|JSON/.test(err.message) && err.type === "entity.parse.failed") return res.status(400).json({ erreur: "Corps de requête invalide." });
    res.status(400).json({ erreur: err.message });
  });
  return app;
}

module.exports = { creerApp };
