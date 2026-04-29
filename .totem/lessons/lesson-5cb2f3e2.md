## Lesson — Use cause property for error wrapping

**Tags:** typescript, error-handling
**Scope:** packages/core/src/sys/git.ts

When re-throwing errors, avoid concatenating messages and instead use the 'cause' property to preserve the original error structure and context.
