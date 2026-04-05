## Lesson — Use regex for non-identifier properties

**Tags:** ast-grep, javascript, regex
**Scope:** packages/core/src/eslint-adapter.ts

Property names that are not valid JS identifiers (e.g., `foo-bar`) must use regex fallbacks because ast-grep may parse them as expressions like subtraction. This prevents syntax-based false positives when matching property access.
