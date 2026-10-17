const express = require("express");
const listes = require("../../shared/listes");
const { getAdapter } = require("../lib/db");

const router = express.Router();

router.get("/:type", async (req, res) => {
  try {
    const rows = await listes.list(getAdapter(), req.params.type, { includeInactive: req.query.includeInactive === "true" });
    res.json(rows);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.post("/:type", async (req, res) => {
  try {
    const row = await listes.create(getAdapter(), req.params.type, req.body.nom, req.body);
    res.status(201).json(row);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

router.patch("/:id", async (req, res) => {
  try {
    const row = await listes.update(getAdapter(), Number(req.params.id), req.body);
    res.json(row);
  } catch (err) { res.status(400).json({ error: err.message }); }
});

module.exports = router;
