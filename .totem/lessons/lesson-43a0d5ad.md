## Lesson — Verify redirect targets

**Tags:** logic, validation
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Check for target file existence before applying size-based short-circuits to ensure that any file matching a redirect pattern is valid, even if it is small.
