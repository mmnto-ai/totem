## Lesson — Prefer kind in ast-grep inside constraints

**Tags:** ast-grep, linting
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Using 'inside: { pattern: ... }' in ast-grep rules can cause silent zero-matches in smoke gates; use 'inside: { kind: ... }' for reliable structural matching.
