## Lesson — Prune stale cache entries during no-op runs

**Tags:** cli, caching
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Cache pruning should occur even when no new work is required to prevent entries from deleted or edited source files from persisting indefinitely.
