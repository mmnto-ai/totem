## Lesson — Track record changes in manifest freshness

**Tags:** manifest, build-system, caching
**Scope:** packages/cli/src/commands/compile.ts

Manifest freshness checks must account for tracked record file changes even when main compilable inputs are unchanged, preventing stale hashes during incremental compiles.
