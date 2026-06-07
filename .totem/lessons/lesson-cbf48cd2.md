## Lesson — Use atomic write-if-absent flags

**Tags:** filesystem, security, concurrency
**Scope:** packages/core/src/artifacts/storage.ts

Utilize the 'wx' flag in file operations instead of an exists-then-write pattern to prevent TOCTOU race conditions and enforce 'first write wins' semantics.
