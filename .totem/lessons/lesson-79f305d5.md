## Lesson — Relying on error name strings for matching is fragile

**Tags:** typescript, error-handling

Relying on error name strings for matching is fragile if underlying error classes or naming conventions change. Using instanceof combined with specific error codes provides a more robust and type-safe way to branch logic for expected failures.
