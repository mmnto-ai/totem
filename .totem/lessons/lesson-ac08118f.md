## Lesson — Fail fast on unresolved upgrade hashes

**Tags:** validation, cli
**Scope:** packages/cli/src/commands/compile.ts

Detect and error on requested upgrade hashes that do not resolve to lessons to prevent stale targets from being silently pruned as no-ops.
