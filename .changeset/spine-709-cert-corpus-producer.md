---
'@mmnto/totem': minor
---

feat(spine): cert-corpus materialization producer — `totem spine windtunnel materialize` (strategy#709)

The Gate-1 cert run's SCORING corpus had no producer: `loadCertRunFixtures` hard-requires 6 fixtures and only `record` wrote 2 (the minted-rules half). This adds the producer for the 4 unproduced, non-label fixtures — the lock, `split.json`, `pr-diffs.json`, and the positive/negative control dirs — so the cert corpus is materializable upstream of `record`→`freeze`→`run`. The disposition-derived `ground-truth-labels.json` deriver is the next slice (contract ruled).

Cohort-panel-ratified (codex/agy/gemini, distinct lenses) before any code; the folds it surfaced are incorporated:

- **Seed-manifest boundary** (panel OQ1/OQ2): a small curated seed carries the irreducible answer-key decisions (asOfCommit, selection predicate/config, `cutIndex`, control designations + each positive control's `targetRuleId`); everything else — the resolved corpus, the ancestry-cut split, per-PR diffs, the integrity shas, the assembled lock — is derived off the lc clone. Pure derivation + lock assembly in core (`deriveCorpus` / `buildWindtunnelLock`), git I/O in the CLI.
- **Reuse** (Tenet-21): `resolveSelectionRule` (corpus) + `resolveSplit` (the validated ancestry-cut split with its fail-loud cover/disjointness guards) + `enumeratePrMetas` + `computeFixtureSha`.
- **Strict write-side** (fold-1): `targetRuleId` is structurally required for positive controls and forbidden otherwise — the producer never relies on the permissive consumer schema, so a positive control can't silently lose its non-vacuity target.
- **Two-phase sealed lock** (fold OQ-seq): the producer writes the lock WITHOUT `llmReplaySha` (it can't know it — `record` runs after); `freeze` seals it.
- **pr-diffs integrity digest** (fold-2): a new additive-optional `controls.integrity.prDiffsSha` (sha256 over the canonical `pr-diffs.json`) closes the hole that `fixtureSha` (control-dirs-only) leaves on the independently-loaded scoring source. The producer computes + stamps it; the freeze/run hard-enforcement is the immediate fast-follow.
- **Fail-loud git** (fold-3): producer-owned diff resolution throws on git faults and rejects an empty diff for a code-touching PR (no silent-empty frozen fixture), unlike the advisory `git.ts` helpers.
- **Amendment-C double-guard** (fold-4): a contradictory seed (a control outside the corpus, or tagged both positive+negative) fails loud before emit.

Byte-deterministic at a fixed asOfCommit+seed (canonical sorted-key JSON, forward-slash paths, `git hash-object`, no timestamps in fixtures). Tested with a programmatic git fixture (real `git init`, pinned dates) over the direct-to-main / malformed-`(#abc)` / revert-pair / multi-file / empty-diff matrix; the produced output passes the actual freeze gate (S4 completeness + C6 integrity) end-to-end.
