// ================================================================================================
// ACCÈS À LA BASE POSTGRESQL — point unique.
//
// Le code métier (src/modules/*.js) a été écrit pour better-sqlite3. Plutôt que de le réécrire
// entièrement, cette couche offre la MÊME FORME d'appel, mais asynchrone :
//
//     const ligne  = await db.prepare("SELECT * FROM articles WHERE id = ?").get(id);
//     const lignes = await db.prepare("SELECT ...").all(a, b);
//     const info   = await db.prepare("INSERT INTO ...").run(x);   // info.lastInsertRowid, info.changes
//     const tx     = db.transaction(async (arg) => { ... });         // await tx(arg)
//
// Ce qu'elle fait, et rien d'autre :
//   1. traduit les paramètres « ? » et nommés (« @nom », « :nom », « $nom ») en « $1, $2… » ;
//   2. ajoute « RETURNING id » aux INSERT des tables qui ont une colonne id, pour fournir
//      lastInsertRowid comme better-sqlite3 ;
//   3. fait passer TOUTES les requêtes d'une transaction par la même connexion, y compris celles
//      écrites avec la variable `db` capturée dans une fermeture (AsyncLocalStorage) ;
//   4. gère les transactions imbriquées par SAVEPOINT (comme better-sqlite3).
//
// Règle : aucun module métier n'importe « pg » directement. Tout passe par ici.
// ================================================================================================

const { AsyncLocalStorage } = require("async_hooks");
const pg = require("pg");

// BIGINT (COUNT, SUM d'entiers, identifiants) → nombre JS, comme SQLite.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// NUMERIC (AVG, ROUND(x, n)…) → nombre JS, comme SQLite.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));

const contexteTransaction = new AsyncLocalStorage();

// ------------------------------------------------------------------------------------------------
// Traduction des paramètres. On ignore les « ? » / « @x » situés dans une chaîne SQL ('…'),
// un identifiant entre guillemets ("…") ou un commentaire.
// ------------------------------------------------------------------------------------------------
function erreurSql(message, sql) {
  const e = new Error(message);
  e.code = "BELVIE_SQL"; // erreur technique : 500, détail dans le journal uniquement
  e.sql = sql;
  return e;
}

function traduireSql(sql, args) {
  // Constructions que cette traduction ne sait pas traiter sans risque : on refuse plutôt que de
  // produire un SQL silencieusement faux (chaînes E'…', dollar-quoting, opérateurs JSON ?| ?&).
  if (/\$\$|\bE'|\?[|&]/.test(sql)) throw erreurSql("Construction SQL non prise en charge par src/db (E'…', $$…$$, ?| ou ?&).", sql);
  const nomme = args.length === 1 && args[0] !== null && typeof args[0] === "object"
    && !Array.isArray(args[0]) && !(args[0] instanceof Date) && !Buffer.isBuffer(args[0]);
  const valeurs = [];
  const indexParNom = new Map();
  let positionnel = 0;
  let out = "";
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; }
        j++;
      }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    if (c === "-" && sql[i + 1] === "-") {
      const j = sql.indexOf("\n", i); const fin = j === -1 ? n : j;
      out += sql.slice(i, fin); i = fin; continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      const j = sql.indexOf("*/", i + 2); const fin = j === -1 ? n : j + 2;
      out += sql.slice(i, fin); i = fin; continue;
    }
    if (c === "?") {
      if (nomme) throw erreurSql("Requête mélangeant « ? » et paramètres nommés.", sql);
      valeurs.push(normaliserValeur(args[positionnel++]));
      out += "$" + valeurs.length; i++; continue;
    }
    if ((c === "@" || c === ":" || c === "$") && /[A-Za-z_]/.test(sql[i + 1] || "") && !(c === ":" && sql[i - 1] === ":")) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_]/.test(sql[j])) j++;
      const nom = sql.slice(i + 1, j);
      if (nomme) {
        if (!(nom in args[0])) throw new Error(`Missing named parameter "${nom}"`); // message identique à better-sqlite3
        if (!indexParNom.has(nom)) { valeurs.push(normaliserValeur(args[0][nom])); indexParNom.set(nom, valeurs.length); }
        out += "$" + indexParNom.get(nom); i = j; continue;
      }
    }
    out += c; i++;
  }
  if (!nomme && positionnel !== args.length) {
    throw erreurSql(`Nombre de paramètres incorrect (${args.length} fournis, ${positionnel} attendus).`, sql);
  }
  return { texte: out, valeurs };
}

// ------------------------------------------------------------------------------------------------
// Tri des NULL : SQLite considère NULL comme la plus petite valeur (en tête en ASC, en fin en
// DESC) ; PostgreSQL fait l'inverse par défaut. Tout le code métier a été écrit et vérifié avec
// le comportement SQLite : on l'impose donc explicitement à chaque terme d'ORDER BY qui n'en
// précise pas (ORDER BY de requête, de sous-requête ou de fonction de fenêtre).
// ------------------------------------------------------------------------------------------------
const cacheTri = new Map();
function trierNullsCommeSqlite(sql) {
  if (!/\border\s+by\b/i.test(sql)) return sql;
  const enCache = cacheTri.get(sql);
  if (enCache !== undefined) return enCache;
  let out = "";
  let i = 0;
  const n = sql.length;
  const re = /\bORDER\s+BY\b/iy;
  while (i < n) {
    const c = sql[i];
    if (c === "'" || c === '"') { // chaînes et identifiants : recopiés tels quels
      let j = i + 1;
      while (j < n) { if (sql[j] === c) { if (sql[j + 1] === c) { j += 2; continue; } break; } j++; }
      out += sql.slice(i, j + 1); i = j + 1; continue;
    }
    re.lastIndex = i;
    if ((i === 0 || !/[A-Za-z0-9_]/.test(sql[i - 1])) && re.test(sql)) {
      out += sql.slice(i, re.lastIndex); i = re.lastIndex;
      // Lecture des termes jusqu'à la fin de la clause (parenthèse fermante du niveau, LIMIT…).
      let profondeur = 0; let terme = ""; const termes = [];
      while (i < n) {
        const d = sql[i];
        if (d === "'" || d === '"') {
          let j = i + 1;
          while (j < n) { if (sql[j] === d) { if (sql[j + 1] === d) { j += 2; continue; } break; } j++; }
          terme += sql.slice(i, j + 1); i = j + 1; continue;
        }
        if (d === "(") profondeur++;
        if (d === ")") { if (profondeur === 0) break; profondeur--; }
        if (profondeur === 0) {
          if (d === ",") { termes.push(terme); terme = ""; i++; continue; }
          if (d === ";") break;
          if (d === "-" && sql[i + 1] === "-") break; // commentaire : fin de la clause
          const reste = sql.slice(i);
          if (/^\s(LIMIT|OFFSET|FETCH|FOR|UNION|EXCEPT|INTERSECT|ROWS|RANGE|GROUPS)\b/i.test(reste)) break;
        }
        terme += d; i++;
      }
      termes.push(terme);
      out += termes.map((t) => {
        if (/\bNULLS\s+(FIRST|LAST)\b/i.test(t)) return t;
        const fin = /\s*$/.exec(t)[0];
        const corps = t.slice(0, t.length - fin.length);
        return corps + (/\bDESC$/i.test(corps) ? " NULLS LAST" : " NULLS FIRST") + fin;
      }).join(",");
      continue;
    }
    out += c; i++;
  }
  if (cacheTri.size < 5000) cacheTri.set(sql, out);
  return out;
}

// better-sqlite3 refuse `undefined` ; on garde la même rigueur pour ne pas masquer un oubli.
function normaliserValeur(v) {
  if (v === undefined) throw new Error("Valeur undefined passée à une requête SQL.");
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

// ------------------------------------------------------------------------------------------------
// RETURNING id automatique sur les INSERT.
// ------------------------------------------------------------------------------------------------
let tablesAvecId = null; // Set des tables possédant une colonne « id », chargé une fois.

function ajouterReturning(texte) {
  if (!/^\s*INSERT\s/i.test(texte) || /\bRETURNING\b/i.test(texte)) return texte;
  const m = /^\s*INSERT\s+INTO\s+"?([A-Za-z0-9_]+)"?/i.exec(texte);
  if (!m || !tablesAvecId || !tablesAvecId.has(m[1].toLowerCase())) return texte;
  return texte.replace(/;\s*$/, "") + "\nRETURNING id";
}

async function chargerTablesAvecId(executant) {
  const r = await executant.query(
    "SELECT table_name FROM information_schema.columns WHERE table_schema = current_schema() AND column_name = 'id'"
  );
  tablesAvecId = new Set(r.rows.map((x) => x.table_name));
}

// ------------------------------------------------------------------------------------------------
// Base
// ------------------------------------------------------------------------------------------------
function creerBase({ connectionString, options, pool: poolExistant, journal = null } = {}) {
  const pool = poolExistant || new pg.Pool({ connectionString, options, max: Number(process.env.PG_POOL_MAX || 10) });
  // Une connexion inactive coupée par le serveur (redémarrage, bascule Neon, réseau) émet une
  // erreur sur le pool : sans ce gestionnaire, Node arrêterait tout le processus.
  pool.on("error", (err) => console.error(`[${new Date().toISOString()}] Connexion PostgreSQL perdue (pool) :`, err.message));

  function executant() {
    const ctx = contexteTransaction.getStore();
    return ctx && ctx.pool === pool ? ctx.client : pool;
  }

  async function requete(sql, args) {
    const { texte, valeurs } = traduireSql(sql, args);
    const finale = ajouterReturning(trierNullsCommeSqlite(texte));
    const debut = journal ? Date.now() : 0;
    try {
      const res = await executant().query(finale, valeurs);
      if (journal) journal({ sql: finale, duree: Date.now() - debut, lignes: res.rowCount });
      return res;
    } catch (err) {
      // Le SQL reste dans le journal du serveur (err.sql), jamais dans le message renvoyé.
      err.sql = finale;
      if (!err.code) err.code = "BELVIE_SQL";
      throw err;
    }
  }

  function prepare(sql) {
    return {
      source: sql,
      async get(...args) { const r = await requete(sql, args); return r.rows[0]; },
      async all(...args) { const r = await requete(sql, args); return r.rows; },
      async run(...args) {
        const r = await requete(sql, args);
        const id = r.rows && r.rows[0] && r.rows[0].id !== undefined ? r.rows[0].id : undefined;
        return { changes: r.rowCount || 0, lastInsertRowid: id };
      },
    };
  }

  // Comme better-sqlite3 : db.transaction(fn) renvoie une fonction ; l'appeler exécute fn dans une
  // transaction (tout ou rien). Appelée à l'intérieur d'une transaction, elle crée un SAVEPOINT.
  function transaction(fn) {
    return async function executerTransaction(...args) {
      const ctx = contexteTransaction.getStore();
      if (ctx && ctx.pool === pool) {
        const nom = "sp_" + (++ctx.profondeur);
        await ctx.client.query("SAVEPOINT " + nom);
        try {
          const r = await fn.apply(this, args);
          await ctx.client.query("RELEASE SAVEPOINT " + nom);
          return r;
        } catch (err) {
          await ctx.client.query("ROLLBACK TO SAVEPOINT " + nom);
          throw err;
        } finally {
          ctx.profondeur--;
        }
      }
      const client = await pool.connect();
      const surErreur = (err) => console.error(`[${new Date().toISOString()}] Connexion PostgreSQL perdue (transaction) :`, err.message);
      client.on("error", surErreur);
      let connexionCassee = null;
      try {
        await client.query("BEGIN");
        const r = await contexteTransaction.run({ pool, client, profondeur: 0 }, () => fn.apply(this, args));
        await client.query("COMMIT");
        return r;
      } catch (err) {
        try { await client.query("ROLLBACK"); } catch (e) { connexionCassee = e; }
        throw err;
      } finally {
        client.removeListener("error", surErreur);
        // Connexion cassée : détruite au lieu d'être remise dans le pool.
        client.release(connexionCassee || undefined);
      }
    };
  }

  const db = {
    moteur: "postgres",
    pool,
    prepare,
    transaction,
    get: (sql, ...args) => prepare(sql).get(...args),
    all: (sql, ...args) => prepare(sql).all(...args),
    run: (sql, ...args) => prepare(sql).run(...args),
    // SQL brut sans paramètre (plusieurs instructions possibles).
    async exec(sql) { await executant().query(sql); },
    // Remplace « PRAGMA table_info(t) » : liste des colonnes [{ name }] d'une table.
    async colonnes(table) {
      const r = await executant().query(
        "SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = $1 ORDER BY ordinal_position",
        [table]
      );
      return r.rows;
    },
    get enTransaction() { const c = contexteTransaction.getStore(); return !!(c && c.pool === pool); },
    async initialiser() { await chargerTablesAvecId(pool); },
    async fermer() { await pool.end(); },
    pragma() { throw new Error("PRAGMA n'existe pas en PostgreSQL : appel à supprimer du code métier."); },
  };
  return db;
}

module.exports = { creerBase, traduireSql, ajouterReturning, trierNullsCommeSqlite, _setTablesAvecId: (s) => { tablesAvecId = s; } };
