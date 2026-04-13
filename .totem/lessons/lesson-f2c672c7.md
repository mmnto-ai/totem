## Lesson — Use canonical noun-verb CLI command forms

**Tags:** cli, ux
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Use `totem lesson extract` and `totem lesson compile` instead of bare aliases like `totem extract`, which are deprecated. This ensures consistency across documentation, help text, and user-facing recovery hints.
