## Lesson — Use unique temp files for atomic writes

**Tags:** fs, concurrency
**Scope:** packages/core/src/verification-outcomes.ts

Using a static '.tmp' suffix for atomic writes can cause collisions when multiple processes write to the same path; use unique identifiers like PIDs or UUIDs for temporary files.
