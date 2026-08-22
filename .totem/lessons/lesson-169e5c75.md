## Lesson — Evaluate staged files using index content

**Tags:** git, cli
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Reading from the worktree during pre-commit or staged-file checks can lead to false passes on deleted or modified context. Use dedicated staged readers that query the Git index rather than the worktree to ensure evaluated bytes match what is actually being committed.
