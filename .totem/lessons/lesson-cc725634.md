## Lesson — Derive error metrics from single source

**Tags:** refactoring, dx, coherence
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

When constructing detailed error messages with status counts, always derive both the sub-counts and the total from the same validated collection. Mixing raw and parsed collections introduces structural inconsistency and risks drift during future refactors.
