## Lesson — Singular query functions should act as thin wrappers around

**Tags:** refactoring, architecture, maintenance

Singular query functions should act as thin wrappers around batch implementations to centralize setup logic like language detection and file parsing. This prevents logic drift and ensures that improvements to the core batch processing logic automatically benefit singular calls.
