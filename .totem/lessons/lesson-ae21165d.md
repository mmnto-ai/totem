## Lesson — Use process.exitCode for CLI exits

**Tags:** cli, node, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Prefer setting `process.exitCode` over calling `process.exit(1)` to allow the Node.js process to terminate gracefully. This ensures that cleanup logic, log flushing, and child process termination can complete before the process shuts down.
