## Lesson — Maintain consistent test file exclusions

**Tags:** architecture, testing, eslint
**Scope:** packages/core/src/eslint-adapter.ts

Keep test file exclusions consistent across all adapter handlers to satisfy the 'Solo Dev Litmus Test' for predictability. Avoid refactoring these systemic patterns piecemeal in feature PRs to prevent inconsistent rule application.
