## Lesson — Use exit codes for CLI errors

**Tags:** cli, dx
**Scope:** packages/cli/src/commands/*.ts, !**/*.test.*

Prefer setting `process.exitCode` and logging via `log.error` over re-throwing exceptions in CLI command handlers. This aligns with standard CLI patterns and ensures clean output for the end user.
