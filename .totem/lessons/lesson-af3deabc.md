## Lesson — Separate read from parse in cleanup

**Tags:** cli, error-handling, json
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

In best-effort cleanup operations, allow file read or permission errors to fail loudly while swallowing JSON syntax errors to ensure the process is resilient to malformed files without hiding system failures.
