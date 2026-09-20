## Lesson — Report best effort prune failures

**Tags:** cli, fs, ux
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Silently swallowing directory cleanup errors masks filesystem permission or locking issues during eject. Appending these failures as skipped status entries preserves visibility without breaking the command's execution flow.
