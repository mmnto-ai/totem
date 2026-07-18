## Lesson — Fail loud on unexpected Git errors

**Tags:** error-handling, git
**Scope:** packages/cli/**/*.ts, !**/*.test.*

While known benign issues like unparseable gitfiles should be handled gracefully as skips, other unexpected Git resolution failures must remain fail-loud to prevent silent configuration drift.
