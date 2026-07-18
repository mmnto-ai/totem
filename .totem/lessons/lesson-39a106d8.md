## Lesson — Isolate process exits at CLI edge

**Tags:** cli, architecture, testing
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Command handlers should maintain a strict no-process-exit contract to ensure they remain fully unit-testable. Keep process gating and exit-code resolution isolated at the CLI entry points.
