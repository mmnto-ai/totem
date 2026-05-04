## Lesson — Verify directory existence during resolution

**Tags:** fs, validation
**Scope:** packages/core/src/**/*.ts

Each layer in a path resolution chain must be verified as a real directory using fs.statSync to prevent fall-through logic from accepting invalid or non-existent paths.
