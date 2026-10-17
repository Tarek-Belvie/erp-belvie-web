// ============================================================================
// LOGIQUE PARTAGÉE — génération de référence article.
// Adaptée de electron/db/references.js. genererReferencePrincipale et
// ABREVIATION_REGEX sont du JS pur, inchangés. Seule prochainSequentiel
// (accès DB) est adaptée à l'interface asynchrone commune.
// ============================================================================

function genererReferencePrincipale({ saisonCode, annee, rayonCode, abreviation, sequentiel }) {
  const anneeCourte = String(annee).slice(-2).padStart(2, "0");
  const seq = String(sequentiel).padStart(2, "0");
  return `${saisonCode}${anneeCourte}-${rayonCode}-${abreviation}-${seq}`;
}

async function prochainSequentiel(adapter, { saisonId, annee, rayonId, abreviation }) {
  const row = await adapter.get(
    `SELECT MAX(numero_sequentiel) AS m FROM articles
     WHERE saison_id = ? AND annee_collection = ? AND rayon_id = ? AND abreviation = ?`,
    [saisonId, annee, rayonId, abreviation]
  );
  return ((row && row.m) || 0) + 1;
}

const ABREVIATION_REGEX = /^[A-Z]{2,5}$/;

module.exports = { genererReferencePrincipale, prochainSequentiel, ABREVIATION_REGEX };
