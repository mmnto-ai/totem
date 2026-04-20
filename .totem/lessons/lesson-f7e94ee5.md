## Lesson — Avoid abrupt CLI flag removal

**Tags:** cli, dx, commander
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Renaming or removing a boolean flag without providing a deprecated alias causes CLI parsers like Commander to error on existing user scripts.
