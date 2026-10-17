// Couche d'accès PostgreSQL : traduction des paramètres, tri des NULL, transactions.
const test = require("node:test");
const assert = require("node:assert/strict");
const { traduireSql, trierNullsCommeSqlite, creerBase } = require("../../src/db");
require("../../src/config").chargerConfiguration();

test("paramètres positionnels « ? » → $n, en ignorant les chaînes et commentaires", () => {
  const r = traduireSql("SELECT '?', \"a?\" FROM t WHERE a = ? AND b = ? -- ?\n", [1, "x"]);
  assert.equal(r.texte, "SELECT '?', \"a?\" FROM t WHERE a = $1 AND b = $2 -- ?\n");
  assert.deepEqual(r.valeurs, [1, "x"]);
});

test("paramètres nommés @x / :x / $x, réutilisables, cast :: préservé", () => {
  const r = traduireSql("UPDATE t SET a = @a, b = :b WHERE id = @id AND c = @a::text", [{ a: 1, b: 2, id: 3 }]);
  assert.equal(r.texte, "UPDATE t SET a = $1, b = $2 WHERE id = $3 AND c = $1::text");
  assert.deepEqual(r.valeurs, [1, 2, 3]);
});

test("refus des erreurs silencieuses : undefined, nombre de paramètres", () => {
  assert.throws(() => traduireSql("SELECT ?", [undefined]), /undefined/);
  assert.throws(() => traduireSql("SELECT ?", [1, 2]), /Nombre de paramètres/);
  assert.throws(() => traduireSql("SELECT @a", [{}]), /Missing named parameter/);
});

test("ORDER BY : NULL triés comme SQLite (en tête en ASC, en fin en DESC)", () => {
  assert.equal(trierNullsCommeSqlite("SELECT * FROM t ORDER BY a, b DESC LIMIT 2"), "SELECT * FROM t ORDER BY a NULLS FIRST, b DESC NULLS LAST LIMIT 2");
  assert.equal(trierNullsCommeSqlite("SELECT 'ORDER BY x' FROM t"), "SELECT 'ORDER BY x' FROM t");
  assert.equal(trierNullsCommeSqlite("SELECT * FROM t ORDER BY a NULLS LAST"), "SELECT * FROM t ORDER BY a NULLS LAST");
});

test("transactions : tout ou rien, savepoints imbriqués, même connexion pour la variable capturée", async () => {
  const db = creerBase({ connectionString: process.env.DATABASE_URL });
  await db.initialiser();
  try {
    await db.exec("CREATE TEMP TABLE IF NOT EXISTS essai_tx (id serial PRIMARY KEY, v int)");
    await db.exec("DROP TABLE IF EXISTS essai_tx_p; CREATE TABLE essai_tx_p (id serial PRIMARY KEY, v int)");
    await db.initialiser(); // recharge la liste des tables à colonne id (RETURNING id automatique)
    const tx = db.transaction(async (v) => {
      await db.prepare("INSERT INTO essai_tx_p (v) VALUES (?)").run(v);
      const interne = db.transaction(async () => { await db.prepare("INSERT INTO essai_tx_p (v) VALUES (?)").run(99); throw new Error("annule"); });
      await assert.rejects(interne(), /annule/);
      return (await db.prepare("SELECT count(*) AS n FROM essai_tx_p").get()).n;
    });
    assert.equal(await tx(1), 1, "le savepoint annulé n'a rien laissé, la transaction voit sa propre écriture");
    const echec = db.transaction(async () => { await db.prepare("INSERT INTO essai_tx_p (v) VALUES (2)").run(); throw new Error("stop"); });
    await assert.rejects(echec(), /stop/);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM essai_tx_p").get()).n, 1, "la transaction échouée est entièrement annulée");
    const info = await db.prepare("INSERT INTO essai_tx_p (v) VALUES (?)").run(5);
    assert.ok(info.lastInsertRowid > 0 && info.changes === 1);
  } finally {
    await db.exec("DROP TABLE IF EXISTS essai_tx_p");
    await db.fermer();
  }
});
