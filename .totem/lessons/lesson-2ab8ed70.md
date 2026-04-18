## Lesson — Avoid over-broad empty array declarations

**Tags:** ast-grep, linting
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Generic patterns like `const $VAR = []` are too broad and trigger on every empty array declaration. Ensure patterns are specific enough to distinguish intended targets from transient arrays.
