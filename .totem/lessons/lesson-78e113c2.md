## Lesson — Verify lock ownership before deletion

**Tags:** lock, concurrency, security
**Scope:** packages/core/src/lock.ts

Unconditional file unlinking during lock release can delete a new holder's valid lock if the original lock was stolen. Lock release and reclaim paths must verify ownership to prevent TOCTOU race conditions.
