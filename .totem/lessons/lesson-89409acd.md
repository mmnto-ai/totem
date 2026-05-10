## Lesson — Differentiate filesystem errors from syntax errors

**Tags:** error-handling, fs, json
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Throw on filesystem permission errors to prevent silent failures, but swallow JSON syntax errors during best-effort cleanup tasks like ejection to allow the process to continue.
