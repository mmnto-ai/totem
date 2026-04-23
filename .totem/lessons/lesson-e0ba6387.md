## Lesson — Validate inputs before performing side effects

**Tags:** architecture, validation
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Validating slugs and checking for collisions before any disk writes or process spawns prevents the creation of orphaned or corrupted artifacts.
