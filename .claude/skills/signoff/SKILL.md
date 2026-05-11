---
name: signoff
description: End-of-session — update memory, write journal entry, clean up
---

<!-- totem:skill-start -->

End-of-session wrap-up:

1. Update `MEMORY.md` with any new state (version shipped, tickets closed, key decisions)
2. Write a journal entry to the substrate journal at `<substrate>/.journal/totem/<filename>.md` summarizing today's work. Use `resolveSubstratePaths(gitRoot).journalRoot` from `@mmnto/totem` to locate the substrate; if `source === 'none'`, fall back to repo-local `.journal/totem/` and warn (ADR-090 graceful degradation).
3. Commit + push the substrate journal entry from `mmnto-ai/totem-substrate` (NOT this repo — `.journal/` is sediment-frozen here per ADR-100). Use rebase-and-retry on the push since other agents may sign off concurrently:

   ```bash
   cd <substrate-repo-root>
   git add .journal/totem/<filename>.md
   git commit -m "journal(totem): <slug>"
   pushed=0
   for i in 1 2 3 4 5; do
     git push origin main && { pushed=1; break; }
     git pull --rebase --autostash origin main || { echo "Rebase conflict — manual resolution needed"; break; }
     sleep 1
   done
   [ "$pushed" = 1 ] || { echo "ERROR: substrate push failed — surface to user"; exit 1; }
   ```

   **Why the retry loop:** Substrate `main` accepts only fast-forward pushes. If a peer push (strategy-Claude, lc-Claude, status-Claude, etc.) lands between your commit and your push, yours fails with `non-fast-forward`. Per-agent journal filenames (`<model>-NNNN-*.md`) don't collide, so the rebase auto-succeeds without conflict — typically resolves within 1-2 retries. After 5 retries surface failure to the user; that's likely a genuine same-file edit (e.g., two recipients moving the same `_broadcast/` file to `processed/`) that needs manual resolution.

4. Clean up stale local branches: `git branch -vv | grep ': gone]' | awk '{print $1}' | xargs git branch -D`
5. Report: what shipped, what's pending, what's next
<!-- totem:skill-end -->
