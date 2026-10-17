#!/usr/bin/env node
// ================================================================================================
// OUTIL PONCTUEL — convertit le code métier better-sqlite3 (synchrone) en code asynchrone pour la
// couche apps/api/src/db (même forme d'appel, mais chaque requête renvoie une Promise).
//
//   node tools/codemod/sync-vers-async.js <fichiers…>      (réécrit les fichiers en place)
//
// Transformations :
//   1. <x>.prepare(sql).get|all|run(…)  et  stmt.get|all|run(…) (stmt issu d'un prepare) → await
//   2. db.exec(…) → await ; appels d'une fonction issue de db.transaction(…) → await
//   3. toute fonction qui contient un await devient async ; tout appel à une fonction async
//      (même fichier ou module requis) reçoit un await — jusqu'à stabilité, sur tous les fichiers
//   4. arr.forEach(cb async) → for…of ; arr.map/filter/some/every/find/flatMap/reduce(cb async)
//      → await mapSeq/filterSeq/…(arr, cb) (exécution SÉQUENTIELLE, comme avant)
//   5. ce qui ne peut être converti sans risque est listé dans le rapport « À REVOIR ».
// ================================================================================================
const fs = require("fs");
const path = require("path");
const recast = require("recast");
const babel = require("@babel/parser");
const b = recast.types.builders;
const n = recast.types.namedTypes;

const fichiers = process.argv.slice(2).map((f) => path.resolve(f));
const parser = { parse: (src) => babel.parse(src, { sourceType: "script", allowReturnOutsideFunction: true, tokens: true, plugins: [] }) };
const asts = new Map();
for (const f of fichiers) asts.set(f, recast.parse(fs.readFileSync(f, "utf8"), { parser }));
const aRevoir = [];
const noter = (f, node, msg) => aRevoir.push(`${path.relative(process.cwd(), f)}:${node.loc ? node.loc.start.line : "?"}  ${msg}`);

const DB_NOMS = new Set(["db", "database", "tx", "conn", "base"]);
const METHODES_STMT = new Set(["get", "all", "run"]);
const HELPERS = { map: "mapSeq", filter: "filterSeq", some: "someSeq", every: "everySeq", find: "findSeq", findIndex: "findIndexSeq", flatMap: "flatMapSeq", reduce: "reduceSeq" };

const estFonction = (node) => n.FunctionDeclaration.check(node) || n.FunctionExpression.check(node) || n.ArrowFunctionExpression.check(node) || n.ObjectMethod.check(node) || n.ClassMethod.check(node);
const estPrepare = (node) => n.CallExpression.check(node) && n.MemberExpression.check(node.callee) && !node.callee.computed && node.callee.property.name === "prepare";
const estTransaction = (node) => n.CallExpression.check(node) && n.MemberExpression.check(node.callee) && !node.callee.computed && node.callee.property.name === "transaction" && n.Identifier.check(node.callee.object) && DB_NOMS.has(node.callee.object.name);
function envelopperAwait(p) {
  if (n.AwaitExpression.check(p.parent.node)) return false;
  p.replace(b.awaitExpression(p.node));
  return true;
}
function fonctionEnglobante(p) { let q = p.parent; while (q && !estFonction(q.node)) q = q.parent; return q; }

// ---------------------------------------------------------------- Résolution des requires locaux
function cibleRequire(fichier, node) {
  if (!n.CallExpression.check(node) || !n.Identifier.check(node.callee) || node.callee.name !== "require") return null;
  const a = node.arguments[0]; if (!a || typeof a.value !== "string" || !a.value.startsWith(".")) return null;
  let r = path.resolve(path.dirname(fichier), a.value); if (!r.endsWith(".js")) r += ".js";
  return asts.has(r) ? r : null;
}

// État global : fichier → Set(noms de fonctions exportées async) ; fichier → Set(noms locaux async)
const exportsAsync = new Map(); const locauxAsync = new Map();
fichiers.forEach((f) => { exportsAsync.set(f, new Set()); locauxAsync.set(f, new Set()); });

function passe(fichier, ast) {
  let change = false;
  const stmts = new Set(); const membresStmts = new Set(); const txNoms = new Set();
  const alias = new Map();   // nom local → fichier requis
  const importes = new Map(); // nom local → [fichier, nomExporte]

  recast.visit(ast, {
    visitVariableDeclarator(p) {
      const { id, init } = p.node;
      if (init && n.Identifier.check(id)) {
        if (estPrepare(init)) stmts.add(id.name);
        if (estTransaction(init)) txNoms.add(id.name);
        const r = cibleRequire(fichier, init); if (r) alias.set(id.name, r);
      }
      if (init && n.ObjectPattern.check(id)) {
        const r = cibleRequire(fichier, init);
        if (r) for (const prop of id.properties) if (prop.key && prop.value && n.Identifier.check(prop.value)) importes.set(prop.value.name, [r, prop.key.name]);
      }
      if (init && n.ObjectExpression.check(init)) for (const prop of init.properties) if (prop.value && estPrepare(prop.value) && prop.key) membresStmts.add(prop.key.name);
      this.traverse(p);
    },
    visitAssignmentExpression(p) {
      if (n.Identifier.check(p.node.left) && estPrepare(p.node.right)) stmts.add(p.node.left.name);
      if (n.MemberExpression.check(p.node.left) && !p.node.left.computed && estPrepare(p.node.right)) membresStmts.add(p.node.left.property.name);
      this.traverse(p);
    },
  });

  const estAsyncAppel = (callee) => {
    if (n.Identifier.check(callee)) {
      if (txNoms.has(callee.name)) return true;
      if (locauxAsync.get(fichier).has(callee.name)) return true;
      const imp = importes.get(callee.name); if (imp) return exportsAsync.get(imp[0]).has(imp[1]);
      return false;
    }
    if (n.MemberExpression.check(callee) && !callee.computed) {
      const nom = callee.property.name;
      if (n.Identifier.check(callee.object) && alias.has(callee.object.name)) return exportsAsync.get(alias.get(callee.object.name)).has(nom);
      const r = cibleRequire(fichier, callee.object); if (r) return exportsAsync.get(r).has(nom);
      if (n.Identifier.check(callee.object) && DB_NOMS.has(callee.object.name) && nom === "exec") return true;
    }
    if (estTransaction(callee)) return true;
    return false;
  };

  recast.visit(ast, {
    visitCallExpression(p) {
      this.traverse(p);
      const { callee } = p.node;
      let asynchrone = false;
      if (n.MemberExpression.check(callee) && !callee.computed && METHODES_STMT.has(callee.property.name)) {
        const o = callee.object;
        if (estPrepare(o) || (n.Identifier.check(o) && stmts.has(o.name)) || (n.MemberExpression.check(o) && !o.computed && membresStmts.has(o.property.name))) asynchrone = true;
      }
      if (!asynchrone && estAsyncAppel(callee)) asynchrone = true;
      if (asynchrone && envelopperAwait(p)) change = true;
    },
  });

  // Fonctions contenant un await → async
  recast.visit(ast, {
    visitAwaitExpression(p) {
      const f = fonctionEnglobante(p);
      if (f && !f.node.async) { f.node.async = true; change = true; }
      this.traverse(p);
    },
  });

  // Callbacks async passés aux méthodes de tableau
  let besoinHelpers = false;
  recast.visit(ast, {
    visitCallExpression(p) {
      this.traverse(p);
      const { callee, arguments: args } = p.node;
      if (!n.MemberExpression.check(callee) || callee.computed) return;
      const m = callee.property.name; const cb = args[0];
      if (!cb || !estFonction(cb) || !cb.async) return;
      if (m === "forEach") {
        if (!n.ExpressionStatement.check(p.parent.node) || cb.params.length > 2 || !cb.params.every((x) => n.Identifier.check(x) || n.ObjectPattern.check(x) || n.ArrayPattern.check(x))) {
          noter(fichier, p.node, "forEach avec callback async non convertible automatiquement"); return;
        }
        let corps = n.BlockStatement.check(cb.body) ? cb.body : b.blockStatement([b.expressionStatement(cb.body)]);
        let retourAvecValeur = false;
        recast.visit(corps, {
          visitFunction() { return false; },
          visitReturnStatement(q) { if (q.node.argument) retourAvecValeur = true; q.replace(b.continueStatement()); return false; },
        });
        if (retourAvecValeur) { noter(fichier, p.node, "forEach async : return avec valeur"); return; }
        const iterable = cb.params.length === 2 ? b.callExpression(b.memberExpression(callee.object, b.identifier("entries")), []) : callee.object;
        const variable = cb.params.length === 2 ? b.arrayPattern([cb.params[1], cb.params[0]]) : cb.params[0];
        p.parent.replace(b.forOfStatement(b.variableDeclaration("const", [b.variableDeclarator(variable)]), iterable, corps));
        change = true; return;
      }
      if (HELPERS[m]) {
        p.replace(b.awaitExpression(b.callExpression(b.identifier(HELPERS[m]), [callee.object, ...args])));
        besoinHelpers = true; change = true; return;
      }
      if (["sort", "then", "catch", "replace"].includes(m)) noter(fichier, p.node, `callback async passé à .${m}() : à reprendre à la main`);
    },
  });
  if (besoinHelpers) {
    const src = recast.print(ast).code;
    if (!/require\(["'][^"']*asyncArray(\.js)?["']\)/.test(src)) {
      const rel = path.relative(path.dirname(fichier), path.resolve(__dirname, "../../apps/api/src/lib/asyncArray.js")).replace(/\\/g, "/");
      const decl = recast.parse(`const { mapSeq, filterSeq, someSeq, everySeq, findSeq, findIndexSeq, flatMapSeq, reduceSeq } = require("${rel.startsWith(".") ? rel : "./" + rel}");\n`, { parser }).program.body[0];
      ast.program.body.unshift(decl); change = true;
    }
  }

  // Recensement des fonctions async (locales + exportées)
  const locaux = locauxAsync.get(fichier);
  recast.visit(ast, {
    visitFunctionDeclaration(p) { if (p.node.async && p.node.id && !locaux.has(p.node.id.name)) { locaux.add(p.node.id.name); change = true; } this.traverse(p); },
    visitVariableDeclarator(p) { if (n.Identifier.check(p.node.id) && p.node.init && estFonction(p.node.init) && p.node.init.async && !locaux.has(p.node.id.name)) { locaux.add(p.node.id.name); change = true; } this.traverse(p); },
  });
  const exp = exportsAsync.get(fichier);
  recast.visit(ast, {
    visitAssignmentExpression(p) {
      const g = p.node.left;
      const estModuleExports = n.MemberExpression.check(g) && n.Identifier.check(g.object) && g.object.name === "module" && g.property.name === "exports";
      if (estModuleExports && n.ObjectExpression.check(p.node.right)) {
        for (const prop of p.node.right.properties) {
          if (!prop.key) continue;
          const nom = prop.key.name || prop.key.value;
          const v = prop.value;
          const asyncP = (v && n.Identifier.check(v) && locaux.has(v.name)) || (v && estFonction(v) && v.async) || (n.ObjectMethod.check(prop) && prop.async);
          if (asyncP && !exp.has(nom)) { exp.add(nom); change = true; }
        }
      }
      if (n.MemberExpression.check(g) && n.MemberExpression.check(g.object) && g.object.property && g.object.property.name === "exports") {
        const nom = g.property.name; const v = p.node.right;
        if (((n.Identifier.check(v) && locaux.has(v.name)) || (estFonction(v) && v.async)) && !exp.has(nom)) { exp.add(nom); change = true; }
      }
      this.traverse(p);
    },
  });
  return change;
}

let tours = 0;
for (;;) {
  let change = false;
  for (const [f, ast] of asts) if (passe(f, ast)) change = true;
  if (!change || ++tours > 30) break;
}

// Signalements finaux
for (const [f, ast] of asts) {
  recast.visit(ast, {
    visitLiteral(p) { if (typeof p.node.value === "string" && /\bPRAGMA\b/i.test(p.node.value)) noter(f, p.node, "PRAGMA (SQLite) : à remplacer"); this.traverse(p); },
    visitStringLiteral(p) { if (/\bPRAGMA\b/i.test(p.node.value)) noter(f, p.node, "PRAGMA (SQLite) : à remplacer"); if (/COLLATE NOCASE/i.test(p.node.value)) noter(f, p.node, "COLLATE NOCASE : à remplacer"); this.traverse(p); },
    visitTemplateLiteral(p) { const t = p.node.quasis.map((q) => q.value.raw).join("${}"); if (/\bPRAGMA\b/i.test(t)) noter(f, p.node, "PRAGMA (SQLite) : à remplacer"); if (/COLLATE NOCASE/i.test(t)) noter(f, p.node, "COLLATE NOCASE : à remplacer"); this.traverse(p); },
    visitCallExpression(p) {
      const c = p.node.callee;
      if (n.MemberExpression.check(c) && !c.computed && ["pragma", "backup", "function", "aggregate", "iterate", "pluck"].includes(c.property.name) && !n.Identifier.check(c.object) || (n.MemberExpression.check(c) && n.Identifier.check(c.object) && DB_NOMS.has(c.object.name) && ["pragma", "backup", "function", "aggregate", "close"].includes(c.property.name))) noter(f, p.node, `API better-sqlite3 .${c.property.name}() : à remplacer`);
      this.traverse(p);
    },
  });
  fs.writeFileSync(f, recast.print(ast, { quote: "double" }).code);
}
console.log(`Conversion terminée en ${tours + 1} tour(s), ${fichiers.length} fichier(s).`);
console.log(`\nÀ REVOIR (${aRevoir.length}) :`);
for (const l of [...new Set(aRevoir)].sort()) console.log("  " + l);
