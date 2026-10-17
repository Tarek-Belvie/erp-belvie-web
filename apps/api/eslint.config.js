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
  }
);
