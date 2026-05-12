## Lesson — Enforce unique IDs in Zod schemas

**Tags:** zod, validation, architecture
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Use `superRefine` to enforce the uniqueness of identifiers within a collection at parse time, ensuring deterministic behavior and clear provenance in error reporting.
