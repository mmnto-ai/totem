## Lesson — Use hidden commands for graceful retirement

**Tags:** cli, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Wiring retired commands as hidden entries allows throwing explicit errors with recovery hints, preventing user confusion from generic 'unknown command' failures.
