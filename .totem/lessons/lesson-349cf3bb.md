## Lesson — Discriminate warnings for stray files

**Tags:** logging, ux, error-handling
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Differentiating between malformed expected files and unrelated strays allows for actionable warnings without creating permanent log noise.
