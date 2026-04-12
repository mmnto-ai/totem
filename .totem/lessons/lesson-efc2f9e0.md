## Lesson — Partition manifest and rule file writes

**Tags:** performance, caching, filesystem
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Only rewrite large data files when content actually changes, while allowing manifest metadata to refresh on pure input drift. This prevents unnecessary invalidation of mtime-based downstream caches while keeping integrity checks satisfied.
