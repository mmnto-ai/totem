## Lesson — Maintain uniform CLI exit boundaries

**Tags:** cli, architecture, error-handling
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Domain-specific errors should propagate through a single CLI error boundary and share a uniform exit code. Forcing custom exit codes for specific validation failures breaks the global error-handling architecture.
