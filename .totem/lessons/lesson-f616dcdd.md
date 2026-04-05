## Lesson — Bypass regex validation for AST patterns

**Tags:** ast-grep, validation, eslint
**Scope:** packages/core/src/eslint-adapter.ts

Configuration parsers must skip regex-specific validation when an ast-grep engine is specified. This prevents false positives and allows the use of AST-specific syntax that would otherwise fail standard regex checks.
