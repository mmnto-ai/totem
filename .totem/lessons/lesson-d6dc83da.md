## Lesson — Sanitize ANSI codes in logged messages

**Tags:** security, logging
**Scope:** packages/cli/src/commands/first-lint-promote-runner.ts

Strip ANSI escape codes and control characters from user-provided strings before logging to prevent terminal injection and maintain log file integrity.
