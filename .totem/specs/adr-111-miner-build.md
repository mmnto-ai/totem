# Totem-side Spine Gate-1 Rule-Mining Miner — Build Spec (ADR-111 producer)

**Contract source of truth:** `git -C D:/Dev/totem-strategy show origin/main:adr/adr-111-spine-gate-1-rule-mining-miner.md` (merged squash `1b2aa3d`). Supporting: ADR-091 (5-stage funnel), ADR-110 (acceptance/read-side), ADR-103 (compiler), ADR-089 (zero-trust mint).
**Supersedes:** the untracked pre-author design `.totem/specs/adr-111-gseries-miner.md` (4-clause FM, single ledger, no disjoint-cover) — the merged ADR is materially stricter; build to the merged contract.
**Grounded:** 2026-06-18 via two parallel grounding sweeps (strategy contract + totem code-map). `totem spec` deliberately skipped (cross-repo-ADR-driven → confabulation risk, per #2172/0103).

## What the miner is

The **producer** member of the ADR-103 G-series (sibling to ADR-110's acceptance member): `(merged lc PR + review thread + commit SHA) → CandidateRuleRecord carrying provenance + classifier disposition + DSL source, minted unverified/Yellow, no hand-curation`. Inherits ADR-091's `Extract → Classify → Compile → Verify-Against-Codebase → Activate` funnel by reference. Unblocks the certifying run (`mmnto-ai/totem#2189 item 1`). It is the un-started keystone; all scaffolding (ruleClass marker #2183, selectionRule resolver #2189 item 2, wind-tunnel #2188) is shipped.

## Overall architecture + slicing map

| Slice            | Scope                                                                                                                                                                                                                                      | LLM? | Status                               |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---- | ------------------------------------ |
| **1 (this doc)** | Deterministic foundation: `CandidateRuleRecord` envelope + frozen three-way split artifact + five ledgers + **zero-LLM CI falsification harness** asserting all 9 FM clauses, driven by hand-built fixtures (the #2188 mock-first pattern) | no   | **designed here**                    |
| 2                | Stage-1 Extract heuristics (review-thread → draft DSL) — LLM draft-only                                                                                                                                                                    | yes  | deferred (ADR-111 defers heuristics) |
| 3                | Stage-2 Classify gate (structural/behavioral) — LLM draft-only, Stage-4-backstopped                                                                                                                                                        | yes  | deferred                             |
| 4                | Stage-3 Compile (ADR-103, inherited) + Stage-4 Verify-Against-Codebase wiring (mostly shipped #1682)                                                                                                                                       | no   | deferred                             |
| 5                | Certifying-run consumption — wire real miner output into `spine windtunnel run` (#2189 item 1)                                                                                                                                             | no   | deferred (blocked on slices 2–4)     |

Slice 1 makes the entire contract testable before the feasibility-risky LLM work, mirroring how #2188 shipped harness-only with a mock engine.

---

## Implementation Design (Slice 1)

### Scope

Build the deterministic producer foundation — the `CandidateRuleRecord` Zod envelope, the frozen three-way split artifact + pure `resolveSplit()` resolver, the five execution-ledger schemas + writers, and the zero-LLM CI harness that asserts all nine ADR-111 Falsifying-Metric clauses (a)–(i) against the ledgers, exercised by committed pass/fail fixture candidate sets. **Will NOT** wire any real LLM extractor or classifier, the ADR-103 compile stage, Stage-4 codebase verification, or the certifying-run consumption — those are slices 2–5; slice 1 locks the contract as red-fixture-proven invariants using fixtures, not a live producer.

### Data model deltas (all new, `packages/core/src/spine/`)

- **`CandidateRuleRecord`** (`spine/candidate-rule.ts`) — the miner's **sole output envelope** (distinct from `CompiledRule`).
  - Holds: `provenance` (**reuse the live `ProvenanceRecordSchema`** `{mergedPr, reviewThread, commitSha}` — see OQ2), `classifierDisposition: 'structural' | 'behavioral'`, `classifierLedgerRef: string`, `dslSource: string`, `unverified: z.literal(true)`.
  - Writes: the miner (Stage 1/2). Reads: ledger writers + (slice 4) the Compile/projection step.
  - Invariants: all three provenance fields present (schema-enforced, mirrors live constraints — `mergedPr` positive int, `reviewThread` non-empty non-mutating `.refine`, `commitSha` `/^[0-9a-f]{40}$/` lowercase); `unverified` literally `true`; it does **not** carry `legitimacy`/`ruleClass` (stamped downstream by the wind-tunnel).
- **`SplitArtifact`** (`spine/split.ts`) — `{ asOfCommit, trainPrs: number[], heldOutPrs: number[], excludedPrs: number[], positiveControlPrs: number[], negativeControlPrs: number[], splitRule }`.
  - Writes: pure `resolveSplit(metas, selectionConfig, cutParam)` at freeze. Reads: split-ledger + harness.
  - Invariants: `trainPrs ⊎ heldOutPrs ⊎ excludedPrs` deep-set-equals `selectionRule(asOfCommit)` (reuse `prSetsEqual`); controls ⊆ `heldOutPrs`; train/heldOut disjoint by PR# **and** merge-commit; ancestry-forward cut (train = older topo segment).
- **Five ledgers** (`spine/ledgers.ts`): `EmissionLedger` (per-candidate provenance/disposition/routing/`unverified` + run-level `extractionInputsAttestation: { seedClassesProvided: boolean }`), `DropLedger` (`{ partial, reasonCode: 'unreachable'|'truncated'|'unparseable'|'incomplete-provenance' }` — **sole** disposition for any content/provenance failure), `ClassifierLedger` (`{ candidateRef, disposition, stage4Confirmed }`, reported in the done-criterion), `SplitLedger` (the disjoint-cover reconciliation + disjointness proof), `ApiUsageLedger` (`{ targetPr, slice: 'train'|'heldOut', fetchKind }[]` + `heldOutFetchCount: number`).
  - Writes: each stage owns its ledger. Reads: the CI harness only.

### State lifecycle

- **`SplitArtifact` — persistent + frozen.** Committed under `.totem/spine/gate-1/split.lock.json` (sibling to `windtunnel.lock.json`). Created by `resolveSplit()` at split-freeze, **before extraction**; never mutated after freeze (frozen-before-window discipline, parallel to ADR-110's frozen-N). Read-only thereafter.
- **The five ledgers — per-run.** Created at run start, written append-only per-stage, finalized at run end, consumed read-only by the harness. Each stage owns its writes; nothing re-mutates a finalized ledger.
- **`CandidateRuleRecord[]` — per-run**, in-memory → emitted, flowing Stage-1 → Stage-2 → emission/drop ledger.
- **The seam to get right:** the split is _persistent/frozen_ but the ledgers are _per-run_ — FM(i) asserts a per-run ledger (every `trainPr` in emission XOR drop) against the _frozen_ split, and **FM(e)'s emission half asserts the converse direction** (every emitted candidate's `provenance.mergedPr ∈` the frozen `trainPrs`). Both are frozen-split ↔ per-run reconciliations — the classic "flag consumed across lifecycle" hazard; the harness reconciles them explicitly, no shared mutable flag.

### Failure modes

| Failure                                                                                  | Category           | Surface                                                               | Recovery                                                                                                   |
| ---------------------------------------------------------------------------------------- | ------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Split cover ≠ `selectionRule(asOfCommit)`                                                | init               | hard error (`TotemError`)                                             | freeze blocked until cover total; diagnostic **disambiguates direction** — extra ⇒ FM(d), omission ⇒ FM(g) |
| train/heldOut overlap (PR# or merge-commit)                                              | init               | hard error                                                            | split rejected at freeze (FM(e) **split** half)                                                            |
| emitted candidate sourced from a held-out/excluded PR (`provenance.mergedPr ∉ trainPrs`) | contract violation | harness **hard-fails** (FM(e) **emission** half)                      | fix emitter corpus-scoping; no silent pass                                                                 |
| review-thread unreachable for a train PR                                                 | runtime            | loud drop → `DropLedger('unreachable')`                               | candidate dropped, run continues, count surfaced                                                           |
| content present-but-incomplete (empty / unparseable / <1 comment)                        | runtime            | loud drop → `DropLedger('truncated'\|'unparseable')`                  | dropped, same path                                                                                         |
| incomplete provenance tuple                                                              | runtime            | loud drop → `DropLedger('incomplete-provenance')`; never emit partial | dropped (Tenet 4, FM a)                                                                                    |
| behavioral candidate routed to compile                                                   | contract violation | harness **hard-fails** the run (FM c)                                 | fix routing; no silent pass                                                                                |
| any content fetch against a held-out PR                                                  | contract violation | harness hard-fails (`heldOutFetchCount > 0`, FM h)                    | —                                                                                                          |
| seed class supplied to any extract/classify stage                                        | contract violation | harness hard-fails (`seedClassesProvided === true`, FM f)             | —                                                                                                          |
| `trainPr` in neither emission nor drop ledger                                            | contract violation | harness hard-fails (FM i)                                             | —                                                                                                          |
| candidate minted non-`unverified`                                                        | contract violation | harness hard-fails (FM b)                                             | —                                                                                                          |

No silent-degradation rows — every content/provenance failure resolves to a loud drop-ledger entry (Tenet 4 satisfied by drop-as-sole-disposition).

### Invariants to lock via tests

- Split is a three-way disjoint cover of `selectionRule(asOfCommit)` — nothing unaccounted, nothing double-counted, controls ⊆ heldOut. The cover check **disambiguates direction** in its diagnostic — an out-of-corpus extra ⇒ FM(d), a silent omission ⇒ FM(g) — so each clause has a red fixture failing on _exactly_ it (not a generic "cover ≠").
- **FM(e) — two halves, both covered** (split-disjointness alone is necessary-not-sufficient; per strategy-claude 0308Z): _(split half)_ train and heldOut disjoint by **both** PR# and merge-commit, a revert pair never straddles the cut; _(emission half — must-fix)_ **∀ emitted `CandidateRuleRecord`: `provenance.mergedPr ∈ trainPrs`** — no candidate sourced from a held-out/excluded PR (disjoint sets can still emit a held-out-sourced candidate — leakage at _emission_, not _split_, time). The content-derived-from-held-out sub-clause is caught by FM(h)'s `heldOutFetchCount`; this assertion catches the provenance-PR-not-in-train sub-clause.
- The ancestry cut is forward-chronological (train strictly-older in topo-order) and commit-date-independent.
- A candidate missing any provenance field is dropped, never emitted (FM a).
- Every emitted candidate has `unverified === true` literally (FM b).
- A behavioral candidate never reaches compile-routed output and always carries a classifier-ledger entry (FM c).
- Every `trainPr` appears in exactly one of {emission, drop} (FM i).
- `ApiUsageLedger.heldOutFetchCount === 0` (FM h); emission ledger carries the seed-blindness attestation (FM f).
- **Per-clause red fixtures:** for each of the 9 FM clauses, a hand-built failing fixture makes the harness fail on _exactly_ that clause (plus a green fixture that passes clean). **FM(e) gets two** red fixtures (split-disjointness + emission-membership); the (d)/(g) fixtures rely on the direction-disambiguated cover diagnostic. This is what makes slice 1 a real contract lock without an LLM (the #2188 control-fixture discipline).

### Open questions

1. **Slicing (lead).** Build sliced (slice-1 = this deterministic foundation + harness, then LLM Extract/Classify, then Compile/Verify, then certifying-run) or one mega-PR?
   - _Sliced:_ contract locked + red-fixture-proven before feasibility-risky LLM work; mirrors #2188/#474; smaller review surface per PR.
   - _Mega-PR:_ everything at once — large, high bot-review risk, can't test the contract until the LLM works.
   - **Rec: sliced**, slice-1 exactly as scoped here.
2. **`CandidateRuleRecord` provenance field names.** ADR-111 §3 prose says `{sourcePr, reviewThreadRef, mergeCommitSha}`; the shipped `ProvenanceRecordSchema` says `{mergedPr, reviewThread, commitSha}`.
   - _Reuse the live schema:_ one source of truth, direct embed into `legitimacy.provenance` on the slice-4 projection, zero rename seam.
   - _New §3-prose envelope:_ matches the ADR text literally but adds a rename layer at projection.
   - **Rec: reuse the live `ProvenanceRecordSchema`** and flag a one-line ADR-111 prose↔schema erratum/mapping note to strategy-claude (their ADR).
3. **Split artifact home/shape.** **Rec (not gating):** sibling lock `.totem/spine/gate-1/split.lock.json`, `splitRule` extending `SelectionRuleConfig` + the deferred ancestry-cut scalar; same freeze-discipline as the wind-tunnel lock.
4. **Harness fixtures.** **Rec (not gating):** committed per-clause red fixtures + one green, under a `gate-1` control dir mirroring #2188's fixture layout.

### Dispositions

- **Operator 2026-06-18:** approved OQ1 (sliced), OQ2 (reuse live schema), OQ3/OQ4 (recs).
- **strategy-claude contract lens (0308Z, independent):** FAITHFUL DISCHARGE of the merged ADR-111. Two folds applied above — **(must-fix)** FM(e) emission-membership assertion `∀ emitted: provenance.mergedPr ∈ trainPrs` + its own red fixture, distinct from split-disjointness; **(should-fix)** FM(d)/(g) direction-disambiguated cover diagnostic. Concurred OQ1/3/4. **strategy-claude owns the ADR-111 §3 prose↔schema erratum** (separate fast-follow on their ADR; reuse-live-schema is canonical, non-blocking on this build).
- **Pending before build:** cohort pre-build panel (codex / agy / gemini _iff_ its CLI survives the business-user test) + operator post-test greenlight.
