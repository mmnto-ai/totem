## Lesson — Measure CLI PATH probe duration

**Tags:** telemetry, cli, performance
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Hardcoding CLI availability check durations to zero hides PATH lookup stalls in slow environments. Always measure and record the actual elapsed time of PATH probes for honest telemetry.
