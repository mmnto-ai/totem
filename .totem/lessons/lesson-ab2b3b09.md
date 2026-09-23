## Lesson — Derive reply mark roots from written paths

**Tags:** architecture, filesystem, mail
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

When replying to a message, the processed mark must be written to the same resolved root as the reply itself. Resolving the root independently can cause the mark to land in a stray nested directory, leaving the source message unread.
