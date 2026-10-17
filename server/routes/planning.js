// Photo upload (ajouterPhoto) volontairement absente ici — bloquee tant que
// Cloudflare R2 n'est pas configure, voir shared/planning.js.

const express = require("express");
const planning = require("../../shared/planning");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const filtres = {
      mois: req.query.mois, categorieId: req.query.categorieId ? Number(req.query.categorieId) : undefined,
      statut: req.query.statut, saisonId: req.query.saisonId ? Number(req.query.saisonId) : undefined,
      anneeCollection: req.query.anneeCollection ? Number(req.query.anneeCollection) : undefined,
      recherche: req.query.recherche,
    };
    res.json(await planning.list(getAdapter(), filtres));
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/kpis", async (req, res) => {
  try { res.json(await planning.kpis(getAdapter())); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/:id", async (req, res) => {
  try {
    const p = await planning.get(getAdapter(), Number(req.params.id));
    if (!p) return res.status(404).json({ error: "Entrée de planification introuvable." });
    res.json(p);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/", async (req, res) => {
  try { res.status(201).json(await planning.creer(getAdapter(), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/:id", async (req, res) => {
  try { res.json(await planning.mettreAJour(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/deplacer", async (req, res) => {
  try { res.json(await planning.deplacer(getAdapter(), Number(req.params.id), req.body.champ, req.body.nouveauMois, req.body.orderedIds, req.body.forcer)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/reordonner", async (req, res) => {
  try { res.json(await planning.reordonner(getAdapter(), req.body.mois, req.body.orderedIds)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete("/:id/photo", async (req, res) => {
  try { res.json(await planning.retirerPhoto(getAdapter(), Number(req.params.id), req.body.forcer)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/retirer", async (req, res) => {
  try { await planning.retirerDuPlanning(getAdapter(), Number(req.params.id)); res.status(204).end(); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete("/:id/provisoire", async (req, res) => {
  try { await planning.supprimerProvisoire(getAdapter(), Number(req.params.id)); res.status(204).end(); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/:id/convertir", async (req, res) => {
  try { res.status(201).json(await planning.convertirEnProduit(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
