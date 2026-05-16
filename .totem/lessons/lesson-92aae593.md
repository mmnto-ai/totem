## Lesson — Maintain statelessness in pre-push hooks

**Tags:** performance, git-hooks, dx
**Scope:** packages/cli/src/hooks/**/*.ts

Pre-push checks should be stateless and recompute from the current git diff to remain fast and avoid the overhead of managing SHA-stamped flag files.
