## Lesson — Stub nested methods in library shims

**Tags:** architecture, testing, lancedb
**Scope:** packages/cli/build/shims/lancedb.js

When shimming complex libraries for lite tiers, ensure nested methods like Index.fts() are explicitly stubbed to throw clear tier-specific errors instead of generic TypeErrors.
