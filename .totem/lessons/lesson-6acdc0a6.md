## Lesson — Resolve Git directory dynamically in hooks

**Tags:** git, hooks, worktrees
**Scope:** packages/cli/src/commands/**/*.ts, !**/*.test.*, !**/*.spec.*

Hardcoding `.git` paths in Git hooks breaks in linked worktrees where `.git` is a file rather than a directory. Always resolve the directory dynamically at runtime using `git rev-parse --git-dir`.
