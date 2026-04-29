## Lesson — Synchronize caches in override paths

**Tags:** cli, cache, state-management
**Scope:** packages/cli/src/commands/shield.ts

Override completion paths must update the same state caches as passing paths to prevent users from being blocked by stale gate checks.
