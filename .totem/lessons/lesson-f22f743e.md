## Lesson — Defer git root resolution in resolvers

**Tags:** git, architecture
**Scope:** packages/core/src/strategy-resolver.ts

Avoid eager git root resolution in path resolvers. Deferring the probe until a specific precedence layer requires a git-relative anchor prevents unnecessary crashes in non-git environments when absolute overrides are provided via env or config.
