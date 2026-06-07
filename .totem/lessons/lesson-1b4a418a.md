## Lesson — Exclude timestamps from content addresses

**Tags:** storage, deduplication
**Scope:** packages/core/src/artifacts/storage.ts

Omit volatile fields like 'createdAt' from deterministic hash calculations to allow identical runs to deduplicate across different execution times.
