## Lesson — Report metrics after data transformations

**Tags:** dx, logging
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Log messages should compute counts after pruning or filtering logic to avoid reporting stale item counts in success summaries.
