// ================================================================================================
// Montage des routes du registre (voir registre.js pour la convention).
// ================================================================================================
const express = require("express");
const registre = require("./registre");
const { resoudreTeleversement, libererCopieLocale } = require("../lib/plateforme");

// Paramètres qui désignent un fichier envoyé au préalable par POST /api/fichiers : le navigateur
// transmet l'identifiant de téléversement, la fonction métier reçoit le chemin réel sur le serveur.
const PARAMS_FICHIER = new Set(["sourcePath"]);

function lireParametre(valeur) {
  if (valeur === undefined) return undefined;
  try { return JSON.parse(valeur); } catch (_) { throw new ErreurRequete("Paramètre mal formé : JSON attendu."); }
}

class ErreurRequete extends Error {}

function monterRegistre({ db }) {
  const router = express.Router();
  const { CHEMINS_SPECIAUX } = require("./speciales");
  const vus = new Set();
  for (const r of registre) {
    const chemin = `/${r.espace}/${r.methode}`;
    // Garde-fou : une route en double (ou qui masquerait une route spéciale protégée) arrête le démarrage.
    if (vus.has(chemin) || CHEMINS_SPECIAUX.has(chemin)) throw new Error(`Route déclarée deux fois : ${chemin} (registre.js / speciales.js)`);
    vus.add(chemin);
    const gestionnaire = async (req, res, next) => {
      try {
        const source = r.lecture ? req.query : (req.body || {});
        const args = [];
        const copiesLocales = [];
        try {
          for (const p of r.params) {
            const v = r.lecture ? lireParametre(source[p]) : source[p];
            if (PARAMS_FICHIER.has(p) && typeof v === "string") {
              const local = await resoudreTeleversement(v);
              copiesLocales.push(local);
              args.push(local);
            } else args.push(v);
          }
          const resultat = r.lecture ? await db.lectureSeule(() => r.appel(db, ...args)) : await r.appel(db, ...args);
          res.json({ resultat });
        } finally {
          // Mode R2 : la copie temporaire du fichier envoyé n'a plus d'usage (le module l'a rangé).
          for (const c of copiesLocales) libererCopieLocale(c);
        }
      } catch (err) { next(err); }
    };
    if (r.lecture) router.get(chemin, gestionnaire); else router.post(chemin, gestionnaire);
  }
  return router;
}

module.exports = { monterRegistre, ErreurRequete, lireParametre };
