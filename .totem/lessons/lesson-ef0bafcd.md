## Lesson — Verify writer discipline via factory tests

**Tags:** testing, validation
**Scope:** packages/core/src/ledger.test.ts

Tests should exercise production writer factories rather than manual object construction to ensure required fields are still populated after schema-level relaxation.
