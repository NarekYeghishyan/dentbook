import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'packages/db/src/migrations/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'off',
      'no-console': 'warn',
      eqeqeq: ['error', 'always'],
    },
  },
  {
    // В тестах допустимы фикстуры и console
    files: ['**/*.test.ts', '**/*.spec.ts', '**/test/**'],
    rules: { 'no-console': 'off' },
  },
  prettier,
);
