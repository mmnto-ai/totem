## Lesson — Persist dynamic import initialization errors

**Tags:** typescript, cli, error-handling
**Scope:** packages/cli/src/index-lite.ts

When lazy-loading core dependencies, capture and persist initialization errors in a module-scoped variable so that downstream commands can report the specific cause of the failure.
