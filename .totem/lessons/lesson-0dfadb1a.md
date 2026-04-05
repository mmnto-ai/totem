## Lesson — Trace detection calls through templates

**Tags:** cli, architecture
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

CLI detection logic may be invoked by template generators rather than the main command entry point. Always verify the template engine's call graph before assuming a detection function is orphaned or unused.
