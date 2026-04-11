## Lesson — Consolidate dynamic imports in CLI handlers

**Tags:** cli, dx, performance
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Destructure all required helpers from a single dynamic import at the top of the handler to improve performance and avoid contradictory linting rules.
