## Lesson — Use cheap deterministic deduplication passes

**Tags:** performance, optimization, embeddings
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Precede expensive embedding-based similarity checks with a cheap O(n) exact-match pass on normalized headings to reduce vector database overhead.
