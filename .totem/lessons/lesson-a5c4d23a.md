## Lesson — Avoid suppression events for runtime failures

**Tags:** architecture, events
**Scope:** packages/core/**/*.ts, !**/*.test.*, !**/*.spec.*

The 'suppress' event should not be repurposed for runtime execution failures as it lacks the appropriate interface and misrepresents the architectural intent of suppression.
