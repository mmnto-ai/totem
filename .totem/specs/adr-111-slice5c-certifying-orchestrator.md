# ADR-111 miner slice 5c — the certifying-run orchestrator (#2189 item 1) — DESIGN + sub-slicing

**Contract source of truth:** `adr/adr-111-spine-gate-1-rule-mining-miner.md` (totem-strategy@main). Child of `.totem/specs/adr-111-slice5-certifying-run.md` (the broad slice-5 panel, 4/4 APPROVE-with-folds). This doc **re-grounds the 5c-tagged folds against the now-BUILT 5a/5b reality** and proposes the 5c sub-slicing.
**Grounded:** 2026-06-20 via an Explore sweep over the shipped 5a (#2207), 5b-i (#2209), 5b-ii (#2211) code. All anchors below are `file:line` against `main`.
**Status:** PANEL COMPLETE (4/4 APPROVE-with-folds; no FAIL, no re-architecture) — decisions locked in §6. **5c-i build greenlit by operator 2026-06-20.** Build proceeds per-sub-slice (5c-i firing path → 5c-ii orchestrator+freeze).

## 1. Scope (what's left after 5a + 5b shipped)

5a (live `ReviewThreadSource` + `resolved-rejected`), 5b-i (record/replay scaffold), 5b-ii (live LLM adapters + fold-C/E/F/G/H/I) are MERGED. 5c is the **certifying finale**: drive fetch→extract→classify→compile→**real-engine firing**→score→stamp→persist end-to-end on the frozen train slice, replace the mock engine (#2189 item 1), freeze the `llm-replay.v1` fixture, and discharge the remaining folds + the 4 carried bindings.

## 2. Grounded seams (from the sweep — what 5c wires)

- **Live producer (5b-ii):** `spine-llm-adapters.ts` — `LiveDraftExtractor`/`LiveDraftClassifier` (per-item fail-soft: `draft→[]`, `classify→{behavioral,error-default}`), `assertPipelineProductive` (all-items-failed⟹throw — the fold-G floor, **shipped**), `buildReplayProvenance`, `assertLiveLlmAllowed`, `verifyLlmAdapterConfig`. Drive the injected `InvokeOrchestrator` seam directly.
- **Record/replay (5b-i):** `spine-llm-replay.ts` — `RecordingDraftExtractor`/`RecordingDraftClassifier` (wrap live, record `inputKey→output`), `ReplayDraft*` (zero-LLM, `ReplayMissError` on miss), `ReplayRecordSink.freeze(provenance)→ReplayArtifact`, `serializeReplayArtifact` (canonical, key-sorted), `assertFixtureIntegrity(artifact, expectedHash)` (**external** hash, throws `FixtureIntegrityError`), `REPLAY_ARTIFACT_KIND='llm-replay.v1'`, `computeArtifactHash` (whole-artifact incl. provenance).
- **Certifying command:** `spine-windtunnel.ts` — `runCommand(opts)` (line 134); `opts.phase==='certifying'` already rejects a harness lock (P1); `buildReadStrategy(lcDir, asOfCommit, safeExec)` (line 334, C2 loud-error on unresolvable blob); **`runMockEngine` (line 234) is the mock 5c replaces.**
- **Real engine path:** `enrichWithAstContext(additions,{readStrategy})` (`ast-gate.ts:36`), `applyAstRulesToAdditions(ctx, rules, additions, cwd, …, readStrategy)` (`rule-engine.ts:354`).
- **Scorer/stamp:** `scoreWindtunnel(input:ScorerInput)→WindtunnelVerdict` (`windtunnel-scorer.ts:99`); `RuleFiring{ruleId,pr,filePath,matchedLine,controlKind,targetRuleId?,labelId}`; `firingLabelId(ruleId,pr,filePath,normalizedLineText)` (`windtunnel-lock.ts:142` — **no occurrence discriminator**); `deriveRuleClass` (`compiler-schema.ts:327`, `unverified:true⟹advisory`), `CompiledRuleSchema.superRefine` (line 377, legitimacy⇔ruleClass), `saveCompiledRulesFile` (`compiler.ts:215`).
- **§5 split:** `SplitArtifactSchema` + `validateSplitCover` (`split.ts:32/142`) shipped (#2189 item 2). **Artifact not yet committed** under `.totem/spine/gate-1/`.

## 3. Net-new 5c work (drift matrix → tasks)

| Fold                            | Status vs built code                                                      | 5c task                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **E** `resolved-rejected`       | **SHIPPED** (`ledgers.ts` `DropReasonCodeSchema`)                         | none                                                                                                                                                                                                                                                               |
| **G** fail-soft/loud split      | **SHIPPED** (`assertPipelineProductive`)                                  | none                                                                                                                                                                                                                                                               |
| **J** §5 split schema           | schema **SHIPPED**; artifact not committed                                | **precondition:** produce + commit the `{asOfCommit,trainPrs,heldOutPrs,excludedPrs,positive/negativeControlPrs,splitRule}` artifact (validateSplitCover-clean) before 5c runs                                                                                     |
| **B** verdict→Legitimacy        | machinery shipped (`deriveRuleClass`/superRefine); **projection net-new** | stamp ONLY survivors with real `{positiveControl,negativeControl}` from the scorer — PASS+both-controls⟹`{true,true}`/`hard`/`unverified:false`; control-FAIL⟹legitimacy w/ failed control `false`⟹advisory; HONEST-NEGATIVE/`needsAdjudication`⟹**stamp nothing** |
| **C** parse-before-write        | partial (nonCompilable validated); **net-new**                            | wrap persist: `CompiledRulesFileSchema.parse(payload)` immediately before write; tests both half-stamp directions fail pre-disk                                                                                                                                    |
| **D** firing-label collision    | **UNHANDLED HOLE**                                                        | add occurrence discriminator (ordinal / diff-hunk span) to `labelId`, **or** hard-gate `firings.length===unique(labelIds)` before `scoreWindtunnel`; preserve `labelId→evidenceRef`                                                                                |
| **F** archived-excluded         | scorer culls neg-controls; **assert net-new**                             | loud assert at scorer input (archived-in-scored-set⟹throw, Tenet 4); test `applyAstRulesToAdditions` never invoked on `status:'archived'`, zero archived refs in firings                                                                                           |
| **H** OQ4 real-firing matrix    | engine fns ready; **wiring net-new**                                      | replace `runMockEngine`; neg-control firings pass through as `controlKind:'negative'`; unlabeled⟹`needsAdjudication`; dup-label⟹hard error pre-score; integration tests: FP-sub-floor⟹FAIL, vacuous-pos-control⟹FAIL/null-precision                                |
| **I** two newly-live §8 ledgers | schema ready; **emit net-new**                                            | API-usage ledger held-out-fetch-count **MUST be 0** (FM-h); extraction-inputs attestation (seed-blindness, FM-f) EMITTED + CI-observable per §7, not asserted                                                                                                      |
| **K** E2E isolation             | none                                                                      | block all outgoing TCP (undici/nock, loud on unmocked); mock VFS for persist; assert sorted keys + computed `ruleClass` + `legitimacy` in-memory                                                                                                                   |

Plus the **record run** that produces + freezes `llm-replay.v1` (live once → freeze → all re-runs zero-LLM via `ReplayDraft*`) and the **external lock-wired expected-hash** (5c sources it from a committed lock; `assertFixtureIntegrity` takes it injected).

## 4. Proposed sub-slicing (panel call)

Mirrors the slice-1–4 deterministic-core / non-deterministic-edge seam:

- **5c-i — real-engine firing path (deterministic).** #2189 item-1 literal scope: replace `runMockEngine` with `enrichWithAstContext`+`applyAstRulesToAdditions(readStrategy)`; build `RuleFiring[]`; **folds D, F, H**. Tested with FIXTURE compiled rules + resolved-PR diffs (zero-LLM, deterministic). Gate: real firings score correctly (collision-safe, archived-excluded, control mapping).
- **5c-ii — certifying orchestrator + freeze + persist (the finale).** Wire fetch→extract→classify (live 5b adapters in `Recording*`) → compile → the 5c-i firing path → `scoreWindtunnel` → **fold B** projection → **fold C** persist; the **record run** + external-hash gate; **folds I, K**. Gate: end-to-end certifying run on the frozen train slice, replayable zero-LLM.

Rationale: keeps a flag-D/H engine regression distinguishable from an LLM-adapter/replay flake; lets engine-firing correctness be reviewed without the non-deterministic record/replay orchestration.

## 5. The 4 carried bindings (touchpoints confirmed)

1. **Stamp-before-persist** — 5c-ii orchestration obligation; superRefine forbids-but-doesn't-compel (a both-absent rule parses as legacy) → fold C parse-before-write is the net.
2. **Archived ≠ wind-tunnel FP** — fold F loud assert (5c-i).
3. **#2201 resolution-filter** — **discharged in 5a** (core decides + drop-ledgers; adapter surfaces flags).
4. **Engine-proxy + `unverified`** — `deriveRuleClass` short-circuits `unverified:true⟹advisory` (shipped); 5c must NOT flip `unverified:false` until the verdict promotes.

## 6. Panel verdicts (4/4) + locked decisions

Run 2026-06-20 (#2167 independence — no sibling reads before verdict). **4/4 APPROVE-with-folds; no FAIL, no re-architecture.**

- **strategy-claude** (ADR-111 fidelity): FAITHFUL — 4 bindings + 2 catches + fold-B discharged (verified, not trusted).
- **totem-codex** (contract/correctness): CONCERN-with-folds (4) — approves the split.
- **totem-agy** (build/test-completeness): PASS with 5 binding folds.
- **totem-gemini** (tenet/architecture): PASS.

### Locked (unanimous)

- **L1. Sub-slicing 5c-i / 5c-ii** — keep, do not fold (4/4).
- **L2. Lock home = `windtunnel.lock.json`** — the llm-replay expected-hash sits beside the existing `controls.integrity.fixtureSha`; one freeze-manifest per cert run (Tenet 20) (4/4).
- **L3. Persistence = PASS-survivors-only** to `compiled-rules.json`; non-terminals (HONEST-NEGATIVE / needsAdjudication / control-FAIL advisories) → a distinct transient cert-run report under `.totem/spine/gate-1/run-reports/run-<ts>-<hash>.json`, never the live corpus (population is #516's job) (4/4).

### Adjudicated (3-vs-1, agy dissent → majority + contract-owner)

- **A1. Fold-D = hard-gate-unique FLOOR** — `firings.length === unique(labelIds)` ⟹ throw pre-score (Tenet 4), emit the colliding labelIds + evidence refs into the cert-run report. **Measure** collisions on the frozen lc corpus; add a discriminator only if they occur, and then **diff-hunk-span**, NOT ordinal (strategy: ordinal regresses the line-drift resistance `firingLabelId`'s normalized-text design exists for). A later versioned `occurrenceKey`/`evidenceRef` extension if the corpus needs it. _(agy preferred ordinal; overruled.)_
- **A2. Record trigger = separate `spine windtunnel record` subcommand** — fail-safe (un-accidentally-triggerable in CI; `run` stays replay-only, `assertLiveLlmAllowed`-guarded). _(agy preferred a `--record` flag; overruled.)_

### Added build-blockers (codex; additive, no contradiction)

- **C1. Fold-B is not lossless from the run-level `WindtunnelVerdict`** — it has no per-rule positive-control pass/fail or evidence refs. 5c-i must surface a per-rule control result (`Map<ruleId,{positiveControl,negativeControl,evidenceRefs}>`) from `scoreWindtunnel` or a pre-score certifying join; **never derive `positiveControl:true` from global `nonVacuity`**.
- **C2. Third exposure leg unenforced** — `scoreWindtunnel` guards only `activeRulesEvaluated` + `positiveControlsExercised`, omitting `filesTouchedInWindow` (CLI passes `0`). 5c-i must compute real touched-file exposure from the frozen corpus/diffs and enforce the floor (or remove the field). Red case: `filesTouchedInWindow < floor` ⟹ HONEST-NEGATIVE even when the other two legs pass.

### Acceptance + precondition (strategy)

- **Binding-1 trio.** Correct stamping is compelled by fold-B (only stamped survivors persist) + fold-C (parse rejects inconsistency) + binding-4 (engine-proxy reads any leak as advisory) — not fold-C alone.
- **§6+§8 record-run coupling.** Canonical verdict = the record-run's verdict; every replay reproduces it bit-identically; a divergent replay (`ReplayMissError` / hash mismatch) is a loud fixture-integrity failure, never a silent re-derivation.
- **P1 (BLOCKING precondition for the cert RUN — 5c-ii, not 5c-i).** Commit the `validateSplitCover`-clean §5 split artifact (`{asOfCommit,trainPrs,heldOutPrs,excludedPrs,positiveControlPrs,negativeControlPrs,splitRule}`) under `.totem/spine/gate-1/` before the certifying run executes.

### Build sequence

1. **5c-i — deterministic firing path:** replace `runMockEngine`; real `enrichWithAstContext` + `applyAstRulesToAdditions(readStrategy)`; build `RuleFiring[]`; **A1** hard-gate; **C1** per-rule control results; **C2** exposure floor; **fold-F** archived assert; **fold-H** OQ4 matrix. Tested zero-LLM with fixture compiled rules + PR-diff fixtures. _(No split artifact needed — fixtures.)_
2. **5c-ii — orchestrator + freeze + persist:** **P1** split artifact committed first; live adapters in `Recording*` → compile → 5c-i firing → score → **fold-B** projection → **fold-C** parse-before-write (PASS-survivors only) + cert-run report; **A2** `record` subcommand; **L2** external hash; **fold-I** ledgers; **fold-K** E2E isolation.
