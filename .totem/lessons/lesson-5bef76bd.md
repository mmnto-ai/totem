## Lesson — Always use atomic file writes

**Tags:** fs, io, reliability
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Writing managed blocks directly using non-atomic sync writes can leave corrupted or incomplete files on disk upon an abort or crash. Use atomic write utilities for all user-facing scaffolding sites to ensure complete, transaction-like file updates.
