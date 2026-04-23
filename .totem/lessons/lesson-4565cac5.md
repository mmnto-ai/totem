## Lesson — Treat duplicate hashes as data corruption

**Tags:** integrity, cli
**Scope:** packages/cli/src/commands/lesson.ts

Treat duplicate full hashes as data corruption rather than ambiguous prefixes during lookup to ensure the system fails fast before processing inconsistent state.
