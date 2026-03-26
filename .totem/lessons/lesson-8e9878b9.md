## Lesson — Static top-level imports from heavy core packages

**Tags:** performance, cli, nodejs
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Static top-level imports from heavy core packages can significantly slow down CLI startup for every command, including help flags. Using dynamic `await import()` inside the specific command's execution function ensures that resource-intensive dependencies are only loaded when required.
