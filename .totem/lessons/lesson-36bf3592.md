## Lesson — Validate JSON at system boundaries

**Tags:** typescript, security, io
**Scope:** packages/core/src/retired-lessons.ts

Avoid using type assertions when reading JSON from disk; perform element-level validation instead. This prevents downstream crashes if the ledger file is corrupted or manually edited by a user.
