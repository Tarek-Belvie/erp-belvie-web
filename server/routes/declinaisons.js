const express = require("express");
const declinaisons = require("../../shared/declinaisons");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/types", async (req, res) => {
  try { res.json(await declinaisons.listTypes(getAdapter(), { includeInactive: req.query.includeInactive === "true" })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/types", async (req, res) => {
  try { res.status(201).json(await declinaisons.createType(getAdapter(), req.body.nom, req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/types/:id", async (req, res) => {
  try { res.json(await declinaisons.updateType(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/types/reordonner", async (req, res) => {
  try { res.json(await declinaisons.reorderTypes(getAdapter(), req.body.orderedIds)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get("/types/:typeId/valeurs", async (req, res) => {
  try { res.json(await declinaisons.listValeurs(getAdapter(), Number(req.params.typeId), { includeInactive: req.query.includeInactive === "true" })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/types/:typeId/valeurs", async (req, res) => {
  try { res.status(201).json(await declinaisons.createValeur(getAdapter(), Number(req.params.typeId), req.body.valeur, req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/valeurs/:id", async (req, res) => {
  try { res.json(await declinaisons.updateValeur(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/types/:typeId/valeurs/reordonner", async (req, res) => {
  try { res.json(await declinaisons.reorderValeurs(getAdapter(), Number(req.params.typeId), req.body.orderedIds)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

router.get("/articles/:articleId/types", async (req, res) => {
  try { res.json(await declinaisons.getArticleDeclinaisonTypes(getAdapter(), Number(req.params.articleId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.put("/articles/:articleId/types", async (req, res) => {
  try { res.json(await declinaisons.setArticleDeclinaisonTypes(getAdapter(), Number(req.params.articleId), req.body.typeIds)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/articles/:articleId/valeurs", async (req, res) => {
  try { res.json(await declinaisons.getArticleDeclinaisonValeurs(getAdapter(), Number(req.params.articleId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/articles/:articleId/previsualiser-impact", async (req, res) => {
  try { res.json(await declinaisons.previsualiserImpact(getAdapter(), Number(req.params.articleId), req.body.selections)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/articles/:articleId/appliquer-configuration", async (req, res) => {
  try { res.json(await declinaisons.appliquerConfiguration(getAdapter(), Number(req.params.articleId), req.body.typeIds, req.body.selections)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/articles/:articleId/variantes", async (req, res) => {
  try { res.json(await declinaisons.listVariantes(getAdapter(), Number(req.params.articleId), { includeInactive: req.query.includeInactive === "true" })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/articles/:articleId/generer-variantes", async (req, res) => {
  try { res.status(201).json(await declinaisons.genererVariantes(getAdapter(), Number(req.params.articleId), req.body.selections)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/variantes/:id", async (req, res) => {
  try { res.json(await declinaisons.getVariante(getAdapter(), Number(req.params.id))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/variantes/:id", async (req, res) => {
  try { res.json(await declinaisons.updateVariante(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete("/variantes/:id", async (req, res) => {
  try { res.json(await declinaisons.deleteVariante(getAdapter(), Number(req.params.id))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
