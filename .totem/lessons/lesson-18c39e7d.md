## Lesson — Prefer no sensor over partial coverage

**Tags:** llm, linting, quality
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

It is better to archive a rule than to ship an incomplete pattern that misses related variants, as partial sensors provide a false sense of security.
