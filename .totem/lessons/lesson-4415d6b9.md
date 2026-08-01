## Lesson — Delimit numeric assertions in text outputs

**Tags:** testing, assertions
**Scope:** packages/**/*.test.ts, packages/**/*.spec.ts

When verifying output counts in tests, assert the full delimited clause rather than an undelimited number. This prevents false positives where incorrect multi-digit counts or unrelated numbers satisfy a loose substring match.
