## Lesson — Validate bash syntax during testing

**Tags:** bash, testing, ci
**Scope:** packages/cli/src/commands/**/*.ts

Use `bash -n` in the test suite to catch syntax errors that would trigger an exit 2 before runtime EXIT traps can be installed.
