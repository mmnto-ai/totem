---
'@mmnto/cli': minor
---

The managed hook templates — Claude SessionStart (`.claude/hooks/SessionStart.cjs`), Gemini SessionStart (`.gemini/hooks/SessionStart.js`), and the git `post-merge` hook — now fire `totem-status refresh-gh` spawn-and-forget when the sidecar binary is on PATH (routed C3 residual from mmnto-ai/totem-status#127, tracked in mmnto-ai/totem#2556). The invocation is presence-gated and fully asynchronous: session start and merge completion never wait on it, and repos without the sidecar see zero noise. Distributes through the existing drift-repair path (`totem hook install` via the consumer `prepare` wrapper).
