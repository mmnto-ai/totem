## Lesson — Distinguish stream validation from complete reads

**Tags:** validation, parsing
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Validation helpers designed to check truncated streams must adapt when evaluating complete file reads. Otherwise, size-bounded checks may falsely validate large whitespace-only bodies as non-empty.
