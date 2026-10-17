const express = require("express");
const etapes = require("../../shared/etapes");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    res.json(await etapes.list(getAdapter(), { includeInactive: req.query.includeInactive === "true" }));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post("/", async (req, res) => {
  try {
    res.status(201).json(await etapes.create(getAdapter(), req.body));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch("/:id", async (req, res) => {
  try {
    res.json(await etapes.update(getAdapter(), Number(req.params.id), req.body));
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
