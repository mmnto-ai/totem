## Lesson — Guard successor paths during migrations

**Tags:** migration, file-system, safety
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Unconditionally writing to a successor path during file migrations can silently overwrite pre-existing user-owned files. Always validate ownership and marker boundaries at the destination path before performing writes.
