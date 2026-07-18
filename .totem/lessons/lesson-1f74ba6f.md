## Lesson — Fail toward flagging in lint gates

**Tags:** security, linting, error-handling
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When a scanner or parser fails to read file spans, it should degrade to returning no spans so that rules continue to flag violations rather than silently suppressing them.
