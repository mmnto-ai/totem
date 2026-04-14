## Lesson — Preserve original error context via cause

**Tags:** typescript, error-handling
**Scope:** packages/core/**/*.ts, !**/*.test.*

When wrapping runtime exceptions into custom classes like TotemParseError, use the 'cause' property to preserve the original stack trace and enable semantic error classification.
