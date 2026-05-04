## Lesson — Unset environment variables in test cleanup

**Tags:** testing, environment
**Scope:** **/*.test.ts

When mocking environment variables, test cleanup must explicitly delete variables that were originally undefined to prevent state leakage between test cases.
