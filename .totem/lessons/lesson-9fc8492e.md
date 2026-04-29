## Lesson — Lazy load heavy modules in CLI handlers

**Tags:** cli, performance, dx
**Scope:** packages/cli/**/*.ts, !**/*.test.*

CLI commands should use dynamic imports for heavy modules like 'node:fs', 'node:path', or 'zod' inside the command handler to minimize startup latency and improve tool responsiveness.
