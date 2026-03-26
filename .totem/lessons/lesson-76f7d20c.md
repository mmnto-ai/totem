## Lesson — Use dynamic await import() inside CLI command handlers

**Tags:** performance, cli, dx
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.ts, !**/*.spec.ts

Use dynamic await import() inside CLI command handlers for large internal packages instead of top-level static imports. This ensures that fast operations like version checks or help commands remain responsive by avoiding unnecessary module loading.
