# ADR-111 miner slice 5b — live LLM adapters + frozen replay fixture — BUILD SPEC

**Contract source of truth:** `adr/adr-111-spine-gate-1-rule-mining-miner.md` (totem-strategy@main). Parent design + the 4/4 panel folds: `.totem/specs/adr-111-slice5-certifying-run.md`. Builds on 5a (merged #2207, the live `ReviewThreadSource` + resolution gate).
**Grounded:** 2026-06-20 via an Explore seam-map (the two core ports, the orchestrator stack, the windtunnel-lock integrity pattern, the extract/classify stage-deps wiring). `totem spec` skipped (cross-repo-ADR-driven, per #2172).
**Status:** PANEL COMPLETE (4/4) — FAITHFUL/APPROVE-with-folds, no rejection. **Decision: SPLIT 5b → 5b-i (deterministic scaffold) + 5b-ii (live prompts)** (strategy + agy converge). Build gated on per-sub-slice operator go. See `## Panel verdicts (4/4) + consolidated folds`.

## What 5b is

The miner's **first non-deterministic, LLM-backed, network-dependent** components: thin CLI adapters implementing the two core ports by calling the existing orchestrators, PLUS a **frozen replay fixture** so a live-LLM certifying run stays re-runnable + auditable (fold A — the panel's central open question, ruled contract-MANDATED by strategy via §6+§8+Tenet-15). No core changes beyond what the ports already expose; non-determinism stays entirely in the CLI adapter layer (core ports are deterministic by contract).

## The two ports (core-defined, 5b CLI-implements)

1. **`DraftExtractor.draft(content: ReviewThreadContent): Promise<string[]>`** (`extract.ts:136`). Returns zero-or-more lesson-markdown DSL bodies. **Error contract: returns `[]` on ANY per-PR failure (LLM/network/timeout/refusal) — MUST NOT throw** (a throw aborts the whole train sweep; `[]` is a creditable FM-i loud drop in core). Each returned string is preflight-gated by core's `isUsableDsl` (`**Pattern:**`/yaml), so a malformed draft is core's `unparseable` drop, not the adapter's problem.
2. **`DraftClassifier.classify(draft: DraftCandidate): Promise<ClassifierResult>`** (`classify.ts:97`). `ClassifierResult = { disposition: 'structural'|'behavioral', dispositionSource: 'classified'|'error-default' }`. **Error contract: safe-default `{ behavioral, error-default }` on per-candidate failure — MUST NOT throw.** The Zod `.refine` enforces `error-default ⟹ behavioral` (low-privilege, RAG-only — never compile-routed; Tenet 9).

Both ports are **seed-blind by construction** — neither carries a seed class, so the adapter structurally cannot see the train/test split (FM-f).

## Orchestrator reuse (Tenet-21 — wrap, don't reinvent)

The adapters call the EXISTING CLI orchestrator stack — no new LLM client:

- **`runOrchestrator(opts)`** (`utils.ts:621`) is the high-level wrapper used by `extract-pr.ts:255` + `review-learn.ts:331` (assemble prompt → invoke → parse). Reuse this path: it handles provider routing, grounding, caching, admission, artifact emission.
- Under it: `InvokeOrchestrator = (OrchestratorInvokeOptions) => Promise<OrchestratorResult>` (`orchestrator.ts:93`); `createOrchestrator(config)` routes on provider (anthropic/gemini/openai/ollama/shell). `OrchestratorResult.content` is the LLM text.
- **`temperature: 0`** for determinism intent (the LLM is still non-deterministic in practice → why the replay fixture exists).

## Fold A — the frozen replay fixture (the crux)

**Goal (strategy, contract-MANDATED):** the certifying run produces its candidate set ONCE via live LLM; that exact output is frozen into a committed artifact; the scorer + the §8 FM harness + every re-run operate ONLY on the frozen artifact, **zero-LLM**. Symmetric to the wind-tunnel lock. The freeze must capture the **exact** outputs that produced the canonical verdict (else replay diverges from the verdict).

**Mechanism (mirror `windtunnel-lock.ts`'s git-hash-object integrity):**

- A **record/replay decorator pair** around each live adapter:
  - `RecordingDraftExtractor(live, artifact)` — pass-through to the live adapter, append `{ inputKey, output }` to the artifact (record mode, run once).
  - `ReplayDraftExtractor(artifact)` — pure: look up `inputKey` → return the recorded output, zero-LLM (replay mode, every re-run + CI). Same pair for the classifier.
- **`inputKey` = a stable content hash** of the semantically-relevant input — extractor: `sha256(canonicalJson({ pr, threads }))`; classifier: `sha256(canonicalJson({ provenance, dslSource }))`. Deterministic, order-stable.
- **Replay miss = fail loud.** If a replay lookup misses (input changed / key absent), the adapter THROWS (not `[]`/safe-default) — a missing recording is a corpus-integrity failure, NOT a per-item LLM failure. This is the line that makes drift detectable (agy fold-A drift-detection test: mutate one recorded entry → run fails loud, not silently absorbed).
- **Artifact integrity:** committed JSON (Zod-schema'd `llm-replay.v1`), git-hash-object integrity like `controls.integrity.fixtureSha`, ancestry-checked at run time (the C3/C6 freeze-proof pattern). A re-record that changes any output changes the hash → detected.

**Open design point for the panel:** is the replay artifact ONE file or two (extractor + classifier)? And does it live under `.totem/spine/gate-1/` next to `windtunnel.lock.json`?

## Fold G — fail-soft per-item, fail-loud on global misconfig (codex)

- **Per-item (fail-soft):** an LLM/network error on ONE PR/candidate → `[]` / safe-default (the port contract). Core loud-drops it; the run continues.
- **Global (fail-loud):** a missing API key, unresolvable model, or prompt-asset load failure is NOT per-item — it would return `[]` for EVERY PR and masquerade as structural-signal sparsity. The adapter must **validate configuration before the mining loop** (construction-time or a pre-flight probe) and THROW if the provider can't run at all. Separate the extractor-failure count from core's `unparseable` drop so the terminal report can name it.

## The prompts (the OQ2 feasibility risk)

5b is where the slice-2/3 OQ2 deferral lands: the actual prompts.

- **Extract prompt:** review-thread → zero-or-more lesson-markdown DSL bodies (a `**Pattern:**` or ast-grep yaml rule capturing the structural invariant the human reviewer asserted). The decaying-prompt + feasibility risk lives here.
- **Classify prompt:** DSL body → `structural` (syntactic-invariant, compile-eligible) vs `behavioral` (RAG-only). Safe-default `behavioral` on any ambiguity.
- Prompts are CLI-side assets (reuse the `extract-pr`/`review-learn` prompt-assembly convention). They must be FROZEN into the replay artifact's provenance so a prompt change is a re-record (drift), not a silent verdict shift.

## Tests (deterministic, CI-locked, zero-network)

1. **Replay determinism:** record a fixture from a stubbed orchestrator → replay → identical `string[]`/`ClassifierResult`; byte-reproducible.
2. **Drift detection (agy fold A):** mutate one recorded entry → replay run FAILS LOUD (hash mismatch / key miss), not silently absorbed.
3. **Per-item fail-soft:** a stubbed orchestrator that throws on one input → adapter returns `[]`/safe-default for THAT item, no throw.
4. **Global fail-loud (fold G):** missing-key / unresolvable-model → adapter throws BEFORE the loop; distinct from per-item.
5. **Safe-default contract:** classifier failure → `{ behavioral, error-default }` (the `.refine` holds).
6. **Seed-blindness by construction:** the port shape carries no seed class (structural assertion).
7. **Real gate:** full-branch `totem lint --base main` + repo-wide `format:check` + full core+cli suites under pinned pnpm; the live-adapter tests MUST NOT hit the network in CI (replay/stub only).

## Open questions for the panel

1. **Sub-slicing — is 5b ONE PR or two?** The live adapters (+ prompts) and the replay-fixture mechanism are coupled (the fixture records the adapter's output). Rec: ONE PR (they're a unit), but flag if the prompts' feasibility risk argues for landing the record/replay scaffold first (deterministic) and the live prompts second.
2. **Replay artifact shape (fold A)** — one file or two; location; the `inputKey` hash basis (does the extractor key include the merge SHA? the classifier key the full provenance?); and is git-hash-object integrity the right mechanism vs a Zod-validated self-hash.
3. **Replay-miss semantics** — confirm a miss is fail-loud (THROW), NOT the per-item `[]`/safe-default — so drift is detectable. (Rec: throw; this is the whole point of the fixture.)
4. **Prompt provenance in the freeze** — must a prompt change force a re-record? (Rec: yes — freeze the prompt hash into the artifact so a silent prompt edit can't shift the canonical verdict.)
5. **fail-loud probe (fold G)** — construction-time validation vs a one-shot pre-flight call; how to detect "globally unavailable" without burning a real LLM call in the deterministic path.

## Panel verdicts (4/4) + consolidated folds

Run 2026-06-20 (#2167 independence). **4/4 FAITHFUL/APPROVE-with-folds; no rejection; design survives.** Note: agy's first reply (0527Z) mis-routed to the slice-5 brief; re-pinged → corrected 5b verdict (0534Z).

- **totem-codex** (contract/correctness): CONCERN-with-contract-folds — 7 folds.
- **strategy-claude** (ADR-111 fidelity / contract owner): FAITHFUL — the record/replay decorator discharges the OQ3 ruling. 3 affirms, 1 Tenet-20 sharpen, 1 divergence (split), 2 catches.
- **totem-gemini** (tenet/architecture): APPROVED, no folds.
- **totem-agy** (build/test-completeness): PASS-with-4-folds; breaks the split tie → SPLIT.

### Settled decisions

- **SPLIT 5b → 5b-i + 5b-ii** (strategy + agy converge). **5b-i:** `Recording*`/`Replay*` decorators + `llm-replay.v1` serialization + integrity gate + drift/miss/fail-loud tests, backed by a **stub orchestrator** (zero live LLM, hermetic CI). **5b-ii:** the live extract/classify prompts + real `runOrchestrator` wiring + provider routing. Rationale: isolate the contract-mandated containment from the feasibility-risky decaying prompt (OQ2); the scaffold is 100% testable in isolation; establishes the replay-only CI regime before any network code lands.
- **Freeze the RAW pre-funnel LLM output; DERIVE the §8 ledgers + candidate set** (strategy Tenet-20 + agy). The replay fixture maps `inputKey → raw LLM text`; `isUsableDsl` drops + emissions are regenerated by re-running the deterministic funnel. The fixture and the emission ledger are NOT both authoritative (that's the Tenet-20 mirror that drifts) — fixture = raw (frozen); ledgers = derived. Records block is strictly `inputKey → rawOutput`; never write `durationMs`/`recordedAt`/local metadata into it (agy).

### Consolidated fold list (dedup'd; tagged by sub-slice)

**A. Replay-miss = THROW, outside the live fail-soft catch (codex + strategy + agy + gemini).** Replay throws on: missing key, duplicate `(adapterKind, inputKey)`, schema mismatch, integrity mismatch, wrong adapter kind. A recorded `[]`/`error-default` is a REAL row, **distinguishable from a miss** (codex). A miss is a corpus-integrity failure (the §6 frozen-experiment premise broken), never absorbed as `[]`/safe-default. → **5b-i**

**B. Integrity = external committed expected-hash, NOT a self-hash (RESOLVED cross-seat conflict).** agy proposed an in-artifact `integrity.recordsSha256` self-hash; strategy + codex reject a self-hash as **circular** (the artifact attesting its own integrity — a content+hash co-rewrite passes; Tenet-20 mirror). **Resolution (controller): external expected-hash wins** — the expected fixture content-hash lives in a SEPARATE committed lock surface (the wind-tunnel C3/C6 pattern: `git hash-object` content digest, ancestry-checked, re-derived + compared at run time). In 5b-i the Replay adapter takes the expected hash **injected** (constructor param) and throws on mismatch; 5c wires it from the committed lock. agy's mutate-one-entry red test still applies — it asserts the content-hash-vs-expected mismatch throws (now defeating co-rewrite too). → **5b-i (verify) / 5c (lock-wire)**

**C. fold-G = construction-time validation + "all-items-failed ⟹ throw" floor; verdict-integrity-CRITICAL (strategy + agy + codex).** A global misconfig (missing key / dead provider) returning `[]` for EVERY PR → a **false HONEST-NEGATIVE** → the N=1 thesis reads as refuted when the LLM never ran (strategy: the single most dangerous failure mode). Fix: a synchronous `verifyConfiguration` (construction-time — key/model/prompt-asset present) that throws BEFORE the loop; PLUS an end-of-run `if (total>0 && success===0) throw SystemicPipelineError` floor (agy). **No live pre-flight LLM call** in the deterministic path (strategy). Per-item failure stays fail-soft (`[]`/safe-default). → **5b-ii (live) with the floor testable in 5b-i via stub**

**D. `inputKey` folds (codex + agy).** Extractor key = `sha256(canonicalJson({keyVersion:'extractor:v1', pr, mergeCommitSha, threads:normalizedEligible}))` — **MUST include `mergeCommitSha`** + the exact 5a-FILTERED (eligible) thread set, not pre-filter. **Array stability is an explicit contract** — normalize threads/comments before hashing AND prompt assembly; sort by stable identity (path/position); carry provider-neutral `threadRef`/`commentRef` if duplicates are otherwise indistinguishable. Classifier key needs a **`draftRef`/ordinal** (`runClassifyStage` doesn't dedupe → two drafts from one provenance must not collide) + `keyVersion:'classifier:v1'`. Strip non-deterministic fields before hashing. → **5b-i**

**E. Own fail-loud replay writer/validator — don't trust `runOrchestrator` artifacts/cache (codex).** `runOrchestrator` masks prompt content (DLP), treats artifact writes as non-fatal (warning-only), and cache hits may emit no artifact. So 5b needs its OWN fail-loud writer/validator. **Record mode must force fresh live calls** (cache must not pretend to be live); **replay mode must not depend on `runOrchestrator` artifact emission**. → **5b-ii (record) / 5b-i (validator)**

**F. Prompt + provider provenance bound into the integrity gate (codex + strategy + gemini).** A **run-level** provenance field (cleaner than per-item `inputKey` — strategy) covered by the integrity gate, binding: prompt-template-hash + system-prompt-hash, prompt-builder version, output-parser/schema version, provider + qualified model + temperature + orchestrator version, adapter-kind + key-version, totem/CLI version. A prompt edit invalidates the whole fixture → forces a re-record (loud), never a silent verdict shift. → **5b-ii (populate) / 5b-i (gate)**

**G. `ClassifierResult` adapter contract (codex).** Closed-set, single unambiguous disposition → `classified`. Refusal / timeout / invalid-JSON / multiple-labels / missing-label / partial parse → safe-default `{behavioral, error-default}`. Do NOT classify ambiguous output as `behavioral`/`classified` (erases model-judgment vs adapter-couldn't-parse). An adapter bug like `{structural, error-default}` must fail the `.refine` LOUDLY in tests. → **5b-ii**

**H. No-network-in-CI (agy + codex).** Constructor-injected `InvokeOrchestrator` seam (like 5a's `GhExec`); `undici` `MockAgent.disableNetConnect()` in the test setup; an init guard `if (process.env.CI && !process.env.ALLOW_LIVE_LLM_IN_CI) throw`. → **5b-i (seam) / 5b-ii (guard)**

**I. Keep emitting the FM-f attestation (strategy catch).** Seed-blind-by-construction satisfies the spirit, but §8 defines FM-f as the emission ledger's run-level `extractionInputsAttestation` — confirm the live 5b extractor still emits it (5b is the first live extractor). → **5b-ii**

## Dispositions

- **Panel 2026-06-20 (4/4):** codex CONCERN-with-folds · strategy FAITHFUL (Tenet-20 freeze-raw + split + verdict-integrity) · gemini APPROVED · agy PASS-with-folds (split tie → SPLIT). Consolidated fold list above. One cross-seat conflict (self-hash vs external-hash) resolved by the controller → external committed expected-hash.
- **Per-sub-slice build = pending operator go.** Next: **5b-i** (deterministic record/replay scaffold + integrity + drift/miss/fail-loud tests, stub-backed — folds A/B-verify/D/E-validator/F-gate/H-seam, no live LLM). Then 5b-ii (live prompts + orchestrator — folds C/E-record/F-populate/G/H-guard/I).
