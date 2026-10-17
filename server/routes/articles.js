// Photo upload (ajouterPhoto) volontairement absente ici — bloquee tant que
// Cloudflare R2 n'est pas configure, voir shared/articles.js.

const express = require("express");
const articles = require("../../shared/articles");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try { res.json(await articles.list(getAdapter(), { includeIncomplete: req.query.includeIncomplete !== "false" })); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.get("/:id", async (req, res) => {
  try {
    const a = await articles.get(getAdapter(), Number(req.params.id));
    if (!a) return res.status(404).json({ error: "Article introuvable." });
    res.json(a);
  } catch (err) { res.status(400).json({ error: err.message }); }
});
router.post("/", async (req, res) => {
  try { res.status(201).json(await articles.create(getAdapter(), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/:id/reference", async (req, res) => {
  try { res.json(await articles.completerReference(getAdapter(), Number(req.params.id), req.body)); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.patch("/photos/:photoId/principale", async (req, res) => {
  try { res.json(await articles.definirPhotoPrincipale(getAdapter(), Number(req.params.photoId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});
router.delete("/photos/:photoId", async (req, res) => {
  try { res.json(await articles.retirerPhoto(getAdapter(), Number(req.params.photoId))); }
  catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
