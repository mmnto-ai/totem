## Lesson — Static top-level imports in CLI command files increase

**Tags:** cli, performance, nodejs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Static top-level imports in CLI command files increase startup latency for every invocation, including metadata commands like `--help`. Using dynamic `import()` within the specific command handler ensures that heavy modules are only loaded when actually executed.
