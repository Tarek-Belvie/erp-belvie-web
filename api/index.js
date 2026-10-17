// ============================================================================
// POINT D'ENTRÉE SERVERLESS VERCEL.
//
// Vercel traite automatiquement tout fichier sous /api/ comme une fonction
// serverless. Ce fichier ne fait que réexporter l'app Express déjà construite
// dans server/index.js — AUCUNE logique dupliquée, aucun comportement
// différent entre l'exécution locale (node server/index.js) et Vercel.
//
// server/index.js exporte déjà `app` (module.exports = app) et ne démarre
// app.listen() que si exécuté directement (if (require.main === module)) —
// ici, il est seulement importé, jamais exécuté directement : aucun conflit
// avec le modèle serverless de Vercel (pas de port à écouter).
// ============================================================================

module.exports = require("../server/index.js");
