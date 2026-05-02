## Lesson — Use unique temp files for atomic writes

**Tags:** fs, concurrency
**Scope:** packages/core/src/**/*.ts

Using a static '.tmp' suffix for atomic writes can cause collisions when multiple processes — or rapid same-process writes — target the same path. Use a per-write unique suffix combining at least two sources of entropy: e.g. `${process.pid}.${Date.now().toString(36)}.tmp` (PID alone can collide when one process issues rapid sequential writes within a millisecond), or a UUID.
