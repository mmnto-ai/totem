## Lesson — Preserve preemptive delete in LRU cache sets

**Tags:** caching, performance, patterns
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Retain the preemptive delete-before-set pattern in LRU cache implementations even if currently only called on cache misses. This canonical move-to-end idiom ensures correct MRU promotion if the setter is ever reused for upserts, preventing the cache's correctness from being coupled to a single call path.
