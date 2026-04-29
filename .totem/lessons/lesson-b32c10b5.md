## Lesson — Ensure override paths update content-hash cache

**Tags:** cli, cache, logic
**Scope:** packages/cli/src/commands/shield.ts

Manual override paths must update the reviewed content-hash cache to match the state of a passing review, otherwise users remain blocked by downstream push-gates.
