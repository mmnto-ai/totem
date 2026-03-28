## Lesson — GCA does not update its review context between pushes

**Tags:** gca, coderabbit, bot-review, workflow

GCA does not update its review context between pushes on the same PR. It re-runs against the new diff but keeps flagging issues from earlier commits that were already fixed. CodeRabbit adapts mid-PR via its learnings system. When triaging GCA comments on later commits, check if the finding was already addressed before acting.

**Source:** mcp (added at 2026-03-28T07:11:32.819Z)
