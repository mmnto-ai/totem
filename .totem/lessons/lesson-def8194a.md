## Lesson — Warn on non-critical hook failures

**Tags:** cli, ux, resilience
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Post-scaffold hooks like git add or documentation injection should warn-and-continue rather than crashing to prevent leaving artifacts in a half-finished state.
