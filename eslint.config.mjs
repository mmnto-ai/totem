import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

export default tseslint.config(
  // Global ignores
  {
    ignores: ['**/dist/', '**/node_modules/', '.lancedb/', '.turbo/'],
  },

  // Base TypeScript rules for all packages
  ...tseslint.configs.recommended,

  // Import sorting
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            // Node builtins
            ['^node:'],
            // External packages
            ['^@?\\w'],
            // @mmnto scope
            ['^@mmnto/'],
            // Relative imports
            ['^\\.'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
    },
  },

  // Bug prevention & style rules
  {
    rules: {
      // Enforce `err` in catch blocks
      'id-match': ['error', '^(?!error$).*$', { onlyDeclarations: false, properties: false }],

      // No empty catch blocks
      'no-empty': ['error', { allowEmptyCatch: false }],

      // Prefer const
      'prefer-const': 'error',

      // No unused vars (allow underscore prefix)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // MCP package: no console (stdio transport safety)
  {
    files: ['packages/mcp/src/**/*.ts'],
    rules: {
      'no-console': 'error',
    },
  },

  // Disable type-aware rules that require tsconfig project references
  {
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Prettier must be last
  eslintConfigPrettier,
);
