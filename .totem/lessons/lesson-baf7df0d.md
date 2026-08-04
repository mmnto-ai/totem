## Lesson — Avoid string prefix failure classification

**Tags:** refactoring, dx
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Classifying failure reasons or selecting recovery hints using string prefix matching on error messages is fragile. Use explicit, internal discriminants on the result object instead.
