## Lesson — Unroll error cause chains for shell execution

**Tags:** errors, shell
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*

Use `describeSafeExecError` to unroll error cause chains instead of manual message concatenation in wrappers. This complies with project error-handling rules and prevents obscuring the root cause of execution failures.
