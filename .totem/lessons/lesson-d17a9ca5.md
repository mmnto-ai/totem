## Lesson — Verify resolved Git paths are directories

**Tags:** git, validation, fs
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Git configuration values like `core.hooksPath` may resolve to non-directory paths (e.g., `/dev/null`). Always verify that the resolved path is a directory before attempting writes to prevent silent failures or crashes.
