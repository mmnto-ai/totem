## Lesson — Annotate terminal handlers for AST-grep

**Tags:** linting, ast-grep, dx
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Functions that terminate processes should be annotated or recognized as terminal to avoid false positives in 'fail-open' linting rules.
