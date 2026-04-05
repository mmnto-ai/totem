## Lesson — Sanitize dynamic ast-grep identifiers

**Tags:** ast-grep, security
**Scope:** packages/core/src/eslint-adapter.ts

Identifiers starting with '$' or named '_' trigger ast-grep meta-variable matching, leading to significant over-matching. Use a safety guard to fall back to regex for these specific patterns when generating rules dynamically.
