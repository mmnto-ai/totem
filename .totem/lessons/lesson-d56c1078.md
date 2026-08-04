## Lesson — Prevent gutted stores with pre-reset checkpoints

**Tags:** sync, state-management, lancedb
**Scope:** packages/core/src/ingest/**/*.ts, !**/*.test.*

Writing a dirty-marker checkpoint atomically before resetting a database store prevents crashes from leaving a gutted store that incremental syncs falsely report as complete.
