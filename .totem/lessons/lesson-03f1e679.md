## Lesson — Avoid detached spawns in Git worktrees

**Tags:** git, windows, node, process
**Scope:** packages/cli/src/commands/install-hooks.ts

Spawning a detached child process on Windows holds a directory lock on the hook's working directory. In a linked Git worktree where .git is a file rather than a directory, this lock prevents worktree removal and causes EPERM errors.
