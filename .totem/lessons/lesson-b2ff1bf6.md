## Lesson — Selective rethrow for best-effort I/O

**Tags:** error-handling, telemetry, node
**Scope:** packages/cli/src/commands/compile.ts

Best-effort I/O tasks like telemetry should swallow expected system errors (ENOENT, EACCES) but rethrow unexpected ones to prevent silent architectural drift.
