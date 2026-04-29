## Lesson — Lazy load CLI display templates

**Tags:** cli, performance, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*

Use dynamic imports for display tags and templates inside command handlers to keep the CLI startup graph lightweight. Static imports of these constants can degrade performance by loading unnecessary modules during entry point initialization.
