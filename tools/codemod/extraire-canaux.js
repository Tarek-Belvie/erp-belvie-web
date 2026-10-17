#!/usr/bin/env node
// OUTIL PONCTUEL — inventaire des canaux IPC d'Electron 1.0.1 (main.js + preload.js), pour générer
// le registre des routes de l'API. Sortie : JSON sur stdout.
//   node tools/codemod/extraire-canaux.js <electron/main.js> <electron/preload.js>
const fs = require("fs");
const babel = require("@babel/parser");
const recast = require("recast");
const n = recast.types.namedTypes;

const [mainJs, preloadJs] = process.argv.slice(2);
const parse = (f) => babel.parse(fs.readFileSync(f, "utf8"), { sourceType: "script" });
const src = (f, node) => fs.readFileSync(f, "utf8").slice(node.start, node.end);

// --- main.js : canal → module.fonction(params)
const modulesParVariable = {};
const canaux = {};
recast.visit(parse(mainJs), {
  visitVariableDeclarator(p) {
    const i = p.node.init;
    if (i && n.CallExpression.check(i) && i.callee.name === "require" && /\.\/ipc\//.test(i.arguments[0].value || "")) {
      modulesParVariable[p.node.id.name] = i.arguments[0].value.replace("./ipc/", "");
    }
    this.traverse(p);
  },
  visitCallExpression(p) {
    const c = p.node.callee;
    if (n.MemberExpression.check(c) && c.object.name === "ipcMain" && c.property.name === "handle") {
      const canal = p.node.arguments[0].value;
      const fn = p.node.arguments[1];
      const params = fn.params.slice(1).map((x) => (n.Identifier.check(x) ? x.name : src(mainJs, x)));
      let corps = fn.body;
      if (n.BlockStatement.check(corps) && corps.body.length === 1 && n.ReturnStatement.check(corps.body[0])) corps = corps.body[0].argument;
      const entree = { canal, params, simple: false };
      if (n.CallExpression.check(corps) && n.MemberExpression.check(corps.callee) && modulesParVariable[corps.callee.object.name]) {
        const args = corps.arguments.map((a) => src(mainJs, a));
        entree.module = modulesParVariable[corps.callee.object.name];
        entree.fonction = corps.callee.property.name;
        entree.avecDb = args[0] === "getDb()";
        const reste = entree.avecDb ? args.slice(1) : args;
        entree.simple = reste.join(",") === params.join(",");
        if (!entree.simple) entree.args = reste;
      } else {
        entree.corps = src(mainJs, fn).slice(0, 400);
      }
      canaux[canal] = entree;
    }
    this.traverse(p);
  },
});

// --- preload.js : espace.methode(params) → canal
const preload = [];
recast.visit(parse(preloadJs), {
  visitObjectProperty(p) {
    const v = p.node.value;
    if ((n.ArrowFunctionExpression.check(v) || n.FunctionExpression.check(v))) {
      let corps = v.body;
      if (n.BlockStatement.check(corps) && corps.body.length === 1 && n.ReturnStatement.check(corps.body[0])) corps = corps.body[0].argument;
      if (n.CallExpression.check(corps) && n.MemberExpression.check(corps.callee) && corps.callee.object.name === "ipcRenderer") {
        const parent = p.parentPath.parentPath.parentPath.node; // propriété englobante (espace)
        const espace = parent && parent.key ? parent.key.name : "?";
        preload.push({
          espace, methode: p.node.key.name || p.node.key.value,
          type: corps.callee.property.name, canal: corps.arguments[0].value,
          params: v.params.map((x) => src(preloadJs, x)),
          args: corps.arguments.slice(1).map((a) => src(preloadJs, a)),
        });
      }
    }
    this.traverse(p);
  },
});
process.stdout.write(JSON.stringify({ canaux, preload }, null, 1));
