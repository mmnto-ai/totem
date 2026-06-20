# Layer-B Cohort-Capability Ledger — totem-core build (review-catch first column)

**Contract source of truth:** `mmnto-ai/totem-strategy#697` — schema canonical on comment 4755374011; the 5 incremental folds ruled + canonical on **comment 4755799517**. Supporting: ADR-078 (attribution — coupled-to, NOT amended), ADR-110 (frozen-label adjudication), `doctrine/cohort-roles.md` (seat actor-ids), the #670/#699 review-adapter catalog (backend actor-ids), Tenet-20 carve-out (c) (regenerable cache), Tenet-19 (no correlated rater / no LLM-judge), Tenet-21 (reuse).
**Boundary (ruled):** schema/derivation = strategy (done, on #697); **actuator (back-miner + regenerator) = totem-core, this build.**
**Grounded:** 2026-06-20 via an Explore sweep of `ledger.ts`, `pr-adapter.ts`/`github-cli-pr.ts`, `bot-review-parser.ts`, `selection-rule.ts`, `cohort-roles.md`, ADR-078. `totem spec` skipped (cross-repo-ADR-driven → confabulation risk, per #2172/0103).

## What it is

A **claim→resolution prediction ledger**; per-agent×task-type "capability" is a **regenerable cache** recomputed from an append-only log (Tenet-20 carve-out c — the same shape as #670 and the ADR-110 wind-tunnel). Most ground truth arrives _later_ (did the review catch hold? was the fix applied?), so the log is two-phase and the hit-rate is **never stored as mutable state** — always recomputed. Back-mined from existing primitives (PR review threads + the disposition audit-trail); **no new write-path** (pure Tenet-20 derive-from-history).

## First-PR scope (strategy's slice — "mirror the slice-1 mock-first lock")

**IN:** the three schemas (`CapabilityClaim` / `CapabilityResolution` / `CapabilityLedger`) + `deriveClaimId` + the **regenerator** (supersession/effective-resolution + the hit-rate fold) + the **review-catch back-miner** for one source (PR review threads + dispositions) + the **FM a–d** falsification harness — all **deterministic + mock-first** (an injected port, no live network/shell in core), with vitest fixtures (the spine slice-1 #2188 discipline).

**DEFERRED:** the live CLI adapter that fetches real PR review threads (a thin port impl, the spine-slice-5-style follow-on) + the live LC-#670-corpus acceptance run (proves the ≥1-division bar on real data); the other 5 task-types (`bug-localization`, `diagnostic-harness`, `diagnostic-screenshot`, `layout-design`, `code-impl`); the blind model-diverse head-to-head; any event-time hook. The core build proves the **mechanism** deterministically; the live run proves the **division** (follow-on PR).

> Scope note flagged to strategy: their slice text said "wired on the live LC corpus" AND "mirror your slice-1 mock-first lock"; I read the mock-first lock as operative for THIS PR and split the live-corpus run into the immediate follow-on (exactly the spine's core-then-live-adapter shape). Non-reshaping.

## Locked contract (from #697 c.4755799517)

- **`claimId` = `sha256("capclaim:v1" + canonicalJson({agentSource, taskType, claimKind, provenanceRef, commitSha, nativeKey}))`** — canonical serialization mandatory (key order breaks FM-a); version prefix future-proofs; `payload`/`assertedAt` **excluded** (identity ≠ content, so re-back-mining / payload edits never re-key + orphan the join). `nativeKey` = the source primitive's stable native id. **Build deviation:** the REST review-comment API exposes a stable **numeric comment `id`**, not a GraphQL `node_id`; `nativeKey` = `gh-review-comment:<id>` (same stable-discriminator principle; flagged to strategy as a build detail, not a contract reshape).
- **Data model (append-only):**
  - `CapabilityClaim { claimId, agentSource, taskType, claimKind, provenance: { ref, commitSha }, nativeKey, assertedAt, payload? }`
  - `CapabilityResolution { resolutionId, claimId, outcome: 'correct'|'wrong'|'partial'|'unresolved', resolutionSource, evidenceRef, resolvedAt, supersedesResolutionId? }`
  - `CapabilityLedger` (derived, regenerable): `agent × taskType → { correctN, wrongN, partialN, unresolvedN, decisiveN, hitRate, lastResolved }`
- **Supersession / effective resolution** — N resolutions per claim; the regenerator selects **exactly one effective terminal per `resolutionHorizon`**: prefer explicit `supersedesResolutionId` chains (back-miner sets them deterministically from primitive chronology), fall back to latest `resolvedAt ≤ horizon` + lexical-`resolutionId` tie-break, **true tie = fail loud**. A resolution referencing an absent `claimId` = **hard error** (FM-c). Claims with no effective terminal resolution by horizon → the `unresolved` bucket.
- **`resolutionSource` = closed enum** `{ deterministic-event | disposition-thread | frozen-label | operator-tiebreak }` + required `evidenceRef`. **No `llm-judge` member → FM-b is structural** (an LLM-judged resolution is unconstructible). The blind head-to-head escape-hatch enters only as a frozen `frozen-label`.
- **hit-rate** — `hitRate = correctN / decisiveN` where `decisiveN = correctN + wrongN`; `unresolved` AND `partial` **both excluded** from the rate (partial is its own counted bucket, **never** half-credited — a 0.5 is an invented score, FM-b); the full `{correct, wrong, partial, unresolved}` distribution is always reported alongside. `unresolved` exclusion fixes near-HEAD skew.
- **Attribution (F5)** — Layer-B `agentSource` = a **stable actor-id**; model/backend = **separate optional metadata, never folded into the id** (so hit-rate aggregates across model swaps). Actor-ids couple to existing registries: cohort seats → `cohort-roles.md` ids (`totem-claude`, `strategy-codex`, …); review backends → the catalog (`cr`, `gca`, `greptile`, `pr-agent-L1`, `cohort-agent-L2`, `spine-L0`). **ADR-078 `agent_source` is NOT amended** (compliance-attribution ≠ capability-attribution).
- **Falsifying metric a–d:** (a) the ledger is not byte-reproducible from the log → mirror violation (Tenet-20); (b) any `outcome` set by an LLM-judge → Tenet-19 [structural via the enum]; (c) join integrity — a resolution references a missing claim, or >1 effective terminal per claim per horizon; (d) arithmetic integrity — ledger rows ≠ the deterministic fold under the pinned formula + canonical sort.

## review-catch derivation (the first column)

A **claim** = a posted review finding (one per review comment), `agentSource` = the finding's author resolved to an actor-id (bot login → backend id; cohort seat → seat id), `taskType = 'review-catch'`, `nativeKey = gh-review-comment:<id>`, `provenance = { ref: PR thread ref, commitSha }`. A **resolution** = the deterministic disposition read (reusing `bot-review-parser`'s `accepted`/`declined` taxonomy + `PUSHBACK_PATTERNS`, doctrine/bot-protocols §8.1):

- `held` (→ `outcome: 'correct'`) — finding accepted + fix applied (resolved thread + linked fix commit / `addressed_in_pr`).
- `wrong` (→ `outcome: 'wrong'`) — explicitly **declined-as-FP** (a pushback disposition).
- **silence** (no disposition, no fix) → **`unresolved`**, NOT `wrong` (strategy pin — don't count silence as a miss).
- `resolutionSource` precedence: `disposition-thread` (explicit per-round disposition) > `frozen-label`/`operator-tiebreak` (contested) > thread-resolved+linked-fix supports `held` only when tied to the specific finding. `evidenceRef` = the disposition comment id + fix commit/ref.
- **author-adjudicated** correctness (accepted/declined by the PR author), _not_ objective — honest scope, identical to #670.

## Placement + build-discipline folds (mine, no ruling needed)

`packages/core/src/capability/` (sibling to `spine/`): `schema.ts` · `regenerate.ts` · `review-catch.ts` · `falsification.ts` + `*.test.ts`. Network/LLM-free, deterministic. The live GitHub fetch is an **injected port** (CLI-implemented later — the `Stage4VerifierDeps`/`ReviewThreadSource` DI pattern). Folds: **mock-first** abstract review-thread/git interface (agy fold-4 — no live shell in core); regenerator processes log events in a **strict deterministic order** (sort by `(resolvedAt|assertedAt, lexical id)`) + **sorted-key canonical serialization** (FM-a); fail-loud on corrupt/absent primitives.

## Tests to lock (deterministic, mock-first)

- `deriveClaimId` is canonical + stable (key-order-independent; `payload`/`assertedAt` excluded → edits don't re-key); two findings from one PR get distinct ids via `nativeKey`+`claimKind`.
- **FM-a:** regenerate-twice → byte-identical ledger.
- **FM-b:** `resolutionSource` enum has no `llm-judge` member (structural — unconstructible).
- **FM-c:** a resolution referencing an absent claim → hard error; >1 effective terminal per claim per horizon → hard error; true supersession tie → fail loud.
- **FM-d:** ledger rows exactly equal the hand-computed fold for a fixture log.
- Supersession: a `supersedesResolutionId` chain selects the terminal; `resolvedAt`+lexical fallback when no chain.
- hit-rate: `correct/(correct+wrong)`; a partial-heavy fixture does NOT inflate the rate (partial excluded); near-HEAD `unresolved` excluded.
- review-catch: held→correct, declined→wrong, silence→unresolved; author resolved to the right actor-id (bot login → backend id, seat → seat id).

## Dispositions

- **Operator 2026-06-20:** build greenlit ("greenlight if we have the context" — at 43% ctx, ample).
- **Cohort fidelity-lens panel (2026-06-20, 4/4 convergent):** gemini APPROVE / agy PASS+folds / codex CONCERN+folds / strategy ruled F1–F5 (codified #697 c.4755799517). Architecture "pristine"; the build-discipline folds are taken above. No second panel — the fidelity lens was the pre-build review.
