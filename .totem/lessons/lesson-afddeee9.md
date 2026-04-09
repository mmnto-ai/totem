## Lesson — Align read and write cache hashing

**Tags:** caching, bug-prevention
**Scope:** packages/cli/src/utils.ts

Inconsistent hashing logic between the read and write paths of a response cache results in permanent cache misses even when the content is identical.
