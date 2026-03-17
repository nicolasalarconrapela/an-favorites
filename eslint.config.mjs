import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      ".vscode-test/**",
      "out/**",
      "dist/**",
      "node_modules/**",
      "**/*.js",
      "**/*.cjs",
      "**/*.mjs",
      "resources/**",
      "scripts/**"
    ]
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  eslintConfigPrettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/ban-ts-comment': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
      'no-empty': 'off',
      'no-useless-assignment': 'off',
      '@typescript-eslint/no-require-imports': 'off'
    },
  }
);
