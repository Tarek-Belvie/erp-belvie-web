#!/usr/bin/env node
// Génère, à partir du registre des routes (source unique) :
//   * apps/web/src/api/routes.generated.ts — la table utilisée par le client du navigateur ;
//   * docs/api.md                         — la référence de l'API.
// À relancer après toute modification de src/routes/registre.js : `npm run generer`.
// Le contrôle `npm run generer -- --verifier` (lancé par la CI) échoue si les fichiers ne sont pas à jour.
const fs = require("fs");
const path = require("path");
const registre = require("../src/routes/registre");

const SPECIALES = [
  // [espace, methode, verbe, params, description]
  ["fichiers", "(envoi)", "POST", ["fichier (multipart)"], "Envoi d'une image ; renvoie { filePath: jeton, fileName, sizeBytes, dataUrl }. Le jeton se passe ensuite à ajouterPhoto / setLogo / addCroquis / setAccessoirePhoto."],
  ["bcPf", "telechargerPdf", "GET", ["id", "suggestedName"], "PDF du bon de commande (téléchargement)."],
  ["ficheTechnique", "telechargerPdf", "GET", ["ficheId", "suggestedName"], "PDF de la fiche technique (téléchargement)."],
  ["bcPf", "lancer", "POST", ["id"], "Lance le BC, puis passe la commande en production si elle est « validée »."],
  ["system", "exportFile", "GET", ["format"], "Export des commandes (csv | xlsx), téléchargement."],
  ["system", "backup", "POST", ["options"], "Sauvegarde complète sur le serveur (admin)."],
  ["system", "backupAvantOperation", "POST", ["motif"], "Sauvegarde avant opération (admin)."],
  ["system", "listerSauvegardes", "GET", [], "Liste des sauvegardes (admin)."],
  ["system", "verifierSauvegarde", "GET", ["dossier"], "Vérifie une sauvegarde (admin)."],
  ["system", "telechargerSauvegarde", "GET", ["nom", "fichier"], "Télécharge un fichier de sauvegarde (admin)."],
  ["system", "loadDemoData", "POST", [], "Charge les données de démonstration (admin)."],
  ["system", "clearDemoData", "POST", [], "Retire les données de démonstration (admin)."],
  ["system", "version", "GET", [], "Version de l'API."],
];

const racine = path.resolve(__dirname, "../../..");
const ts = [
  "// FICHIER GÉNÉRÉ par apps/api/scripts/generer.js à partir de apps/api/src/routes/registre.js.",
  "// Ne pas modifier à la main.",
  "",
  "export interface RouteApi { espace: string; methode: string; lecture: boolean; params: string[] }",
  "",
  "export const ROUTES: RouteApi[] = [",
  ...registre.map((r) => `  { espace: ${JSON.stringify(r.espace)}, methode: ${JSON.stringify(r.methode)}, lecture: ${r.lecture}, params: ${JSON.stringify(r.params)} },`),
  "];",
  "",
].join("\n");

const md = [
  "# Référence de l'API Belvie ERP",
  "",
  "> Document **généré** par `apps/api/scripts/generer.js` à partir du registre `apps/api/src/routes/registre.js`. Ne pas modifier à la main.",
  "",
  "## Convention (identique pour toutes les routes)",
  "",
  "| | Lecture | Écriture |",
  "|---|---|---|",
  "| Verbe | `GET /api/<espace>/<methode>` | `POST /api/<espace>/<methode>` |",
  "| Paramètres | query string, chaque valeur encodée en JSON : `?id=12&options=%7B%7D` | corps JSON : `{ \"id\": 12, \"payload\": { … } }` |",
  "| Base | connexion en lecture seule (aucune écriture possible) | connexion normale |",
  "",
  "- Réponse : `200 { \"resultat\": … }` ; règle métier refusée : `400 { \"erreur\": \"message\" }` ; non connecté : `401` ; réservé admin : `403` ; erreur technique : `500`.",
  "- Authentification : cookie de session `belvie_session` (HttpOnly) posé par `POST /api/auth/connexion { email, motDePasse }`.",
  "- Toute requête non-GET doit porter l'en-tête `X-Belvie: 1` (protection CSRF).",
  "- `espace.methode` = exactement `window.api.<espace>.<methode>` côté interface.",
  "",
  "## Authentification",
  "",
  "| Verbe | Chemin | Corps / paramètres |",
  "|---|---|---|",
  "| POST | `/api/auth/connexion` | `email`, `motDePasse` |",
  "| POST | `/api/auth/deconnexion` | — |",
  "| GET | `/api/auth/moi` | — |",
  "| GET | `/api/sante` | — (sans authentification) |",
  "",
  "## Routes spéciales (fichiers, PDF, export, sauvegardes)",
  "",
  "| Verbe | Chemin | Paramètres | Rôle |",
  "|---|---|---|---|",
  ...SPECIALES.map(([e, m, v, p, d]) => `| ${v} | \`/api/${e === "fichiers" ? "fichiers" : e + "/" + m}\` | ${p.map((x) => "`" + x + "`").join(", ") || "—"} | ${d} |`),
  "| GET | `/media/<chemin>` | — | Fichier image enregistré (photos, logo, croquis). |",
  "",
  `## Routes métier (${registre.length})`,
  "",
];
const espaces = [...new Set(registre.map((r) => r.espace))];
for (const e of espaces) {
  md.push(`### ${e}`, "", "| Verbe | Chemin | Paramètres | Fonction appelée |", "|---|---|---|---|");
  for (const r of registre.filter((x) => x.espace === e)) {
    const fn = /=>\s*([a-zA-Z]+\.[a-zA-Z]+)\(/.exec(r.appel.toString());
    md.push(`| ${r.lecture ? "GET" : "POST"} | \`/api/${e}/${r.methode}\` | ${r.params.map((x) => "`" + x + "`").join(", ") || "—"} | \`modules/${fn ? fn[1] : "?"}\` |`);
  }
  md.push("");
}

const cibles = [[path.join(racine, "apps/web/src/api/routes.generated.ts"), ts], [path.join(racine, "docs/api.md"), md.join("\n")]];
if (process.argv.includes("--verifier")) {
  const perimes = cibles.filter(([f, c]) => !fs.existsSync(f) || fs.readFileSync(f, "utf8") !== c).map(([f]) => path.relative(racine, f));
  if (perimes.length) { console.error("Fichiers générés pas à jour : " + perimes.join(", ") + " → lancer `npm run generer --workspace apps/api`."); process.exit(1); }
  console.log("Fichiers générés à jour.");
} else {
  for (const [f, c] of cibles) fs.writeFileSync(f, c);
  console.log(`Généré : ${registre.length} routes → routes.generated.ts, docs/api.md`);
}
