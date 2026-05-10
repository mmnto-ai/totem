## Lesson — Ensure environment probes are non-throwing

**Tags:** cli, resilience, error-handling
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Environment probes should wrap dynamic imports and network calls in try/catch blocks to return a 'not available' state instead of throwing. This ensures that optional feature detection doesn't crash critical paths like project initialization.
