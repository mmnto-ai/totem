## Lesson — Trim trailing semicolons from declaration text

**Tags:** ast-grep, dx
**Scope:** packages/core/**/*.ts, !**/*.test.*, !**/*.spec.*

When capturing text from declaration-pattern nodes, trailing semicolons should be trimmed to prevent syntax noise in downstream processing.
