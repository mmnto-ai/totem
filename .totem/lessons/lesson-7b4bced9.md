## Lesson — Standardize catch block error naming

**Tags:** typescript, conventions
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Always capture catch block exceptions using the project-mandated 'err' variable name, even when the error is intentionally swallowed, to facilitate debugging.
