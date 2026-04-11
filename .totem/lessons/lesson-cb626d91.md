## Lesson — Verify lifecycle state enforcement

**Tags:** testing, lifecycle
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Ensure that lifecycle state changes are verified through the full execution pipeline to prevent 'placebo' features where metadata updates have no actual runtime effect.
