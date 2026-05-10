## Lesson — Lazy load heavy CLI command dependencies

**Tags:** cli, performance
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*

Use dynamic `await import()` inside CLI handlers to load heavy core logic only when the command is executed. This prevents slow startup times caused by parsing unused dependencies during initial CLI boot.
