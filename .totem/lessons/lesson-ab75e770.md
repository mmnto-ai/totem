## Lesson — Use fatal flag for security refinements

**Tags:** zod, security, validation
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Set `fatal: true` in Zod refinements for security gates to ensure the validation chain short-circuits immediately, preventing subsequent unsafe or expensive refinements from executing.
