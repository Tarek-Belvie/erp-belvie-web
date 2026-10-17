const express = require("express");
const bcPf = require("../../shared/bcPf");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/commande/:commandeId", async (req, res) => {
  try { res.json(await bcPf.getByCommandeId(getAdapter(), Number(req.params.commandeId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/commande/:commandeId", async (req, res) => {
  try { res.status(201).json(await bcPf.creerBcPf(getAdapter(), Number(req.params.commandeId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/commande/:commandeId/historique", async (req, res) => {
  try { res.json(await bcPf.listForCommande(getAdapter(), Number(req.params.commandeId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/:id", async (req, res) => {
  try {
    const bc = await bcPf.get(getAdapter(), Number(req.params.id));
    if (!bc) return res.status(404).json({ error: "Bon de commande introuvable." });
    res.json(bc);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/:id", async (req, res) => {
  try { res.json(await bcPf.updateBrouillonDoc(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/synchroniser", async (req, res) => {
  try { res.json(await bcPf.mettreAJourDepuisCommande(getAdapter(), Number(req.params.id))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/valider", async (req, res) => {
  try { res.json(await bcPf.validerBcPf(getAdapter(), Number(req.params.id))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/lancer", async (req, res) => {
  try { res.json(await bcPf.lancerBcPf(getAdapter(), Number(req.params.id))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/remplacer", async (req, res) => {
  try { res.status(201).json(await bcPf.remplacerBcPf(getAdapter(), Number(req.params.id), req.body.motif)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
