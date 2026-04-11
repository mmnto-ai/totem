## Lesson — Partition manifest updates from content writes

**Tags:** performance, caching, fs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Only rewrite content files when data actually changes, but refresh manifests on input drift to avoid invalidating mtime-based downstream caches unnecessarily.
