## Lesson — Moving static imports of heavy internal packages

**Tags:** nodejs, cli, performance
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Moving static imports of heavy internal packages into dynamic `await import()` calls inside specific command handlers significantly reduces CLI startup latency. This ensures that dependencies are only loaded into memory when the user actually executes that specific command.
