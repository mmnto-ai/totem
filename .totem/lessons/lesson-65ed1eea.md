## Lesson — Defer git root resolution in layers

**Tags:** architecture, git
**Scope:** packages/core/src/strategy-resolver.ts

Probing for the git root should be deferred until a resolution layer actually requires it, preventing premature errors when absolute path overrides are provided via environment variables or configuration.
