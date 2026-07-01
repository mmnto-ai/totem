---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-112 §6/§5.3 Slice D2.6 — window-wide answer-key deriver for the AUTHORED producer.

Under `producerKind:'authored'`, the cert-run answer key (`ground-truth-labels.json`) must be derived WINDOW-WIDE (train ∪ held-out non-control), not held-out-only. Authored positive controls are train-side, so a held-out-only key leaves their corpus firings unlabeled → `needsAdjudication` → a run that can never PASS (permanent HONEST-NEGATIVE; totem-agy's D2 mechanical proof). This is the §6 follow-on split out of D2.5.

- **`corpusWindowPrs(split)`** (`@mmnto/cli`, `spine-fetch-dispositions`): pure sibling of `corpusHeldOutPrs` = `(trainPrs ∪ heldOutPrs)` minus the positive/negative controls, deduped + ascending. `fetch-dispositions` branches on `producerKind` (authored → window-wide dispositions; mined → held-out-only, byte-unchanged) with a scope-aware empty-check message + log.
- **`assembleAuthoredCertifyingCorpus(opts, lock)`** (`@mmnto/cli`, `spine-cert-run-corpus`): the derive-path sibling of `assembleCertifyingCorpus`. Loads the authored substrate with ground-truth SKIPPED (the deriver PRODUCES the key — circularity guard) while still hash-binding the scoring source (`prDiffsSha`), then builds via the existing `buildAuthoredCertifyingCorpus` (which owns the §8 ledger-sourced `judgedBy`). `loadAuthoredCertRunFixtures` gains an additive `skipGroundTruth` param (parity with the mined `loadCertRunFixtures`).
- **`derive-labels`** (`@mmnto/cli`): producerKind-aware — an authored lock assembles via the authored sibling (window-wide firings over the authored substrate); a mined lock is byte-unchanged. Adds an injectable `totemDir` (defaults to the `.totem/spine/gate-1` convention).

The RUN-path §8 single-home dispatch (`resolveCertifyingCorpusProvider`) is UNTOUCHED — the producer commands (`fetch-dispositions` / `derive-labels`) read `producerKind` at the command layer, mirroring how the mined deriver already bypasses the resolver (gemini single-home ruling holds; strategy 2026-07-01 additive-sibling ruling, no §8 re-decision owed). Contract settled in ADR-112 §6/§5.3 — no new core ruling. Still INERT until D3; no production authored lock exists. closingRefs [].
