const express = require("express");
const commandes = require("../../shared/commandes");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try { res.json(await commandes.list(getAdapter())); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/:id", async (req, res) => {
  try {
    const c = await commandes.get(getAdapter(), Number(req.params.id));
    if (!c) return res.status(404).json({ error: "Commande introuvable." });
    res.json(c);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/", async (req, res) => {
  try { res.status(201).json(await commandes.create(getAdapter(), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/:id", async (req, res) => {
  try { res.json(await commandes.update(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete("/:id", async (req, res) => {
  try { res.json(await commandes.remove(getAdapter(), Number(req.params.id))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

// Transitions de statut — chacune reprend exactement la logique de shared/commandes.js.
const transitions = [
  ["valider", commandes.validerCommande, false],
  ["lancer-production", commandes.lancerProduction, false],
  ["controle-qualite", commandes.entrerEnControleQualite, false],
  ["terminer", commandes.terminerProduction, false],
  ["debloquer", commandes.debloquer, false],
  ["archiver", commandes.archiver, false],
  ["desarchiver", commandes.desarchiver, false],
];
for (const [chemin, fn] of transitions) {
  router.post(`/:id/${chemin}`, async (req, res) => {
    try { res.json(await fn(getAdapter(), Number(req.params.id))); }
    catch (err) { res.status(400).json({ error: err.message }); }
  });
}
// Transitions nécessitant un motif.
router.post("/:id/annuler", async (req, res) => {
  try { res.json(await commandes.annulerCommande(getAdapter(), Number(req.params.id), req.body.motif)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/bloquer", async (req, res) => {
  try { res.json(await commandes.bloquer(getAdapter(), Number(req.params.id), req.body.motif)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
