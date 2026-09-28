## Lesson — Limit lazy-import rules to CLI commands

**Tags:** cli, imports, testing, performance
**Scope:** packages/cli/src/commands/**/*.ts

The CLI lazy-import requirement is designed to optimize command startup performance and should not be applied to test files. Test suites should continue to use standard static top-level imports for simplicity and readability.
