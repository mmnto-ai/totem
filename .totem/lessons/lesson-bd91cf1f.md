## Lesson — Execute child processes without a shell wrapper

**Tags:** cli, process, cross-platform
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

When wrapping CLI commands in a lifecycle script, spawn the child process directly via `process.execPath` rather than using a shell to prevent Windows quoting issues, and propagate its exit code verbatim to maintain correct pipeline failure semantics.
