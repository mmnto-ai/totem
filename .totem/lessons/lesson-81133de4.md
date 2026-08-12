## Lesson — Isolate informational notices from gating channels

**Tags:** logging, cli, monitoring
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Route informational notices through a dedicated channel rather than the main warnings channel to prevent non-critical logs from triggering strict quality gates or falsifying verification failures.
