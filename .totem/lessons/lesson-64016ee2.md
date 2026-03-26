## Lesson — Converting top-level static imports of heavy internal

**Tags:** nodejs, performance, cli
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Converting top-level static imports of heavy internal packages to dynamic imports significantly reduces CLI startup latency. This ensures that only the necessary modules are loaded for the specific command being executed.
