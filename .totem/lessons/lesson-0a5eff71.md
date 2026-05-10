## Lesson — Use constants for diagnostic count assertions

**Tags:** testing, cli
**Scope:** packages/cli/src/commands/**/*.test.ts

Replace magic numbers in diagnostic suite assertions with named constants. This prevents silent drift and makes the expected contract explicit when adding or removing system checks.
