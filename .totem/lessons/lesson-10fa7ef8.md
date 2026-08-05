## Lesson — Ship CommonJS hooks as CJS

**Tags:** esm, commonjs, node, packaging
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Shipping CommonJS files with a `.js` extension causes runtime crashes (`require is not defined`) in ESM-configured (`"type": "module"`) environments. Explicitly using the `.cjs` extension prevents these fail-opens.
