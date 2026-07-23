## Lesson — Use positive controls in suppression tests

**Tags:** testing, qa
**Scope:** packages/**/*.test.ts, packages/**/*.spec.ts

When writing assertions to verify that an advisory or warning is suppressed, always include a positive control test to ensure the suppression assertion cannot pass vacuously.
