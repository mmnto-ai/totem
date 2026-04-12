## Lesson — Avoid prefixes in low-level error messages

**Tags:** dx, error-handling
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*

Adding standard error prefixes to low-level utilities can break downstream sentinel detection used to prevent redundant error wrapping and preserve operation-level context.
