## Lesson — Avoid ast-grep meta-variable collisions

**Tags:** ast-grep, static-analysis, regex
**Scope:** packages/core/src/eslint-adapter.ts

Identifiers starting with `$` or named `_` trigger ast-grep meta-variable and wildcard logic, causing significant over-matching in string patterns. Use a safety guard to fall back to regex for these specific names to maintain rule precision.
