## Lesson — Track per-seat counts for broadcasts

**Tags:** architecture, state, concurrency
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Using a flat union to track processed broadcast messages leads to a first-consumer-wins trap in multi-seat environments. Tracking distinct per-seat mark counts ensures shared broadcasts are not prematurely hidden from other active seats.
