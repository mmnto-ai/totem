## Lesson — Wrap partial AST nodes in valid parents

**Tags:** ast-grep, testing
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

ast-grep rejects standalone nodes like catch clauses or receiver-less member calls; patterns must include necessary parent context (e.g., try blocks) to be valid.
