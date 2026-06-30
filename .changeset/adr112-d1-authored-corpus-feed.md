---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-112 §6/§8/§9 Slice D1 — wire the authored producer into the Gate-1 certifying corpus (inert-until-D3, strategy#591/#661).

The authored producer (`runRuleAuthor` → `toCompileFeed` → `runCompileStage` → the inert `deriveAuthoredControls`) was fully built but unconnected to the cert corpus. D1 connects it via a SIBLING assembler + provider (not a branch in the mined path — the mined `buildCertifyingCorpus` stays byte-unchanged):

- **`buildAuthoredCertifyingCorpus`** (new, `@mmnto/cli`) assembles an authored-provenance `CertifyingCorpus` from `.totem/spine/authored-rules.yaml`: `runRuleAuthor` (preserving the §3/§8 producer invariants — no ad-hoc records) → `rejected.length === 0` precondition → file/ledger **split-binding verification BEFORE compile** (every record's authoring-ledger `splitRef` must equal this run's split, with `authoredAfterSplit` + `heldOutNonInspectionAttestation` — the §5 leakage guard `deriveAuthoredControls`'s train-side check alone cannot cover) → `toCompileFeed` → `runCompileStage` (**authored compile-rejection = hard failure**) → homogeneous-authored assembly from the `c.provenance` sidecar → `deriveAuthoredControls`. Every gap fails loud (Tenet-4).
- **`buildAuthoredCorpusProvider`** + **`resolveCertifyingCorpusProvider`** (new, `@mmnto/cli`) — the single dispatch home: pick the mined replay provider vs the authored sibling off the lock's `producerKind` (absent ⇒ mined), so no `kind` branch is scattered downstream. The mined branch is byte-unchanged.
- **`CertifyingCorpus.authoredControls?`** (new channel, `@mmnto/cli`) — the §6 emission lists, present iff the corpus is authored-provenance (defined-with-empty-arrays for an authored corpus with no emitting fixtures; `undefined` for mined).
- **`deriveAuthoredControls`** (`@mmnto/totem`) now reads provenance from a required `provenanceByRule` sidecar map, never `rule.legitimacy` (absent at the assembly seam — stamped only post-scoring).
- **`WindtunnelLock.producerKind`** (`@mmnto/totem`) — additive-optional `'mined' | 'authored'` dispatch signal; absent ⇒ mined, so every existing lock parses + serializes byte-unchanged.

INERT: nothing in scoring/persist/report consumes `authoredControls` yet (the engine reads only rules/prDiffs/groundTruth/provenanceByRule) — D3 (`scoreAuthoredWindtunnel`) + D4 (Gate-2 eligibility/report) consume it. The authored cert-run INPUT wiring (lock-sourced `judgedBy` / `splitRef` + an authored fixture-substrate loader) lands in D2; until then the resolver fails loud if a lock declares `producerKind: 'authored'` without authored deps.
