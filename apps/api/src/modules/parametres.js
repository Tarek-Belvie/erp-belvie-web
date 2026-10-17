async function get(db, cle) {
  const row = await db.prepare("SELECT valeur FROM parametres WHERE cle = ?").get(cle);
  return row ? row.valeur : null;
}

async function set(db, cle, valeur) {
  await db.prepare("INSERT INTO parametres (cle, valeur) VALUES (?, ?) ON CONFLICT(cle) DO UPDATE SET valeur = excluded.valeur").run(cle, valeur);
  return await get(db, cle);
}

async function getOperateurActif(db) {
  const id = await get(db, "operateur_actif_id");
  if (!id) return null;
  return (await db.prepare("SELECT * FROM listes_valeurs WHERE id = ? AND type = 'operateur' AND actif = 1").get(Number(id))) || null;
}

async function setOperateurActif(db, operateurId) {
  if (operateurId === null || operateurId === undefined) {
    await db.prepare("DELETE FROM parametres WHERE cle = 'operateur_actif_id'").run();
    return null;
  }
  const op = await db.prepare("SELECT * FROM listes_valeurs WHERE id = ? AND type = 'operateur'").get(Number(operateurId));
  if (!op) throw new Error("Opérateur introuvable.");
  if (!op.actif) throw new Error("Cet opérateur est désactivé : réactivez-le avant de le sélectionner.");
  await set(db, "operateur_actif_id", String(op.id));
  return op;
}

module.exports = { get: get, set: set, getOperateurActif: getOperateurActif, setOperateurActif: setOperateurActif };
