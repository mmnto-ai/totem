## Lesson — Isolate filesystem operations in batch loops

**Tags:** node, fs, error-handling
**Scope:** .claude/hooks/**/*.mjs

Synchronous filesystem operations like statSync inside a batch processing loop must be wrapped in individual try/catch blocks to prevent a single unreadable or deleted file from aborting the entire operation.
