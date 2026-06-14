---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

fix(sync): self-heal orphaned chunks via working-tree reconciliation (mmnto-ai/totem#2151). Incremental `totem sync` now derives deletions by reconciling indexed paths against the working tree (`computeOrphanPaths` + new `LanceStore.getDistinctPaths()`) instead of from the git diff window, so chunks for files deleted, renamed into an ignored dir, newly ignored, or de-targeted are purged even when the baseline already advanced past the change — the prior class left them orphaned until `totem sync --full`. Comparison is separator-normalized but deletion uses the raw stored path (legacy backslash rows are neither false-purged nor missed). A purge-only sync now also rebuilds the FTS index so it drops the orphaned content, and the run reports an `orphansPurged` count.
