---
'@mmnto/totem': patch
---

fix(sync): incremental sync now reconciles ignore-pattern REMOVALS, not just additions (mmnto-ai/totem#2366).

Removing a pattern from `ignorePatterns` / `indexIgnorePatterns` makes previously-excluded files index-eligible, but incremental sync only re-embedded files the git diff reported as changed — so a newly-eligible file whose bytes were unchanged since the last sync stayed out of the index until a full sync or an unrelated edit. The addition direction already self-healed via orphan reconciliation; this adds the symmetric mechanism. Sync state now persists an order-normalized hash of the effective exclusion set, and on the next incremental sync a hash change (or its absence, for state written before this fix) enqueues the newly-eligible set (live files not yet indexed), reusing the indexed-path read the orphan pass already performs. Reordering patterns is not treated as a change, and an unchanged exclusion set adds no extra work.

Consumer-impact: incremental sync only — after an ignore-pattern edit, files that became eligible are re-indexed on the next sync instead of lagging until a full rebuild. The `.totem/cache/sync-state.json` file gains an optional `indexExclusionHash` field; older state without it is read normally (treated as a one-time exclusion-set mismatch, which is a near-empty enqueue for an up-to-date index). No migration required.
