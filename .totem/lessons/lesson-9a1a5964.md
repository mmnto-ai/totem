## Lesson — Verify probe resilience against dependency failures

**Tags:** testing, resilience
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When implementing best-effort probes, include regression tests that mock dependency rejections rather than just network failures. This confirms the wrapper correctly handles unexpected internal errors or import failures without bubbling them to the user.
