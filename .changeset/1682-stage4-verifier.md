---
'@mmnto/totem': minor
'@mmnto/cli': minor
---

ADR-091 Stage 4 Verify-Against-Codebase verifier (`mmnto-ai/totem#1682`). Headline 1.16.0 substrate. Before a compiled rule moves to Active status, it runs deterministically (zero LLM) against the consumer's working tree and is routed into one of four outcomes:

- **No matches** → `status: 'untested-against-codebase'`. Verifier ran, found no hits in this codebase. Subsequent compile cycles in a populated repo can re-run Stage 4 and promote.
- **Out-of-scope baseline match** → `status: 'archived'`, `archivedReason` cites the offending paths, new reasonCode `'stage4-out-of-scope-match'` added to `NonCompilableReasonCodeSchema`. Pattern is over-broad.
- **In-scope `badExample`-shape match** → new `confidence: 'high'` field set. Pattern fires on real code in the exact authored shape.
- **Candidate Debt** (in-scope but not bad-example shape) → force `severity: 'warning'` so the rule is alive but cannot break CI on first run; `totem doctor` (T4 / `mmnto-ai/totem#1685`) will surface the candidate-debt sites.

T1 ships local-compile mode fully. The verifier walks the consumer's git-enumerated file set and reuses the existing `applyRulesToAdditions` / `applyAstRulesToAdditions` rule-engine surfaces; baseline glob matching mirrors the test-contract scope classifier shapes (`mmnto-ai/totem#1626` / `mmnto-ai/totem#1652`). Telemetry events tagged `type: 'stage4-verify'` append to `.totem/temp/telemetry.jsonl`.

**Public API (new, exported from `@mmnto/totem`):** `verifyAgainstCodebase`, `getDefaultBaseline`, `DEFAULT_BASELINE_GLOBS`, type `Stage4VerificationResult`, type `Stage4Baseline`, type `Stage4Outcome`, type `Stage4VerifierDeps`. New optional `verifyStage4` callback on `CompileLessonDeps`; new optional `onStage4Outcome` callback on `CompileLessonCallbacks`. Schema deltas: `CompiledRuleSchema.status` enum gains `'untested-against-codebase'`, new optional `confidence` field, `NonCompilableReasonCodeSchema` gains `'stage4-out-of-scope-match'`.

**Negative scope (deferred to follow-on tickets):** Pack install→lint promotion + `pending-verification` state writers + `.totem/rule-metrics.json` reads belong to T3 (`mmnto-ai/totem#1684`). Consumer `.totemignore` / `review.stage4Baseline` config field belongs to T2 (`mmnto-ai/totem#1683`). `totem doctor` Stage 4 surfaces belong to T4 (`mmnto-ai/totem#1685`). Batched / streamed perf optimizations belong to T5 (`mmnto-ai/totem#1686`). Pipeline 1 (manual) rules bypass Stage 4 — those are human-authored and self-evidencing.

**Bot-review tail:** Sonnet pre-push review caught a defensive-coding gap on the candidate-debt severity downgrade (treating `undefined` severity as a no-op would let pre-1.16.0 persisted rules skip the downgrade if a future lint pass interpreted undefined as `'error'`). Tightened to `severity !== 'warning'` so the post-condition is explicit.
