## Lesson — Deduplicate and sort policy arrays

**Tags:** cryptography, hashing, security
**Scope:** packages/core/src/artifacts/**/*.ts, !**/*.test.*

Deduplicating and sorting configuration arrays (such as globs and patterns) before computing policy hashes ensures that functionally equivalent policies produce identical signatures.
