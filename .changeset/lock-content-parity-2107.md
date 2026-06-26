---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

feat(parity): strategy-doctrine lock-content detector (totem#2107, strategy#754)

Adds `detectLockContentContract` (core) + the `manifestation: content-hash` route and `lockContentPackageDirFor` registry (CLI `doctor --parity`), closing the content half the `parity-manifest-currency` row's own TODO names — the currency row proves the `@mmnto/strategy-doctrine` pin is current; this row proves the distributed content matches. Re-derives each consumed lock `artifacts[].content-hash` via the §6 `normalize()`+`sha256()` contract (`normalizeLockArtifact`/`hashLockArtifact`, byte-for-byte the publisher's `tools/build-strategy-doctrine.cjs`), in two honest-absent layers, NEVER a fetch (Tenet 6/13): self-consistency (always — re-hash each packaged file vs its own lock hash) and vs-canonical (only when a local `../totem-strategy` sibling resolves via `resolveStrategyRoot` — re-hash the artifact's `canonical-source`). Layers render SEPARATELY (per artifact × per layer; no collapsed "content drift" verdict). `last-published-sha` is provenance-info only (a local `git cat-file -e` existence note when a sibling resolves), never a `sha == HEAD` comparator. Honest-absent taxonomy: package not installed → `skip`; lock absent/unparseable/unsupported-schema → `warn`; packaged-artifact absent / hash mismatch → self `warn`; sibling absent → vs-canonical `skip`. Adds the `content-hash` rung to the §6(a)2 ladder. The strategy-owned `strategy-doctrine-lock-content` manifest row (strategy#754) couples to this engine on merge.
