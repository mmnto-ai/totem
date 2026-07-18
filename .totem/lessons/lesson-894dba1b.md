## Lesson — Never assume .git is a directory

**Tags:** git, worktree, cli
**Scope:** packages/cli/**/*.ts, !**/*.test.*

In linked Git worktrees, `.git` is a pointer file rather than a directory, meaning path joins like `.git/hooks` will fail with `ENOTDIR`. Query `git rev-parse --git-path hooks` to resolve the actual hooks directory dynamically.
