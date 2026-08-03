---
'@mmnto/cli': minor
---

The managed hook templates — Claude SessionStart (`.claude/hooks/SessionStart.cjs`), Gemini SessionStart (`.gemini/hooks/SessionStart.js`), and the git `post-merge` hook — now fire `totem-status refresh-gh` spawn-and-forget (routed C3 residual from mmnto-ai/totem-status#127, tracked in mmnto-ai/totem#2556). Two gates, both required: the sidecar binary must be on PATH (absent = zero noise), and the cwd must be a PRIMARY checkout (`.git` is a directory — in a linked worktree a detached child inheriting the cwd holds a Windows directory lock that breaks worktree removal, so worktrees skip and the primary's hooks cover the workspace-level snapshot). The invocation is fully asynchronous: session start and merge completion never wait on it. Distributes through the existing drift-repair path (`totem hook install` via the consumer `prepare` wrapper).
