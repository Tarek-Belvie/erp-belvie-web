// Outils communs aux scénarios différentiels (node:test).
const assert = require("node:assert/strict");
// La configuration (DATABASE_URL…) doit être chargée AVANT le harnais, qui la lit au chargement.
require("../../src/config").chargerConfiguration();
const { creerMondes } = require("./harnais");

// Lance un scénario sur deux mondes neufs et échoue s'il reste le moindre écart.
async function scenario(t, nom, corps) {
  const mondes = await creerMondes({ nom });
  try {
    await corps(mondes);
  } finally {
    const ecarts = mondes.journal.filter((e) => e.ecart);
    await mondes.fermer();
    if (ecarts.length) {
      const detail = ecarts.slice(0, 15).map((e) => `• ${e.canal} ${JSON.stringify(e.args).slice(0, 150)}\n    ${e.ecart.slice(0, 6).join("\n    ")}${e.pile ? "\n    " + e.pile.split("\n").slice(0, 4).join("\n    ") : ""}`).join("\n");
      assert.fail(`${ecarts.length} écart(s) ancien/nouveau sur ${mondes.journal.length} appels :\n${detail}`);
    }
  }
}

module.exports = { scenario };
