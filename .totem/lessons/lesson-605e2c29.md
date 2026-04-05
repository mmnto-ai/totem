## Lesson — Increase timeouts for Windows CI I/O

**Tags:** ci, windows, testing
**Scope:** packages/cli/src/**/*.test.ts

Windows CI environments often experience intermittent timeouts with default 5s limits due to slow temporary directory I/O. Increasing the suite-level timeout to 15s for file-heavy tests prevents these flaky failures.
