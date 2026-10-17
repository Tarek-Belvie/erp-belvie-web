// ============================================================================
// ADAPTATEUR DE BASE DE DONNÉES — Phase 1.
//
// Expose UNE interface unique ({ get, all, run }, toutes async) à la logique
// métier partagée (shared/*.js), pour qu'elle ne contienne jamais de
// condition "si SQLite / si PostgreSQL". La logique métier écrit son SQL
// avec des paramètres positionnels "?" (convention déjà utilisée dans tout
// electron/ipc/*.js) ; c'est CET adaptateur, et lui seul, qui sait traduire
// "?" en "$1, $2..." pour PostgreSQL.
//
// Deux implémentations concrètes :
//   - createSqliteAdapter(db)   : enveloppe better-sqlite3 (synchrone) dans
//     des Promises résolues immédiatement — ne change rien au comportement
//     réel d'Electron, juste la forme de l'interface.
//   - createPostgresAdapter(pool) : utilise le module "pg", nativement
//     asynchrone.
// ============================================================================

function creerAdaptateurSqlite(db) {
  return {
    moteur: "sqlite",
    async get(sql, params = []) {
      return db.prepare(sql).get(...params);
    },
    async all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
    async run(sql, params = []) {
      const info = db.prepare(sql).run(...params);
      return { lastInsertRowid: info.lastInsertRowid, changes: info.changes };
    },
    // Transaction portable via BEGIN/COMMIT/ROLLBACK explicites — jamais le sucre syntaxique
    // db.transaction() de better-sqlite3, qui exige un callback SYNCHRONE et serait donc
    // incompatible avec la logique métier partagée (toujours async, pour fonctionner aussi
    // avec PostgreSQL). fn reçoit CE MÊME adaptateur — une seule connexion, pas de risque de
    // mélange entre transaction et hors-transaction.
    async transaction(fn) {
      db.exec("BEGIN");
      try {
        const resultat = await fn(this);
        db.exec("COMMIT");
        return resultat;
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
    },
  };
}

// Traduit "?" positionnels en "$1, $2, ..." pour le driver "pg" — seule
// traduction nécessaire, le reste du SQL (SELECT/WHERE/ORDER BY...) est du
// SQL standard commun aux deux moteurs dans le périmètre de shared/listes.js.
function traduireParamsPositionnels(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

// Par défaut, le driver "pg" renvoie les colonnes BIGINT (type des résultats de COUNT(*), OID 20)
// sous forme de CHAÎNE DE CARACTÈRES plutôt que de nombre — pour éviter une perte de précision
// sur des valeurs dépassant l'entier sûr JavaScript (2^53). Confirmé avec du code réel :
// COUNT(*) renvoyait "0" (string) côté PostgreSQL contre 0 (number) côté SQLite/better-sqlite3,
// une divergence de TYPE, pas de valeur. Sans risque réaliste de dépassement dans cette
// application (aucun COUNT/SUM n'approchera jamais 2^53 lignes), on force le parsing en nombre —
// correction unique ici, valable pour toutes les requêtes, pas seulement celle où c'est apparu.
function configurerParsingBigint(pgModule) {
  pgModule.types.setTypeParser(20, (val) => (val === null ? null : parseInt(val, 10)));
}

function creerAdaptateurPostgres(pool, pgModule) {
  // pgModule est INJECTÉ par l'appelant (jamais require("pg") ici) : "pg" est une dépendance
  // installée dans server/node_modules, jamais à la racine ni dans shared/. Node résout require()
  // en remontant depuis l'emplacement du FICHIER APPELANT, jamais depuis un dossier frère — un
  // require("pg") ici échouerait donc systématiquement quand ce fichier est appelé depuis
  // server/lib/db.js ou les scripts de test (confirmé par une reproduction réelle avant cette
  // correction). L'appelant a de toute façon déjà besoin de "pg" pour construire son Pool — le lui
  // faire passer évite toute duplication d'installation et garde shared/ totalement indépendant
  // de "pg" (l'usage SQLite/Electron n'a jamais besoin de cette dépendance).
  if (!pgModule) {
    throw new Error(
      "creerAdaptateurPostgres(pool, pgModule) : pgModule manquant. L'appelant doit passer require(\"pg\") explicitement."
    );
  }
  configurerParsingBigint(pgModule);

  return {
    moteur: "postgres",
    async get(sql, params = []) {
      const res = await pool.query(traduireParamsPositionnels(sql), params);
      return res.rows[0] || undefined; // même convention que better-sqlite3 : undefined si rien trouvé
    },
    async all(sql, params = []) {
      const res = await pool.query(traduireParamsPositionnels(sql), params);
      return res.rows;
    },
    async run(sql, params = []) {
      // RETURNING id nécessaire côté appelant pour récupérer lastInsertRowid — voir shared/listes.js.
      const res = await pool.query(traduireParamsPositionnels(sql), params);
      return { lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount };
    },
    // Un client DÉDIÉ du pool pour toute la durée de la transaction — pool.query() seul
    // pourrait utiliser une connexion différente à chaque appel, cassant l'atomicité.
    async transaction(fn) {
      const client = await pool.connect();
      const adaptateurClient = {
        moteur: "postgres",
        async get(sql, params = []) {
          const res = await client.query(traduireParamsPositionnels(sql), params);
          return res.rows[0] || undefined;
        },
        async all(sql, params = []) {
          const res = await client.query(traduireParamsPositionnels(sql), params);
          return res.rows;
        },
        async run(sql, params = []) {
          const res = await client.query(traduireParamsPositionnels(sql), params);
          return { lastInsertRowid: res.rows[0] ? res.rows[0].id : undefined, changes: res.rowCount };
        },
      };
      try {
        await client.query("BEGIN");
        const resultat = await fn(adaptateurClient);
        await client.query("COMMIT");
        return resultat;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

module.exports = { creerAdaptateurSqlite, creerAdaptateurPostgres };
