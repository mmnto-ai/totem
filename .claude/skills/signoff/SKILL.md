---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

End-of-session wrap-up:

1. Update `MEMORY.md` with any new state (version shipped, tickets closed, key decisions)
2. Write a journal entry to the substrate journal at `<substrate>/.journal/totem/<filename>.md` summarizing today's work. Use `resolveSubstratePaths(gitRoot).journalRoot` from `@mmnto/totem` to locate the substrate; if `source === 'none'`, fall back to repo-local `.journal/totem/` and warn (ADR-090 graceful degradation).
3. Commit + push the substrate journal entry from `mmnto-ai/totem-substrate` (NOT this repo — `.journal/` is sediment-frozen here per ADR-100).
4. Clean up stale local branches: `git branch -vv | grep ': gone]' | awk '{print $1}' | xargs git branch -D`
5. Report: what shipped, what's pending, what's next
