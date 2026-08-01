## Lesson — Avoid reassuring leads on degraded states

**Tags:** ux, cli, error-handling
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

A degraded scan or process must never output a final verdict that mimics a clean run. The verdict must lead with the failure or degradation status to prevent users from overlooking warnings.
