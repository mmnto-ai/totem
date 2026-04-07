## Lesson — Guard against dropping metadata-less items

**Tags:** logic, safety
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Ensure items with missing or whitespace-only metadata are ignored by specific filtering passes so they can be evaluated by subsequent fallback logic.
