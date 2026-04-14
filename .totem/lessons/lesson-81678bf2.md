## Lesson — Batch telemetry-heavy operations to reduce cycles

**Tags:** performance, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Consolidate multiple upgrade or compile targets into a single pass to avoid redundant N-cycle loads of configuration, rules, and metrics.
