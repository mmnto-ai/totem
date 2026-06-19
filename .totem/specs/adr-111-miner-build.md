# Totem-side Spine Gate-1 Rule-Mining Miner — Build Spec (ADR-111 producer)

**Contract source of truth:** `adr/adr-111-spine-gate-1-rule-mining-miner.md` on `mmnto-ai/totem-strategy@main` (merged squash `1b2aa3d`). Supporting: ADR-091 (5-stage funnel), ADR-110 (acceptance/read-side), ADR-103 (compiler), ADR-089 (zero-trust mint).
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
- **The seam to get right:** the split is _persistent/frozen_ but the ledgers are _per-run_ — FM(i) asserts a per-run ledger (every `trainPr` in emission ∪ drop — **at-least-one**, since one PR may yield both an emitted and a dropped candidate) against the _frozen_ split, and **FM(e)'s emission half asserts the converse direction** (every emitted candidate's `provenance.mergedPr ∈` the frozen `trainPrs`). Both are frozen-split ↔ per-run reconciliations — the classic "flag consumed across lifecycle" hazard; the harness reconciles them explicitly, no shared mutable flag.

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
- Every `trainPr` appears in **at least one** of {emission, drop} (FM(i) — the ADR violation is "processed by _neither_"; a PR may legitimately be in both, one candidate emitted and another dropped). Every drop carries a required `sourcePr` so it is creditable here.
- Positive and negative control tags are disjoint — a PR is never both a positive and a negative control.
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
- **Cohort panel (pre-merge #2200, post-build):** **gemini** APPROVE (tenet/architecture) · **agy** PASS (build/test-completeness) · **codex** CONCERN → 5 folds applied: (1) reject duplicate rows in the split slices/corpus at the schema boundary (the cover/overlap checks dedupe via Set); (2) `resolveSplit` requires `0 < cutIndex < size` (non-empty train **and** held-out); (3) **FM(h) derives the fetch partition from the frozen split**, not the self-declared `slice` label, and recomputes `heldOutFetchCount`; (4) `provenance.commitSha` must equal the PR's frozen merge commit (`corpusMergeCommits`); (5) Stage-4 attestation documented as **slice-4-deferred / non-certifying in slice 1**.
- **§5 `excludedPrs` scope — model A, CONFIRMED by strategy-claude (0508Z).** `corpus` is the cover base that **includes** the PRs later assigned to `excludedPrs` (reverts retained, enumerated explicitly), so `train ⊎ heldOut ⊎ excluded == corpus`; the fail-loud `excludedPrs ⊆ corpus` guard enforces it. strategy-claude pinned the precise oracle: cover base = `selectionRule(excludeRevertPairs:false)`; scoring corpus `train ⊎ heldOut = selectionRule(excludeRevertPairs:true)` (unchanged from ADR-110 §6); `excludedPrs == selectionRule(false) \ selectionRule(true)` (the **exact** revert delta, asserted explicitly so a future non-revert entry fails loud). The three-way assert against the two `selectionRule` flag-settings lands at **slice-2+ `selectionRule` wiring**, not slice 1 (`resolveSplit` takes `corpus` as input and does not call `selectionRule`); slice 1 needs no rework. strategy-claude owns the §5 prose codification (fast-follow after their #692).

---

## Implementation Design (Slice 2 — Stage-1 Extract)

**Grounded:** 2026-06-19 via the slice-1 envelope/ledger code + a prior-art sweep (ADR-058 pipelines, legacy `lesson extract`/`compile`, `lesson-pattern.ts` compile-side parser, the CLI `PrAdapter` review-thread fetch, `Stage4VerifierDeps` DI pattern, ADR-095 resolved-thread trap). `totem spec` skipped (cross-repo-ADR-driven → confabulation risk, per #2172/0103).

### Scope

Build the **deterministic Extract-stage scaffolding**: iterate the frozen split's **train slice only**, fetch+parse each PR's review thread through an **injected port**, run a completeness check, draft a `dslSource` through an **injected `DraftExtractor` port**, and produce either a pre-classifier `DraftCandidate` intermediate **or** a loud drop — writing the **drop** + **API-usage** ledgers + the run-level seed-blindness attestation. Will **NOT**: classify structural/behavioral or mint a full `CandidateRuleRecord` (slice 3), compile/verify the drafted DSL (slice 4), wire the certifying run (slice 5), or use the production LLM prompt as a test oracle — all tests run a **deterministic fixture extractor** (the slice-1 #2188 mock-first discipline); the live LLM adapter is a thin port impl whose inclusion is OQ2.

### Data model deltas (all new, `packages/core/src/spine/extract.ts` unless noted)

- **`DraftCandidate`** — the pre-classifier **internal/transient** intermediate (NOT a contract type, NOT persisted): `{ provenance: ProvenanceRecordSchema, dslSource: <non-empty string> }`. Writes: Extract stage. Reads: slice-3 classifier, which maps `DraftCandidate → CandidateRuleRecord` by adding `classifierDisposition` + `classifierLedgerRef`. Invariant: complete provenance tuple + non-empty `dslSource`, else dropped (never a partial). It does **not** weaken ADR-111 §3's "CandidateRuleRecord is the miner's sole _output_" — `DraftCandidate` is a build-internal funnel stage, never emitted.
- **`ReviewThreadContent`** — the parsed shape the fetch port returns: `{ pr, mergeCommitSha, threads: { path, comments: { author, body }[] }[] }` (mirrors the CLI `groupIntoThreads`/`StandardReviewComment`).
- **Injected ports** (core-defined interfaces, CLI-implemented — dependency inversion mirroring `Stage4VerifierDeps`; keeps core network-free + LLM-free + deterministic):
  - `ReviewThreadSource.fetch(pr) → Promise<FetchResult>` where `FetchResult` discriminates `ok` / `unreachable` / `unparseable` (the §6 distinction between never-fetched and fetched-but-unusable)
  - `DraftExtractor.draft(content) → string[]` (**list-shaped per fold 1** — zero-or-more draft bodies, since one thread can carry multiple structural invariants; the LLM lives behind this at the CLI layer, a fixture impl in tests).
- **`dslSource` format = lesson-markdown body** in the `lesson-pattern.ts` convention (`**Pattern:**` flat/`yaml` + `**Engine:**`/`**Scope:**`/`**Severity:**`/`### Bad Example`). See OQ1 — this is the load-bearing choice. The Extract LLM's task is "fill a structured rule template from the thread," not "invent a pattern from English."
- **Ledger writers** (schemas already shipped in slice 1, `ledgers.ts`): `DropLedger` (4 reason codes) + `ApiUsageLedger` (train fetches; `heldOutFetchCount` stays 0). Extract owns exactly these two; emission + classifier ledgers are slice 3, split ledger is slice 1 (read-only here).

### State lifecycle

- **`ReviewThreadContent` / `DraftCandidate[]`** — per-run, in-memory, transient; flow Extract → (slice-3) Classify or → drop. Never persisted.
- **`DropLedger` + `ApiUsageLedger`** — per-run, append-only, finalized at stage end, consumed read-only by the harness. Extract is the sole writer.
- **Frozen `SplitArtifact`** — read-only input; its `trainPrs` drive iteration. Cross-lifecycle seam: Extract reads the _frozen_ train slice but writes _per-run_ ledgers. FM(i) ("every `trainPr` in emission ∪ drop") is only **fully** assertable once slice 3 adds the emission side; in slice 2 the harness coverage is **drop-side + draft-carry accounting** — for each `trainPr`, `draftCount(pr) + dropCount(pr) >= 1` (a PR may yield **N** drafts and/or **M** drops; only zero-and-zero is the failure; see fold 1), documented as the slice-2 half of FM(i).

### Failure modes

| Failure                                                                                              | Category           | Surface                                                                                                                   | Recovery                                           |
| ---------------------------------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| review thread unreachable (port returns `null`)                                                      | runtime            | loud drop `DropLedger('unreachable')`                                                                                     | dropped, run continues, count surfaced             |
| thread present-but-empty / `<1` comment                                                              | runtime            | loud drop `DropLedger('truncated')`                                                                                       | dropped, same path                                 |
| thread unparseable, or `DraftExtractor` returns empty/whitespace                                     | runtime            | loud drop `DropLedger('unparseable')`                                                                                     | dropped — never a thinner/degraded extraction (§6) |
| provenance tuple incomplete (missing/invalid merge-commit SHA, or fetched content PR ≠ requested PR) | runtime            | loud drop `DropLedger('incomplete-provenance')`; `sourcePr` always known                                                  | dropped, never partial-emit (Tenet 4 / FM a)       |
| a fetch targets a held-out/control/excluded PR                                                       | contract violation | **impossible by construction** — iterate the train slice only; `ApiUsageLedger.heldOutFetchCount` asserted `=== 0` (FM h) | —                                                  |
| seed class reaches the extractor                                                                     | contract violation | seed-blindness attestation `seedClassesProvided === false` (FM f) carried for slice-3 emission                            | —                                                  |
| resolved/superseded thread mined as if live (ADR-095)                                                | quality            | OQ3 (not a blast-radius issue — all output is `unverified`/Yellow + Stage-4-backstopped)                                  | OQ3                                                |

No silent-degradation rows — every content/provenance failure is a loud drop-ledger entry.

### Invariants to lock via tests (deterministic, fixture extractor)

- Extract calls the fetch port for **train PRs only** — never for any heldOut/excluded/control PR; `ApiUsageLedger.heldOutFetchCount === 0` (FM h preserved at the Extract stage).
- Each of the 4 drop reason codes has a fixture routing to **exactly** it; a dropped candidate is never also carried as a `DraftCandidate`; every drop carries its `sourcePr`.
- The completeness check rejects empty / `<1`-comment / unparseable threads as a loud drop, never a thinner extraction.
- A carried `DraftCandidate` always has a complete provenance tuple **and** non-empty `dslSource` (else dropped).
- Train-slice accounting (slice-2 half of FM i): **every** `trainPr` has `draftCount(pr) + dropCount(pr) >= 1` — a PR may yield N drafts and/or M drops, a single attempt is never both, only zero-and-zero is a failure; none silently skipped (fold 1).
- Seed-blindness: the `DraftExtractor` is never handed a seed class; `seedClassesProvided === false`.
- Determinism: identical inputs + fixed mock deps → identical drops/drafts/ledgers (the slice-1 mock-first guarantee survives the first LLM stage via the port boundary).

### Open questions

1. **`dslSource` draft format.**
   - _(a) Structured lesson-markdown body_ — explicit `**Pattern:**` (regex/ast-grep) and/or `### Bad Example`/Good. Compile (slice 4) rides ADR-058 **Pipeline 1/3** vs Pipeline 2's ~20%. **Mechanically raises structural compile yield; does NOT address signal density or behavioral classification** (those are the Classifier + Stage-4's job — Tenet 19, fold 2). The LLM fills a structured template rather than inventing a pattern from English — and the body is `unverified`/Stage-4-gated, NOT Pipeline-1-trusted (fold 3).
   - _(b) Free English prose_ — Compile falls to ADR-058 **Pipeline 2** (English→LLM→pattern, ~20% — the 0–31% failure).
   - _(c) Structured `CompilerOutput` JSON_ — bypasses the lesson-body convention; more brittle to draft, duplicates the compile schema.
   - **Recommendation: (a).** It is the single biggest feasibility lever and reuses the shipped `lesson-pattern.ts` parser unchanged.
2. **Live LLM adapter — in slice 2, or split to slice 2b?**
   - _(a) Scaffolding + ports + fixture extractor only_ (no real LLM in slice 2) — mirrors slice-1 exactly; slice 2 stays fully deterministic + CI-locked; the decaying prompt lands later, closest to where it is first _needed_ (the slice-5 certifying run).
   - _(b) Include the live LLM `DraftExtractor` now_ — slice 2 extracts something real end-to-end, at the cost of a non-deterministic, prompt-decaying component shipped early.
   - **Recommendation: (a).** Lowest-risk; every slice stays green-by-construction; the port boundary makes the live adapter a later non-breaking add.
3. **Resolved/superseded review threads (ADR-095 trap).** The REST `StandardReviewComment` carries no `isResolved`/`outdated`.
   - _(a) Add a GraphQL `reviewThreads.isResolved` fetch + filter resolved-rejected threads at the port now._
   - _(b) Accept all threads in slice 2, document the limitation, mitigate later._ Unlike ADR-095's enforced-rule contamination, here every candidate is `unverified`/Yellow + Stage-4-backstopped + wind-tunnel-scored against held-out controls → **0 blast radius**, signal-quality only.
   - **Recommendation: (b) for slice 2, (a) tracked as a fast-follow ticket.** The fetch-port boundary makes adding resolution-filtering a non-breaking change. Flag for the cohort panel — codex may push for (a) now.

### Placement (decided, not open)

Deterministic orchestration + completeness check + ledger writers live in `packages/core/src/spine/` (network-free, LLM-free, deterministically testable). The GitHub fetch + LLM draft are **injected ports implemented in `packages/cli`** — the established `Stage4VerifierDeps` callback-DI pattern. Core never imports a CLI adapter.

### Panel verdicts + folds (pre-build, 2026-06-19)

Four-seat cohort panel, all independent (#2167 independence doctrine), **all APPROVE/PASS — convergent, no blockers**; my 3 self-flagged uncertainties were each validated.

- **codex** (contract/correctness): **CONCERN → spec-folds** — FM(i) over-tight; lesson-markdown is syntax-not-trust; `unparseable` needs widening.
- **gemini** (tenet/architecture): **APPROVED w/ 1 fold** — the Tenet-19 0–31% overclaim. Core-vs-cli placement "architecturally flawless"; Tenet-15 determinism PASS; decomposition coherent.
- **agy** (build/test-completeness): **PASS w/ 3 folds** — bot-comment filter, OQ3 fast-follow, strict train-boundary spy. Slice-2↔slice-3 decoupling "perfect."
- **strategy-claude** (ADR-111 fidelity): **FAITHFUL DISCHARGE / APPROVE** — **0 must-fix on slice 2**; 2 binding flags land on _downstream_ slices + 2 sharpenings.

Folds applied to the build plan (**authoritative** over the inline text above where they conflict):

1. **FM(i) — at-least-one, list-shaped [codex].** For each `trainPr`: `draftCount(pr) + dropCount(pr) >= 1`; a PR may yield **N** drafts and **M** drops; one attempt is never both; only zero-and-zero fails. → `DraftExtractor.draft(content) → string[]` (list-shaped now); `runExtractStage` flat-maps per PR. Tests: 2-drafts-from-1-PR, draft+drop-from-1-PR, drop-only-PR, silently-skipped-PR fails.
2. **OQ1 claim narrowed — no "0–31% dodge" [gemini].** lesson-markdown **mechanically raises structural compile yield** (Pipeline 1/3 vs 2); it does **NOT** address signal density or behavioral classification — those are the Classifier (slice 3) + Stage-4's job. A syntactic-yield lever, not a feasibility solve (Tenet 19).
3. **lesson-markdown = syntax, NOT Pipeline-1 trust/provenance [codex + strategy flag-3, BINDING on slice 4].** The miner's body is LLM-drafted/`unverified`. Slice-4 Compile MUST route it through **ADR-103's NEW G-series compiler** forcing ADR-111/ADR-089 semantics (`unverified:true`, classifier provenance retained, Stage-4 required, **no manual-rule/Pipeline-1 trust bypass**) — and MUST NOT re-enter the **frozen** legacy `totem lesson compile` actuator (freeze violation; reusing the _format/parser_ is fine). Pin this seam in the slice-4 design.
4. **`unparseable` widened + syntactic preflight [codex].** `unparseable` = thread parse failures + empty/whitespace extractor output + **non-empty-but-not-valid-lesson-markdown** + caught extractor exceptions/timeouts. A cheap **preflight** against `lesson-pattern.ts`'s shape: a non-empty `dslSource` lacking a usable `**Pattern:**`/yaml pattern is a loud drop, not a success. (No 5th drop code — keep the shipped slice-1 enum.)
5. **Completeness check = human-only comments [agy Fold-1].** `comments.filter(c => !isBotIdentity(c.author)).length >= 1` via the existing `isBotIdentity` in `selection-rule.ts`; bot-only / whitespace-only threads → loud drop `truncated` (prevents CR/greptile noise → hallucinated drafts).
6. **Strict train-boundary spy test [agy Fold-3 + codex].** The test `ReviewThreadSource` mock **throws** on any non-train-PR fetch (`[Totem Error] … non-train PR`); a test forces a held-out fetch and asserts hard-fail. Derive the target partition from the **frozen split** and reconcile `ApiUsageLedger` against it — never trust the `slice` label / `heldOutFetchCount` alone.
7. **OQ3 fast-follow = before-promotion gate [agy Fold-2 + strategy flag-4, BINDING].** The resolution-filtering ticket (GraphQL `reviewThreads.isResolved`) is **mandatory before any candidate is promoted past Yellow / before the slice-5 certifying run** — not merely "later." Deferral cost is extra wind-tunnel adjudication of resolved-thread FPs (controls correctly down-score them) — a precision/cost lever, not a correctness loss.
8. **Seed-blindness single-home [strategy #2, Tenet 20].** Slice 2 **establishes/carries** `seedClassesProvided === false` in-run (enforces + tests that the `DraftExtractor` is never handed a seed — where FM(f)'s property binds); slice 3 **serializes** it into the §8 emission ledger. One persisted home, no second competing store. (Scope line above amended in spirit: slice 2 carries, slice 3 persists.)
9. **Optional, deferred (not slice-2) [strategy #1].** Splitting an `empty` reason code from `truncated` would let the §8 HONEST-NEGATIVE report distinguish "lc threads are thin" from "fetch is breaking." Deferred — would churn the shipped slice-1 enum; revisit if the terminal report needs the granularity.

**Pre-build status:** design folded + panel-blessed (4/4 approve). Two new fast-follow tickets to file (resolution-filtering before-promotion gate; the slice-4 frozen-actuator seam is a slice-4-design note, not a ticket). **Build gated on operator greenlight.**

---

## Implementation Design (Slice 3 — Stage-2 Classify)

**Grounded:** 2026-06-19 via the slice-1 envelope/ledger code (`candidate-rule.ts`, `ledgers.ts`), the slice-2 Extract output (`extract.ts` — `DraftCandidate`, `ExtractStageResult`), the §8 harness (`miner-harness.ts` — `checkClassifierRouting`/`checkEmissionMembership`/`checkSeedBlindness`/`checkTrainCoverage` already shipped, plus the `greenLedgers()` fixture = the exact output shape), and ADR-111 §3/§4/§6/§7/§8 + ADR-091 Stage-2 (`is this a syntactic invariant → compile, or behavioral → RAG-only?`). `totem spec` skipped (cross-repo-ADR confabulation risk, per #2172/0103).

### Scope

Build the **deterministic Stage-2 Classify gate**: consume slice-2's transient `DraftCandidate[]`, run each through an **injected `DraftClassifier` port** (LLM-draft-only) to a `structural | behavioral` disposition, **mint the §3 `CandidateRuleRecord`** (provenance + dslSource carried verbatim, `unverified: true`, classifier disposition + ledger ref), and write the **emission** + **classifier** ledgers — with `routing` **derived** from disposition (`structural→compile`, `behavioral→rag-only`) and the run-level seed-blindness fact serialized into the emission ledger's `extractionInputsAttestation` (slice-2 fold 8, single home). Will **NOT**: run a live LLM classifier (port + fixture only — OQ2, mirrors slice-2); compile or Stage-4-verify (`stage4Confirmed` stays `false`, flipped in slice 4); project `CandidateRuleRecord → CompiledRule` (slice 4, through the **NEW** G-series compiler, never the frozen `lesson compile` actuator — strategy/codex flag-3); wire the certifying run (slice 5); or **drop** at the classify stage (drops are Extract-only — see OQ1).

### Data model deltas (all new, `packages/core/src/spine/classify.ts` unless noted)

- **`DraftClassifier`** (injected port, core-defined / CLI-implemented — the `Stage4VerifierDeps`/`DraftExtractor` DI pattern): `classify(draft: DraftCandidate) → Promise<ClassifierResult>`, where `ClassifierResult = { disposition: 'structural' | 'behavioral'; dispositionSource: 'classified' | 'error-default' }` parsed through `ClassifierResultSchema` at the core boundary (a non-enum value — or an `error-default` not paired with `behavioral` — fails loud before routing/mint; see fold 1). **Error contract (mirrors `DraftExtractor`'s `[]`-on-failure):** the adapter catches its own LLM/network errors and returns the **safe default `{ disposition: 'behavioral', dispositionSource: 'error-default' }`** (RAG-only — the conservative low-privilege route, Tenet-9; Stage-4-backstopped). It MUST NOT throw for a per-candidate failure; a contract-violating throw propagates loudly (core adds no swallowing catch — Tenet 4). The classifier is **seed-blind** (§7 / FM(f)) — the port is handed only a `DraftCandidate` (provenance + dslSource), no seed channel by construction.
- **`ClassifyStageDeps`** = `{ classifier: DraftClassifier }`. The **run-level** seed-blindness fact is threaded from `ExtractStageResult.seedBlindness` (NOT a separate deps field) and serialized into the emission ledger's `extractionInputsAttestation` — single fact spanning extract+classify per §7 (the classify stage adds no seed channel, so it never flips it).
- **`ClassifyStageResult`** = `{ candidates: CandidateRuleRecord[]; emissionLedger: EmissionLedger; classifierLedger: ClassifierLedger }`. `candidates` is the miner's **sole output** (1:1 with `emissionLedger.entries`); the two ledgers are the CI-observable audit.
- **`dispositionToRouting(d)`** — pure `structural→'compile' | behavioral→'rag-only'`. Routing is **always derived** here, never accepted as input, so emission `routing` and `classifierDisposition` can never disagree (the FM(c) the harness cross-checks).
- **Deterministic refs** — per draft, mint `candidateRef = cand-<mergedPr>-<ordinalWithinPr>` and `classifierLedgerRef = clr-<mergedPr>-<ordinalWithinPr>`; the `ClassifierLedgerEntry.candidateRef` (its own join key) = the `clr-…` ref the emission entry's `classifierLedgerRef` points to (matches the `ledgers.ts` "not necessarily the candidate's own candidateRef" intent + the `greenLedgers()` `c1`/`cl-1` split). Ordinal = position within that PR's draft sub-sequence (deterministic given slice-2's stable order). No `Date.now`/random.
- **(optional) `assembleMinerLedgers(splitLedger, extractResult, classifyResult) → MinerLedgers`** — a thin pure combiner so the §8 harness runs end-to-end on **real** producer output now (the whole point of the slice lock). Full fetch→extract→classify→harness orchestration stays slice 5. See OQ3.

### State lifecycle

- **`CandidateRuleRecord[]` / both ledgers** — per-run, in-memory, built append-only as `runClassifyStage` iterates `drafts`, finalized at stage end, consumed read-only by the harness. Classify is the sole writer of the emission + classifier ledgers; it never re-mutates slice-2's drop/apiUsage ledgers or slice-1's frozen split.
- **Cross-lifecycle seam:** the run-level `seedClassesProvided` is established at **Extract** (slice 2, per-run) and **serialized at Classify** (slice 3) into the _persisted_ emission ledger — the classic "fact established in one stage, persisted in another." One home (the emission ledger), threaded explicitly, no second store (Tenet 20 / fold 8).
- **1:1 invariant:** every input `DraftCandidate` produces **exactly one** emission entry **and exactly one** classifier entry — no draft silently skipped (FM(i), emission side), no double-mint.

### Failure modes

| Failure                                                | Category           | Surface                                                                                                                   | Recovery                                                    |
| ------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| classifier port internal failure (LLM error / timeout) | runtime            | adapter returns safe-default `behavioral` (`rag-only`); never throws per-candidate                                        | candidate emitted behavioral, Stage-4-backstopped (slice 4) |
| classifier returns a non-enum value                    | contract violation | **unconstructible** — `ClassifierDispositionSchema` enum rejects at the `CandidateRuleRecord`/`EmissionLedger` parse      | producer bug fails loud at mint                             |
| behavioral candidate routed to compile                 | contract violation | **impossible by construction** (`routing = dispositionToRouting(disposition)`); harness hard-fails FM(c) if ever desynced | fix derivation                                              |
| emitted candidate not `unverified`                     | contract violation | `z.literal(true)` (FM(b)) — unconstructible                                                                               | —                                                           |
| emitted candidate's provenance PR ∉ train slice        | contract violation | harness FM(e-emission) (provenance carried verbatim from a train-sourced `DraftCandidate`)                                | —                                                           |
| seed class reaches the classifier                      | contract violation | no seed channel by construction; `extractionInputsAttestation.seedClassesProvided` (FM(f))                                | —                                                           |
| a `DraftCandidate` not emitted (silent classify skip)  | contract violation | 1:1 mint; harness FM(i) (with slice-2 drops)                                                                              | —                                                           |
| duplicate `candidateRef` / `classifierLedgerRef`       | integrity          | deterministic per-`(pr, ordinal)` ref; uniqueness asserted in tests; a collision would collapse the classifier-join Map   | —                                                           |

No silent-degradation rows — the only "soft" path (classifier internal failure → `behavioral`) is a **loud, ledgered, low-privilege** disposition that Stage-4 backstops, not a drop or a degrade.

### Invariants to lock via tests (deterministic, fixture classifier)

- Every `DraftCandidate` → exactly one emission entry + exactly one classifier entry; none skipped, none doubled (FM(i) emission side).
- `routing` is **derived** from disposition (`structural→compile`, `behavioral→rag-only`); a behavioral candidate is **never** compile-routed, and emission `classifierDisposition` always equals its joined classifier-ledger `disposition` (both halves of FM(c)).
- The minted `CandidateRuleRecord` carries `provenance` and `dslSource` **byte-verbatim** from the `DraftCandidate`, `unverified === true`, and a non-empty `classifierLedgerRef` that joins to its classifier entry.
- `extractionInputsAttestation.seedClassesProvided` === the run fact threaded from `ExtractStageResult.seedBlindness` (single home, fold 8); a `true` value trips FM(f).
- Classifier safe-default: a mock simulating internal failure yields `behavioral`/`rag-only`, **never** `structural`/`compile`.
- `candidateRef`/`classifierLedgerRef` are deterministic + unique across the run (identical drafts + fixed mock → identical refs/ledgers).
- **End-to-end harness lock:** a real `runClassifyStage` output, combined with slice-2 drop/apiUsage + a slice-1 split ledger, passes `runFalsificationHarness` **green**; and crafted desyncs trip **exactly** FM(c) (behavioral→compile / disposition mismatch), FM(e-emission) (forged provenance PR), FM(f) (`seedClassesProvided: true`), FM(i) (a draft dropped from emission) — the slice-1 control-fixture discipline, now driven by real producer output.

### Open questions

1. **Drop at the classify stage?** Extract already gated usability (complete provenance + `isUsableDsl` preflight), so by the time Classify sees a draft it _is_ a syntactically valid rule body — only the structural/behavioral call remains.
   - _(a) No drop — strictly binary label+route_ (classify always emits; failure → safe-default `behavioral`). Keeps drops Extract-only, keeps the slice-1 drop-reason enum stable (strategy fold 9), FM(i) emission side is a clean 1:1.
   - _(b) Allow classify to drop_ (reject-as-not-a-rule) — needs a 5th drop reason or a reused code, churns the shipped enum, and double-counts the Extract preflight.
   - **Rec: (a).** Strictly binary; no classify drop.
2. **Live LLM classifier adapter — slice 3 or split to 3b?** Mirror slice-2 OQ2.
   - _(a) Port + fixture classifier only_ (no real LLM in slice 3) — slice stays fully deterministic + CI-locked; the decaying prompt lands closest to where it's first needed (slice-5 certifying run); the port boundary makes the live adapter a non-breaking later add.
   - _(b) Include the live LLM classifier now._
   - **Rec: (a).**
3. **Include `assembleMinerLedgers` now, or assemble inline in the end-to-end test?**
   - _(a) Ship a thin pure `assembleMinerLedgers`_ — reusable + unit-testable; the natural home for the "combine the 5 ledgers" seam; slice 5 reuses it for the real run.
   - _(b) Assemble inline in the test only_ — avoids a production seam slice 5 might reshape.
   - **Rec: (a)**, minimal and pure (no orchestration — just struct assembly), explicitly leaving the fetch/extract/classify _driving_ to slice 5.
4. **`classifierLedgerRef` ↔ `candidateRef` scheme.** Distinct `cand-…`/`clr-…` refs (per the `ledgers.ts` "own ref, not necessarily the candidate's" intent), ordinal = position within the PR's draft sub-sequence. Rec as stated; flag if anyone prefers a content-hash ref for stability against draft reordering (deferred — slice-2 order is already deterministic).

### Carried-forward bindings (not slice-3 code, pinned here so they aren't lost)

- **Slice-4 frozen-actuator seam [codex + strategy flag-3, BINDING]:** slice 3 mints the record carrying the `structural` disposition that makes it compile-_eligible_; slice-4 Compile MUST route it through the **new ADR-103 G-series compiler** forcing `unverified:true` + classifier provenance + Stage-4, and **never** re-enter the frozen `totem lesson compile` actuator. Slice 3 adds nothing that presumes the legacy path.
- **#2201 ADR-095 before-promotion gate [agy Fold-2 + strategy flag-4, BINDING]:** resolution-filtering must land before any candidate is promoted past Yellow / before the slice-5 certifying run. Independent of slice 3.

### Dispositions

- **Operator 2026-06-19:** greenlit going forward with the rec'd order (slice 3 → #2201). _Build greenlight pending this design's approval (Phase-4 gate)._
- **Cohort panel (pre-build, 2026-06-19):** four-seat, all independent (#2167). **gemini** (tenet/architecture) **APPROVED — no concerns** (7/7 PASS; OQ1/OQ2 concur). **strategy-claude** (ADR-111 fidelity) **FAITHFUL DISCHARGE + 1 binding flag (flag-5)**; OQ1–4 concur (a); flag-3 confirmed slice-4-binding, flag-4/#2201 independent. **codex** (contract) **CONCERN-with-build-folds**; OQ1/OQ3/OQ4 concur. **agy** (build) **PASS with folds**; OQ3 approve (a).

### Panel verdicts + folds (authoritative over the inline text above where they conflict)

**3-seat convergent binding fold** (strategy flag-5 = codex fold-2 = gemini's Tenet-19 at the ledger level):

1. **Auditable safe-default [BINDING — strategy/codex/gemini].** The error-default `behavioral` must be a **distinct counted state** from a genuine behavioral judgment, else §8's done-criterion conflates structural-sparsity (valid HONEST-NEGATIVE) with classifier-unreliability (false thesis signal, Tenet 19). → The `DraftClassifier` port returns a **result** `{ disposition, dispositionSource: 'classified' | 'error-default' }` (not a bare disposition); core **parses it through a Zod `ClassifierResultSchema` at the boundary** (codex — "non-enum unconstructible" only holds if parsed before `dispositionToRouting`/mint); `dispositionSource` is recorded on the **`ClassifierLedgerEntry`** (additive field on the shipped slice-1 schema — present-and-`'classified'` in normal/fixture runs, set `'error-default'` on the safe-default path, like `stage4Confirmed: false` rides until slice 4). **No new FM clause** (a done-criterion reporting field, not a falsifying condition; the harness FM checks are unchanged, fixtures gain the field).

**Material build folds:**

2. **Explicit draft-level 1:1 + fail-loud provenance re-check [codex fold-1/fold-5].** FM(i) is **PR-level**, so a silently-skipped _draft_ from a PR that still has another draft/drop would pass it — don't rely on FM(i) for classify 1:1. `runClassifyStage(extract: ExtractStageResult, splitLedger: SplitLedger, deps)` re-validates each draft's `provenance.mergedPr ∈ trainPrs` **and** `commitSha === the frozen merge commit` and **throws** (contract violation / producer bug — fail loud, NOT a drop) on a forged draft, keeping the stage honest even if a future caller bypasses `runExtractStage`. Assert/lock `drafts.length === candidates.length === emission.entries.length === classifier.entries.length`, each draft → exactly one of each row, none doubled, all three schemas parse after assembly. (`seedClassesProvided` is threaded from `extract.seedBlindness` — single source; the classifier is handed only a `DraftCandidate`, no seed channel — strategy #4 structural backstop, asserted in tests.)
3. **Deterministic refs, classify sequentially [codex fold-4 + agy fold-4].** Classify **sequentially** (mirror Extract's sequential await) so ordinals follow stable input order before any async reorder; assert `candidateRef`/`classifierLedgerRef` **uniqueness** across the run (a collision collapses the harness join Map); test 2-drafts-from-one-PR and duplicate-classifier-refs.
4. **No dslSource dedup at classify [agy fold-2].** Duplicate `dslSource` → distinct candidates with unique refs; any dedup belongs downstream (compile/promotion), never the Classify gate — keeps 1:1 clean. Explicit + tested.
5. **Dual error-path + routing tests [agy fold-3 + codex fold-3].** Handled internal failure → `behavioral`/`rag-only` + clean run (and `dispositionSource: 'error-default'`); a contract-violating throw → propagates loudly (no core swallow). Plus: `structural→compile`, `behavioral→rag-only`, behavioral-can't-compile, ledger-disposition-mismatch trips FM(c), invalid runtime classifier output fails loud **before** routing.
6. **Schema-parse error-mapping tests [agy fold-1].** Malformed raw ledger JSON (missing `provenance` / `unverified:false`) → FM(a)/FM(b) via `runFalsificationHarness` — locks the schema-level guards in the suite.
7. **`assembleMinerLedgers` ships (OQ3=a) [codex/agy].** Thin pure 5-ledger combiner; the **end-to-end harness lock is mandatory** — real extract+classify output → `runFalsificationHarness` green, plus the per-FM red crafts (c / e-emission / f / i). No orchestration (slice 5 drives).

**OQ dispositions (panel-confirmed):** OQ1 (no classify drop) = (a) — all four concur; contract violations fail loud, never drop. OQ2 (port + fixture, no live LLM) = (a). OQ3 (`assembleMinerLedgers`) = (a). OQ4 (`cand-`/`clr-` deterministic refs) = (a).

**Carried-forward (panel-confirmed):** flag-3 frozen-actuator seam = slice-4-binding (slice-3 mints only the `structural` _label_, compiles nothing); flag-4/#2201 (ADR-095 before-promotion gate) = independent of slice 3.

**Pre-build status:** design folded + panel-reviewed (gemini APPROVE / strategy FAITHFUL+flag-5 / codex CONCERN-folds / agy PASS-folds — all convergent, no blockers; the binding fold is the auditable safe-default). **Build gated on operator greenlight (Phase-4 gate).**
