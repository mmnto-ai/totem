## Lesson — Use sequential agents for batched PRs

**Tags:** workflow, agents, git

When multiple tickets are being bundled into a single PR, dispatch agents sequentially on the same branch rather than in parallel worktrees. Worktree isolation creates uncommitted changes across multiple directories that must be manually assembled via diff extraction and cherry-picking — the cleanup overhead exceeds the parallelism benefit. Reserve worktree isolation for truly independent work shipping in separate PRs.

**Source:** mcp (added at 2026-03-28T23:07:34.749Z)
