## Lesson — Implement fail-open-loud reads for markers

**Tags:** architecture, resilience, lifecycle
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When reading critical lifecycle markers, treat absent or corrupt files as active but emit loud warnings naming the file path to prevent lockouts while highlighting integrity issues.
