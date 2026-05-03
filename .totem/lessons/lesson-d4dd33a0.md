## Lesson — Preserve totem-context prefix for lint suppression

**Tags:** dx, linting, adr-071
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

The `// totem-context:` prefix is a load-bearing directive for lint suppression; AI suggestions to replace it with 'SAFETY INVARIANT' should be merged into the comment body to maintain lint-clean status.
