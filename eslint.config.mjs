import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.next/**',
      '**/node_modules/**',
      '**/next-env.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  { files: ['**/*.cjs'], languageOptions: { globals: { module: 'readonly' } } },
  {
    // The public service worker runs in the service-worker global scope.
    files: ['apps/frontend/public/*.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        clients: 'readonly',
        caches: 'readonly',
        registration: 'readonly',
      },
    },
  },
  {
    // Node build tooling for the CSP hash pipeline.
    files: ['apps/frontend/scripts/*.mjs'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
);
