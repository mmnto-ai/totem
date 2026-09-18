## Lesson — Preserve structural associations in parity tests

**Tags:** testing, architecture
**Scope:** packages/cli/src/commands/**/*.test.ts

When writing parity tests to sync duplicate configuration tables or maps, avoid flattening data into simple sets. The test must preserve and compare structured relationships, such as repository-to-seat associations, to prevent mapping errors from passing silently.
