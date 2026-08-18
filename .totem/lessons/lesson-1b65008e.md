## Lesson — Refuse foreign seats during identity resolution

**Tags:** identity, security, mail
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

A foreign seat must be refused with the resolver's own diagnostics appended to prevent incorrect unread status. A foreign-anchored poll should answer 'ever addressed' rather than 'unread' to maintain correct accounting.
