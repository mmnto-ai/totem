## Lesson — Audit diagnostic call-sites for filters

**Tags:** testing, refactoring, cli
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When filtering core data loaders, audit diagnostic consumers like 'stats' or 'explain' commands to determine if they require an override flag to maintain visibility into archived states.
