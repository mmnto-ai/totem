---
'@mmnto/cli': patch
---

Refresh `compile-manifest.json` on pure input-hash drift (#1337)

`totem lesson compile`'s no-op branch (introduced in #1281) refreshed the manifest only when `rulesPruned > 0 || drained > 0`. That left a gap: if a user deleted a lesson file whose rule was already absent from `compiled-rules.json` — or edited the lesson set in any way that produced zero prune/drain churn but shifted the `lessonsDir` hash — the manifest's `input_hash` stayed stale. `totem verify-manifest` then failed on the next `git push`, and the only recovery was `totem lesson compile --force` (~19 minutes of non-deterministic LLM calls on a mid-size repo).

The no-op branch now explicitly compares `generateInputHash(lessonsDir)` against the existing manifest's `input_hash` and refreshes the manifest on drift, even when no rules were pruned. The refresh is carefully partitioned: `compiled-rules.json` is still rewritten only when actual pruning happened, so a pure drift refresh does not spuriously touch the rules file or invalidate downstream mtime-based caches.

Missing or invalid `compile-manifest.json` is also handled — `readCompileManifest` wraps `ENOENT` via `readJsonSafe` into `TotemParseError` today, and a defensive raw-ENOENT fallback guards against future refactors of the core API. The missing-manifest path is locked in by an integration test in `compile-noop-refresh.test.ts`.
