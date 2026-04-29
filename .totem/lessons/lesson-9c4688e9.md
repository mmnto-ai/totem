## Lesson — Lazy-load CLI command constants

**Tags:** cli, performance
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Use dynamic imports for display tags and templates inside command handlers to keep CLI startup and module initialization lightweight.
