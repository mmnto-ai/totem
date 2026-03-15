---
'@mmnto/totem': minor
---

Upgrade @lancedb/lancedb from 0.13.0 to 0.26.2.

- Fixes FTS (Full-Text Search) WAND panic (#491) — "pivot posting should have at least one document"
- Lance engine upgraded from v0.19 to v2.0.0 — improved search performance, FTS stability, and cache efficiency
- Users should run `totem sync --full` after upgrading to rebuild the index with the new engine format
