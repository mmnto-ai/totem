## Lesson — Guard against future exception wrapping changes

**Tags:** error-handling, typescript, resilience
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

When catching wrapped errors (like custom exceptions wrapping ENOENT), include a fallback for the raw underlying error. This prevents silent failures if future refactors change how low-level system errors are wrapped or surfaced.
