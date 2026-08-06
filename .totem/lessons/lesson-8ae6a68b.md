## Lesson — Squash merges break Git ancestry checks

**Tags:** git, workflows
**Scope:** packages/**/*.ts, !**/*.test.*, !**/*.spec.*

Under squash-merge development workflows, Git ancestry checks cannot reliably prove a branch is merged, requiring external metadata or status snapshots to determine worktree staleness.
