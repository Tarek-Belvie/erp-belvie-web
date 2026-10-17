// Contrôle statique de l'API. Les deux règles essentielles depuis le passage à PostgreSQL :
//   - no-floating-promises : un appel asynchrone (requête, fonction métier) sans await ;
//   - no-misused-promises  : une Promise utilisée comme booléen ou passée à un callback synchrone.
const tseslint = require("typescript-eslint");
module.exports = tseslint.config(
  { ignores: ["node_modules/**"] },
  {
    files: ["src/**/*.js", "test/**/*.js"],
    languageOptions: { parser: tseslint.parser, parserOptions: { projectService: true, tsconfigRootDir: __dirname }, sourceType: "commonjs" },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",
      "@typescript-eslint/require-await": "off",
    },
  },
  {
    // Assemblage Express : les gestionnaires asynchrones attrapent leurs erreurs (try/catch → next),
    // Express peut donc les recevoir comme callbacks. La règle reste stricte partout ailleurs —
    // notamment pour arr.forEach(async …), le piège principal du passage à l'asynchrone.
    files: ["src/app.js", "src/server.js", "src/routes/**/*.js", "src/auth.js"],
    rules: { "@typescript-eslint/no-misused-promises": ["error", { checksVoidReturn: { arguments: false } }] },
  },
  {
    files: ["test/**/*.js"],
    rules: { "@typescript-eslint/no-floating-promises": "off" },
  }
);
