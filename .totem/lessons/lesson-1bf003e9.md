## Lesson — Persist dynamic import initialization errors

**Tags:** node, error-handling
**Scope:** packages/cli/src/index-lite.ts

Catching dynamic import failures without recording the error prevents downstream commands from reporting the root cause of why a module failed to initialize.
