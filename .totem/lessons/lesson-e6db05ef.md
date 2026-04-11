## Lesson — Preserve raw spawn output in errors

**Tags:** dx, node
**Scope:** packages/core/src/sys/exec.ts

Store raw stdout and stderr in custom error objects before trimming them for human-readable messages. This ensures downstream consumers can access original whitespace or formatting if needed for programmatic parsing.
