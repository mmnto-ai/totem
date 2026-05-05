## Lesson — Prevent silent failures in short-circuit modes

**Tags:** cli, error-handling
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

In commands with short-circuit flags, any failure in the active phase must prevent success logs and ensure a non-zero exit code to avoid misleading the user about the operation's success.
