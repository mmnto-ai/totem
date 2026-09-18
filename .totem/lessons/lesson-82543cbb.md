## Lesson — Use dry runs for ID collection

**Tags:** ci-cd, automation, workflow
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

When a workflow requires API-generated IDs to construct validation lines, execute a read-only dry-run pass first to harvest the IDs before final assembly and posting.
