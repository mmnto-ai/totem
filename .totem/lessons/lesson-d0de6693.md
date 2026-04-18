## Lesson — Lazy-load CLI commands per ADR-072

**Tags:** cli, architecture, performance
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

CLI commands must use `await import()` for lazy-loading as mandated by ADR-072 §3. Rules that forbid dynamic imports in command bodies contradict this canonical reference and must be archived.
