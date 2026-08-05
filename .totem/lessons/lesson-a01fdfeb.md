## Lesson — Verify markers before unlinking files

**Tags:** eject, file-system, safety
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Relying on naive substring matching during eject or cleanup operations can accidentally delete user-modified files. Use robust marker verification to ensure only scaffolded files are removed.
