// ================================================================================================
// Montage des routes du registre (voir registre.js pour la convention).
// ================================================================================================
const express = require("express");
const registre = require("./registre");
const { resoudreTeleversement } = require("../lib/plateforme");

// Paramètres qui désignent un fichier envoyé au préalable par POST /api/fichiers : le navigateur
// transmet l'identifiant de téléversement, la fonction métier reçoit le chemin réel sur le serveur.
const PARAMS_FICHIER = new Set(["sourcePath"]);

function lireParametre(valeur) {
  if (valeur === undefined) return undefined;
  try { return JSON.parse(valeur); } catch (_) { throw new ErreurRequete("Paramètre mal formé : JSON attendu."); }
}

class ErreurRequete extends Error {}

function monterRegistre({ db, dbLecture }) {
  const router = express.Router();
  for (const r of registre) {
    const chemin = `/${r.espace}/${r.methode}`;
    const gestionnaire = async (req, res, next) => {
      try {
        const source = r.lecture ? req.query : (req.body || {});
        const args = r.params.map((p) => {
          const v = r.lecture ? lireParametre(source[p]) : source[p];
          return PARAMS_FICHIER.has(p) && typeof v === "string" ? resoudreTeleversement(v) : v;
        });
        const resultat = await r.appel(r.lecture ? dbLecture : db, ...args);
        res.json({ resultat });
      } catch (err) { next(err); }
    };
    if (r.lecture) router.get(chemin, gestionnaire); else router.post(chemin, gestionnaire);
  }
  return router;
}

module.exports = { monterRegistre, ErreurRequete, lireParametre };
