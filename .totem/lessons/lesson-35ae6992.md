## Lesson — Ensure per-item resilience in batch processing

**Tags:** cli, error-handling, api
**Scope:** packages/cli/**/*.ts, !**/*.test.*

Implement per-item catch-and-continue logic when batch processing external data (like PR lists) to ensure that transient API or parsing errors in a single item do not abort the entire command.
