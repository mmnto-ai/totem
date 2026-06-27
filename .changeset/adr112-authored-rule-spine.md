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

Inert infrastructure: mined behaviour is unchanged (2899 core tests green); no scorer-facing change. The `totem rule author` CLI (slice B), the leakage-guard sandboxing + preimage-differential control (slice C), and the operational §9 window-wide label derivation (slice D) follow.
