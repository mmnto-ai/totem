## Lesson — Degrade gracefully on advisory warning failures

**Tags:** error-handling, ux
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Failures in computing non-critical advisory warnings should degrade to no-warning and never affect the final command verdict. This maintains tool resilience in environments where branch-vs-base resolution is undefined.
