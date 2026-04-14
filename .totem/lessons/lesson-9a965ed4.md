## Lesson — Prefer kind over pattern for inside combinators

**Tags:** ast-grep, typescript
**Scope:** packages/core/**/*.ts, !**/*.test.*, !**/*.spec.*

Using 'inside: { pattern: ... }' can silently fail to match at runtime even when passing validation; use 'inside: { kind: ... }' for reliable structural matching.
