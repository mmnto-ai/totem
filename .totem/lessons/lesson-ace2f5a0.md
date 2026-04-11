## Lesson — Never split error messages on periods

**Tags:** dx, error-handling
**Scope:** packages/core/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Technical error messages frequently contain code patterns or file paths with dots; splitting on '.' truncates critical debugging context that users need to identify the failure.
