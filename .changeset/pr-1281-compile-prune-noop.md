---
'@mmnto/cli': patch
---

Prune stale `nonCompilable` entries on no-op compile runs (#1281)

`totem lesson compile` was only draining stale entries from the `nonCompilable` cache when there was actual compile work to do. On a no-op run (all lessons already compiled), stale entries — left over from lessons that had been edited or removed in a previous run — survived forever until some future run happened to have real work.

The prune logic is now extracted into a pure helper (`pruneStaleNonCompilable`) and called from both branches. The no-op path only rewrites `compiled-rules.json` when there's actually something to drain, so genuinely idle runs still don't touch the file.

Closes #1281. Discovered during the #1264 E2E reproduction.
