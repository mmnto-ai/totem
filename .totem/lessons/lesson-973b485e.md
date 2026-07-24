## Lesson — Bound filesystem walks past heavy subtrees

**Tags:** performance, filesystem
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Broad glob matching walks can cause severe performance issues or resource exhaustion when traversing large directories. Explicitly skip heavy subtrees like dependency, build, or data directories (e.g., node_modules, .lancedb, dist) during filesystem scans.
