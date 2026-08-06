## Lesson — Avoid index writes in read-only Git

**Tags:** git, concurrency
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Running Git commands without the `--no-optional-locks` flag can write to the index, violating read-only assumptions and causing issues in shared environments.
