## Lesson — Omit manual prefixes in custom errors

**Tags:** errors, dx, formatting
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Manually prepending error messages with system prefixes duplicates formatting when centralized handlers also apply them. Rely on the error class constructor or centralized formatter to normalize prefixes.
