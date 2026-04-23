## Lesson — Spy on logger contracts in tests

**Tags:** testing, dx
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Asserting against high-level logger methods rather than internal transport outputs prevents tests from breaking when output plumbing changes.
