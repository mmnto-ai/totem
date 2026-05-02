## Lesson — Validate persisted map keys against hashes

**Tags:** security, persistence
**Scope:** packages/core/src/verification-outcomes.ts

When loading memoized state, verify that map keys match internal object hashes to ensure tampered or malformed entries are not utilized.
