## Lesson — Prefer Error cause over concatenation

**Tags:** typescript, error-handling
**Scope:** packages/core/src/sys/git.ts

When re-throwing errors, use the 'cause' property instead of string concatenation to preserve the original error context and satisfy style guidelines.
