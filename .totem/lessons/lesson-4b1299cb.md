## Lesson — Validate effective embedder identity on resume

**Tags:** embeddings, vector-database, security
**Scope:** packages/core/src/embedders/**/*.ts, !**/*.test.*

Silent fallbacks to local providers can mix incompatible vector spaces; always resolve and validate the effective serving configuration before resuming a cached sync epoch.
