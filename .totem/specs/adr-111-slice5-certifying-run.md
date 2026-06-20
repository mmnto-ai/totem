# ADR-111 miner slice 5 — the certifying run (#2189 item 1) — DESIGN + sub-slicing

**Contract source of truth:** `adr/adr-111-spine-gate-1-rule-mining-miner.md` (totem-strategy@main). Builds on slices 1–4 (`.totem/specs/adr-111-miner-build.md`). The certifying run is `mmnto-ai/totem#2189 item 1`.
**Grounded:** 2026-06-20 via an Explore sweep (windtunnel command + scorer/lock, the miner stage ports, the live adapter seams, the 4 carried bindings' touchpoints, #2189-item-1 + #2201 scope). `totem spec` skipped (cross-repo-ADR-driven, per #2172/0103).
**Status:** PANEL COMPLETE (4/4) — design APPROVED-with-folds, no FAIL, no re-architecture. Build gated on per-sub-slice operator go. See `## Panel verdicts (4/4) + consolidated folds`.

## The scope reality (why this is NOT one slice)

Slice 5 was carried as "wire real miner output into `spine windtunnel run`." Grounding shows it is a **multi-PR composite** that also introduces the miner's **first non-deterministic, LLM-backed, network-dependent components** — a real shift from the deterministic/mock-first discipline slices 1–4 held.

One dependency surfaced — and it was RESOLVED by strategy-claude (0252Z, canonical on strategy#516):

1. **strategy#516 does NOT gate slice-5.** I initially read #2189 item 1 as "blocked on #516" (needs real minted rules to replay). strategy clarified the direction: **the certifying run BOOTSTRAPS from the miner's OWN first real output** — #516 (rule-repopulation) is the _downstream consumer_ of certified rules, not the upstream supplier. So slice-5 produces the first real rules itself (via the live adapters), the wind-tunnel certifies them, and #516 later consumes the certified corpus. No cross-repo blocker; **operator GREENLIT the slice-5 cohort panel** (build stays gated behind the panel).
2. The remaining real consideration is internal: item 1's literal scope is narrow — _wire the shared post-image `readStrategy` into the `run` command's engine path (today `run` hands `readStrategy` to a MOCK engine); the certifying run builds additions from each resolved PR's diff through `enrichWithAstContext` + `applyAstRulesToAdditions` with the one shared post-image `readStrategy` (already unit-proven in `windtunnel-parity.test.ts`)_ — but it only means something once the live producer (5a/5b) has minted real rules. So the real-engine wiring (5c) sequences AFTER the live adapters, not after #516.

## Recommended sub-slicing (each its own PR + gate)

- **5a — live `ReviewThreadSource` + #2201 resolution-filtering (deterministic).** The CLI GraphQL adapter (`reviewThreads { isResolved, isOutdated }` — REST lacks it) implementing the `ReviewThreadSource` port; core decides eligibility deterministically + drop-ledgers it (§6/§8, new `resolved-rejected` reason). flag-4 holds **by construction** (the adapter can't fetch unfiltered content). Mostly deterministic — the fetch is IO, the filter decision is pure core. Lands #2201 as its named sub-step.
- **5b — live LLM `DraftExtractor` + `DraftClassifier` adapters (NON-deterministic).** Thin CLI port impls over the existing orchestrators (`anthropic`/`gemini`/`openai-orchestrator.ts`, `InvokeOrchestrator`). This is where the decaying prompt + feasibility risk live (the slice-2/3 OQ2 deferral). The port boundary keeps core deterministic; the adapters carry the error contracts already specced (`DraftExtractor`→`[]` on failure; `DraftClassifier`→safe-default `behavioral`/`error-default`). **Seed-blind by construction.**
- **5c — certifying-run orchestrator + #2189-item-1 real-engine wiring + the 4 bindings.** Drive fetch→extract→classify→compile end-to-end on the frozen train slice; replace `runMockEngine` with the real `enrichWithAstContext` + `applyAstRulesToAdditions(readStrategy, …)` path; build `RuleFiring[]` + ground-truth → `scoreWindtunnel`; project the verdict into a `Legitimacy` stamp; persist. Discharges the 4 bindings.

## Key seams (from grounding)

- **`scoreWindtunnel(input: ScorerInput)`** → `WindtunnelVerdict { verdict: PASS|FAIL|HONEST-NEGATIVE, precision, cullLedger, exposureTuple, needsAdjudication, … }`. Input needs `firings: RuleFiring[]` (`{ruleId, pr, filePath, matchedLine, controlKind, targetRuleId?, labelId}`, `labelId = firingLabelId(ruleId, pr, file, line)`), `groundTruth: Map<labelId, 'TP'|'FP'>`, control targets, exposure floors. **The scorer does NOT stamp legitimacy** — slice-5 projects the verdict→`Legitimacy { provenance, positiveControl, negativeControl }` downstream and computes `ruleClass = deriveRuleClass(rule)`.
- **`CompiledCandidate` → scoring:** load compiled rules → build additions per resolved-PR diff → `applyAstRulesToAdditions` (enriched, shared `readStrategy`) → firings → `scoreWindtunnel`.

## The 4 carried bindings — touchpoints (verified)

1. **Stamp-before-persist** — `saveCompiledRules`/`saveCompiledRulesFile` (`compiler.ts:198`). Slice-5 MUST project the verdict into `legitimacy` + compute `ruleClass` BEFORE calling save; never write an unstamped `unverified:true` rule to `.totem/compiled-rules.json`. The `CompiledRuleSchema` superRefine enforces legitimacy⇔ruleClass both-present/both-absent at parse.
2. **Archived ≠ wind-tunnel FP** — `out-of-scope` candidates are already `status:'archived'` (slice-4 `mapStage4Outcome`); the wind-tunnel scores only active candidates → archived never enters the scored set (enforced at orchestration: filter to active before building firings).
3. **#2201 resolution-filtering** — lands in 5a (above), the before-promotion gate.
4. **Engine-proxy + `unverified`** — `deriveRuleClass` (`compiler-schema.ts:327`) forces `'advisory'` on `unverified:true` REGARDLESS of legitimacy (verified at grounding). So a leaked unstamped candidate reads as advisory (non-blocking), never `hard`. Binding **discharged by the existing mechanism** — slice-5 only needs to NOT set `unverified:false` until the verdict promotes.

## Open questions for the panel

1. **Sub-slicing order** — 5a→5b→5c, or fold 5a+5b into one adapter PR? (Rec: 5a first — deterministic, lands #2201; then 5b; then 5c.)
2. ~~strategy#516 readiness~~ **RESOLVED (strategy 0252Z):** the cert run bootstraps from the miner's own first output; #516 is the downstream consumer, NOT a blocker. (Kept here as a settled note.)
3. **Non-determinism containment** — the live LLM adapters break the mock-first lock. How is the certifying run made _re-runnable_/auditable (frozen prompt + recorded LLM outputs as a replay fixture, à la the wind-tunnel lock)? (Rec: record the LLM draft/classify outputs into a frozen artifact so the certifying run is replayable + the FM harness stays deterministic.)
4. **`run --phase certifying`** — the command already rejects harness locks; confirm the real-engine path's verdict semantics (FAIL outranks masquerade, null-precision sentinel) hold with real firings (#2189 item 3 already ratified these).

## Panel verdicts (4/4) + consolidated folds

Run 2026-06-20 (#2167 independence — no seat read siblings). **4/4 APPROVE-with-folds; no FAIL, no re-architecture; design survives.** Unanimous on structure: **5a→5b→5c, do NOT fold**; #516-bootstrap locked; seed-blind-by-construction confirmed.

- **totem-codex** (contract/correctness): CONCERN-with-build-folds.
- **strategy-claude** (ADR-111 fidelity / contract owner): architecturally FAITHFUL, no FAIL — 4 bindings confirmed (1 & 4 mechanism-verified in `compiler-schema.ts`), 4 sharpenings, 2 catches.
- **totem-gemini** (tenet/architecture): APPROVED WITH ONE QUALIFICATION (OQ3 fixture shape) — proceed with 5a.
- **totem-agy** (build/test-completeness): PASS WITH 4 FOLDS.

### Consolidated fold list (dedup'd across seats; tagged by sub-slice)

**A. OQ3 replay-fixture — the central question, now ANSWERED (4/4).** Freeze the live LLM draft/classify outputs into a recorded replay artifact; scorer + FM harness run **zero-LLM** on it (strategy: "arguably contract-MANDATED" by §6+§8+Tenet-15). Must capture the **exact** outputs that produced the canonical verdict (strategy). Add a **drift-detection test** that mutates one fixture entry → asserts fail-loud, not silently absorbed (agy Fold-1 + codex). Fixture captures raw LLM response so adapter *parsing* is regression-tested token-free (gemini). → **5b/5c**

**B. verdict→Legitimacy = per-rule, survivor-only (codex + strategy — the one genuine design correction; my doc read run-level).** `positiveControl`/`negativeControl` set ONLY from the scorer's actual control results, never defaulted true. PASS→stamp only negative-control survivors holding their own positive-control evidence (`{true,true}`/`hard`/`unverified:false`); control-FAIL→legitimacy present, failed control `false`→`deriveRuleClass` forces advisory (evidence, non-blocking); **HONEST-NEGATIVE/`needsAdjudication`→stamp NOTHING, do not persist to `compiled-rules.json`** (use a distinct cert-run artifact if advisory persistence wanted). → **5c**

**C. Parse-before-write persistence (codex must-fix; strategy: superRefine forbids-but-doesn't-compel).** A 5c persistence helper runs `CompiledRulesFileSchema.parse(payload)` immediately before write; projection atomic (build→parse→append parsed). Tests for BOTH half-stamp directions (legitimacy-without-ruleClass, ruleClass-without-legitimacy) failing before disk. → **5c**

**D. firing-label collision (codex must-fix, unique).** `firingLabelId(ruleId,pr,file,line)` collides on repeat firings (generated code / repeated imports/guards/config) → `Map<labelId,TP|FP>` silently overwrites. Add an occurrence discriminator (ordinal / diff-hunk span fingerprint) **or** hard-gate `firings.length === unique(labelIds)` before `scoreWindtunnel`. Ground-truth joins to the **resolved-thread/adjudication primitive**, not PR status; preserve `labelId→evidenceRef`. → **5c**

**E. `resolved-rejected` = real schema member, core-decided + core-ledgered (codex + strategy).** Add to `DropReasonCodeSchema`; adapter *surfaces* `isResolved/isOutdated`, **core decides + drop-ledgers** (adapter-side pre-filter makes #2201 unobservable → unledgered → §8 violation). "By construction" valid only while the ledger entry survives. **agy Fold-2:** structural query spy asserts `isResolved:false`/`isOutdated:false` hardcoded in the GraphQL AST payload (verifies the DB-side gate structurally). → **5a**

**F. archived-excluded defense-in-depth (strategy + agy + codex).** Loud assert at the **scorer input boundary** (archived-in-scored-set → throw, Tenet 4). **agy Fold-3:** test `applyAstRulesToAdditions` never invoked for `status:'archived'`; zero archived refs in `RuleFiring[]`/output; scorer denominator excludes archived. → **5c**

**G. fail-soft vs fail-loud split (codex, unique).** Per-item `DraftExtractor→[]` is right, but a *globally* unavailable adapter / missing API key / bad model / prompt-asset load failure must **fail the run before mining**, not return `[]` per-PR and masquerade as sparsity. Separate the extractor-failure count from the `unparseable` drop. → **5b**

**H. OQ4 real-firing integration matrix (codex, unique).** Real-engine mapping passes negative-control firings through as `controlKind:'negative'` (not dropped pre-score); unlabeled real firings stay in `firings` with no `groundTruth` → HONEST-NEGATIVE+`needsAdjudication`. Integration tests on the real `enrichWithAstContext`+`applyAstRulesToAdditions(readStrategy,…)` path: confirmed-FP-sub-floor→FAIL; vacuous-positive-control→FAIL/null-precision; unlabeled→HONEST-NEGATIVE; duplicate-label→hard error before score. → **5c**

**I. Two newly-live §8 ledgers = explicit 5c acceptance (strategy catch).** API-usage ledger **held-out-fetch-count MUST be 0** (FM-h; 5a/5b = first live fetches); emission ledger's **extraction-inputs attestation** (seed-blindness, FM-f) must be EMITTED + CI-observable per §7, not asserted. → **5c (with 5a/5b emission)**

**J. §5 split artifact = 5c precondition (strategy catch).** The committed `{asOfCommit, trainPrs, heldOutPrs, excludedPrs, splitRule}` (three-way disjoint-cover completeness check) must exist BEFORE 5c runs. → **5c precondition**

**K. E2E test isolation (agy Fold-4).** Block all outgoing TCP (nock/undici interceptor; hard descriptive error on any unmocked request); `persist` accepts a mock VFS; verify sorted keys + computed `ruleClass` + correct `legitimacy` in-memory. → **5c**

## Dispositions

- **Operator 2026-06-20:** greenlit slice-5 **design + cohort panel** (build gated; "I lens the 4 bindings when you surface it" — strategy 0112Z).
- **Panel 2026-06-20 (4/4 APPROVE-with-folds):** codex CONCERN-with-folds · strategy FAITHFUL/no-FAIL (4 bindings confirmed) · gemini APPROVED-w/-OQ3-qualification · agy PASS-with-4-folds. Consolidated fold list above. No design contradiction; the legitimacy-projection per-rule/survivor-only correction (B) is the only genuine design change.
- **Per-sub-slice build = pending operator go** (the standing greenlight opened the panel gate; per-sub-slice go is the operator's call). Next: 5a (deterministic `ReviewThreadSource` + #2201, folds E/F-test).
