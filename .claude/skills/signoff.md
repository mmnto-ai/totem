---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

End-of-session wrap-up:

1. Update `MEMORY.md` with any new state (version shipped, tickets closed, key decisions)
2. Write a journal entry in `.strategy/.journal/` summarizing today's work
3. Push any uncommitted strategy repo changes
4. Clean up stale local branches: `git branch -vv | grep ': gone]' | awk '{print $1}' | xargs git branch -D`
5. Report: what shipped, what's pending, what's next
