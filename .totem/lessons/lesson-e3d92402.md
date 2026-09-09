## Lesson — Key repository maps on Git origin

**Tags:** git, worktrees, orchestration
**Scope:** packages/core/src/orchestration-resolver.ts

Keying repository maps on directory basenames fails in Git worktrees or renamed clones. Parsing the remote origin URL instead provides a stable repository identifier across different checkouts.
