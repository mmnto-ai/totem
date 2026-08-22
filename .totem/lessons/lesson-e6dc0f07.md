## Lesson — Enforce all-or-none validation for metadata groups

**Tags:** validation, zod, architecture
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

To prevent incomplete process state, groups of related optional metadata fields should be validated all-or-none together rather than allowing arbitrary partial subsets.
