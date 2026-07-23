## Lesson — Scope fallback catches to specific errors

**Tags:** error-handling, search, resilience
**Scope:** packages/core/src/store/**/*.ts, !**/*.test.*

When falling back to keyword search (FTS) during embedder outages, only catch the specific no-embedder error class. Swallowing broader errors can mask other critical failures in the search pipeline.
