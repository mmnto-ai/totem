## Lesson — Reconnect all handles after sync operations

**Tags:** lancedb, mcp, resilience
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

Database sync operations in linked repositories can leave stale pointers in the main process. Iterating and reconnecting all handles (primary and linked) ensures search results remain consistent without requiring a server restart.
