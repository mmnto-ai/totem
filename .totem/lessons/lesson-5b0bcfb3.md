## Lesson — Implement version-tolerant schema readers

**Tags:** architecture, schema, zod
**Scope:** packages/core/src/artifacts/schema.ts

Accept all minor versions (e.g., 1.x) while rejecting unknown majors to ensure an append-only ledger remains readable across non-breaking updates.
