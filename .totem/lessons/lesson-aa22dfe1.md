## Lesson — Capture and forward load warnings

**Tags:** lint, error-handling
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Omitting error or warning callbacks when invoking underlying resource loaders leads to silent enforcement bypasses. Always wire loader warning hooks to the CLI's reporting or error handler at the call site.
