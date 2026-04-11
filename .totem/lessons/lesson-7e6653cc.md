## Lesson — Lazy-load core libraries in CLI commands

**Tags:** performance, cli, typescript
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Static imports of core libraries in CLI command files delay startup; use dynamic imports within handlers to ensure the CLI remains responsive.
