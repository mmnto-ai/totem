## Lesson — Preserve raw buffers in spawn errors

**Tags:** node, error-handling
**Scope:** packages/core/src/sys/**/*.ts, !**/*.test.*

Capture raw `stdout` and `stderr` buffers before trimming for human-readable messages to ensure programmatic consumers have access to the original, unmutated output.
