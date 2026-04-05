## Lesson — Account for slow Windows CI I/O

**Tags:** ci, windows, testing
**Scope:** packages/cli/src/**/*.test.ts

Orchestrator tests involving heavy file I/O or temporary directories may require increased timeouts (e.g., 15,000ms) on Windows CI to prevent intermittent failures caused by slow disk operations.
