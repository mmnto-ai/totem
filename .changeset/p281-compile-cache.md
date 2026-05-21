---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(cli+core): Proposal 281 per-lesson compile cache (incremental compilation) (#NNNN)

Implements [Proposal 281 (Per-Lesson Hash Stability)](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/accepted/281-per-lesson-hash-stability.md), accepted via [`mmnto-ai/totem-strategy#387`](https://github.com/mmnto-ai/totem-strategy/pull/387) on 2026-05-20. Closes the first of two freeze-lift gates for `project_rule_compilation_freeze_2026_05_17` (Path A per [ADR-108](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-108-agent-state-continuity-architecture-synthesis.md)).

A per-lesson cache keyed by `(sourceHash, compile_worker_fingerprint)` short-circuits `totem lesson compile` for lessons whose source content is unchanged. Result: a `+1` lesson PR produces a `compiled-rules.json` diff with 1 new row, not 4931 lines.

## Surfaces

- `packages/core/src/compile-cache.ts` — new module: `CacheEntrySchema` (with `stableId?: string` reserved for P280 per [`mmnto-ai/totem-strategy#387`](https://github.com/mmnto-ai/totem-strategy/pull/387) § Dependencies), `computeLessonSourceHash`, `lookupCacheEntry`, `writeCacheEntry`, `buildCacheEntry`, `migrateFromCompiledRules`, `cacheEntryPath`, `listCacheEntries`.
- `packages/core/src/compile-cache.test.ts` — 21 tests covering the partial-mutation invariant (falsifying-metric test), byte-for-byte preservation on hit, fingerprint-rotation invalidation, source-change invalidation, `--force` bypass, `stableId` slot round-trip, graceful-miss on malformed cache files, `TOTEM_DISABLE_COMPILE_CACHE` env-var escape hatch, and migration idempotence.
- `packages/core/src/ledger.ts` — `LedgerEventSchema.type` enum extended with `compile_cache_decision`. `ruleId` carries the lesson `sourceHash`; `activity_name` carries the decision enum value (`cache_hit` / `cache_miss_source_changed` / `cache_miss_fingerprint_changed` / `cache_miss_force` / `cache_miss_no_prior_record`).
- `packages/cli/src/commands/compile.ts` — parallel compile path (~line 1614) wrapped with cache lookup. Cache hit returns the stored `CompileLessonResult` verbatim; cache miss invokes `compileLessonCore` and persists the result. `options.force` and `upgradeTargets` are honored as forced-recompile signals. Cache is bypassed when `compile_worker_fingerprint` is `undefined` (matching the `verify-manifest` provider gap discipline).

## Cache key composition

Layered (not composite). `stableId` first when present (P280 reservation; v1 never writes it) → `sourceHash` (SHA-256 of normalized lesson source, line endings collapsed to `\n`) → `fingerprint` (exact match required, else miss). `cli_version` is intentionally absent from the key — including it would invalidate every cohort bump.

## Storage

`.totem/cache/compile-lesson/<sourceHash-first-16-chars>.json`. Already gitignored (`.gitignore:5`). Flat directory for v1; fan-out follow-on tracked post-PR-open with soft trigger 1000 lessons.

## Telemetry

`compile_cache_decision` event per lesson per compile run. Best-effort fire-and-forget; ledger-write failures are swallowed at the writer site so a degraded ledger does not block compile.

## Emergency escape

`TOTEM_DISABLE_COMPILE_CACHE=1` reverts cache behavior to the pre-#NNNN status quo (lookup returns no-prior-record, write becomes a no-op). Emergency-only; deprecation-watch tracked post-PR-open.

## Falsifying metric

Per [Proposal 281 § Falsifying Metric](https://github.com/mmnto-ai/totem-strategy/blob/main/proposals/accepted/281-per-lesson-hash-stability.md): ≥99% of compile runs touching K lessons (by source change) produce `compiled-rules.json` row changes for exactly K lessons. Window: event-count-bounded (N=20 PRs post-thaw).

## Sequencing

P281 ships first (per [`mmnto-ai/totem-strategy#387`](https://github.com/mmnto-ai/totem-strategy/pull/387) re-grounded shape + ADR-108 Path A). P280 (`stableId` on lesson frontmatter) follows as defense-in-depth — the reserved `stableId` slot in `CacheEntry` makes P280's arrival additive, not breaking. The rule-compilation freeze lifts after both gates close + end-to-end clean recompile passes.
