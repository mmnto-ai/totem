## Lesson — Prefer exit codes over re-throwing CLI errors

**Tags:** cli, error-handling
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Use `log.error` and `process.exitCode` in CLI command handlers instead of re-throwing exceptions. This aligns with project patterns for clean output and proper exit status management.
