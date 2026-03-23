## Lesson — Preserve error context when re-throwing

**Tags:** error-handling, debugging, json

When catching and re-throwing errors, specifically during JSON parsing, it is critical to capture and include the original error message or context. Swallowing these details makes it significantly harder to diagnose the underlying cause of file corruption or malformation.
