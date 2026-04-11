## Lesson — Defensively handle wrapped and raw ENOENT errors

**Tags:** error-handling, node.js, fs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When catching errors from utilities that wrap ENOENT, catch both the custom error class and the raw error to prevent silent failures if the utility is refactored.
