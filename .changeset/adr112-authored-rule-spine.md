---
'@mmnto/totem': minor
---

feat(spine): ADR-112 authored-rule producer — schema spine (slice A, strategy#591)

Adds the authored-rule ingestion schema spine for the Gate-1 at-power cert (ADR-112, couple-on-merge per #2107):

- **`provenance` discriminated union** (`mined | authored`) — the first multi-producer attribute on a rule (ADR-112 §3 / #2183). Built as a `z.union` with an OPTIONAL `kind` on the mined wire so every legacy mined record parses + reserializes **byte-identical** (no manifest-hash churn); accessors `provenanceKind` / `isMinedProvenance` / `isAuthoredProvenance`. The miner path is typed `MinedProvenanceRecord` (the documented mining-only boundary).
- **`AuthoredRuleRecord`** + `AuthoredProvenanceRecord` (train-side, preimage-anchored `positiveFixtures`) + `StructEligResult`.
- **Independent structural-eligibility check** (`evaluateStructuralEligibility`) — a deterministic, LLM-free CLOSED-registry predicate (decidable iff exactly one `(engine, class)` whitelist match; no default-to-structural). The author never self-certifies the disposition (FM(d)).
- **Stable authored rule-id mint** (`mintAuthoredRuleId`) — `sha256(author·targetDefect)` + counter on collision; `dslSource` excluded so a matcher refactor keeps the id.
- **`getRulePolicy(kind)`** — the ADR-112 §9 producer-kind override single-home (mined wired live; authored defined for slice D).
- A new `authored-whitelist` `DispositionSource` so the classifier ledger never claims an LLM judged a human-authored rule.
- **`toCompileFeed`** — the compile-feed adapter (ADR-112 §2): turns structurally-decidable authored rules into the input `runCompileStage` consumes, reusing the ONE G-series compiler verbatim. The actuator's input contract is widened to a shared `CompileInputCandidate` / `CompileStageInput` that both the mined `CandidateRuleRecord` and an authored candidate satisfy — never a second compiler, never an authored rule masquerading as a classify result. A non-decidable rule fails loud (FM(d)); the disposition is set by the eligibility check, never the author.

Inert infrastructure: mined behaviour is unchanged (full core suite green; an authored rule now compiles end-to-end through the same `runCompileStage` with its provenance + Stage-4 verdict preserved); no scorer-facing change. The `totem rule author` CLI + the concrete decidable-class whitelist registry (slice B), the leakage-guard sandboxing + preimage-differential control (slice C), and the operational §9 window-wide label derivation (slice D) follow.
