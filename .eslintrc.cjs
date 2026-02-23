module.exports = {
  env: {
    node: true,
    es2020: true,
    mocha: true,
  },
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended", "prettier"],
  rules: {
    "@typescript-eslint/no-unused-vars": ["error", { "argsIgnorePattern": "^_" }],
  },
};
