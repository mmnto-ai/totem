## Lesson — Conditional archival metadata preservation

**Tags:** lifecycle, core
**Scope:** packages/core/src/compile-lesson.ts

Only preserve archivedReason and archivedAt metadata when the existing item's status is 'archived' to prevent stale lifecycle data from leaking into active rules.
