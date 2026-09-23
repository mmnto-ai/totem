## Lesson — Differentiate Git directories from worktree files

**Tags:** git, worktrees, filesystem
**Scope:** packages/cli/src/**/*.ts, !**/*.test.*, !**/*.spec.*

Walking up ancestors to find a repository root must distinguish between `.git` directories and `.git` files. Worktrees and submodules use files, which can cause dispatches to be written where background pollers never scan.
