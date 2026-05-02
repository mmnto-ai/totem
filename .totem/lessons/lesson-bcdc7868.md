## Lesson — Rename state files to avoid naming collisions

**Tags:** architecture, naming
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Avoid using filenames for committable state that conflict with existing telemetry cache modules to maintain a clear distinction between persistent and ephemeral data.
