---
'@mmnto/cli': minor
'@mmnto/totem': minor
---

feat(cli+core): `compile_worker_fingerprint` producer attestation + `verify-manifest` drift gate (Proposal 278 § Action 3 Phase 1)

Ships the implementation slice of [mmnto-ai/totem-strategy#335](https://github.com/mmnto-ai/totem-strategy/pull/335) (Proposal 278 — Compile-Worker Determinism Interim Policy). Phase 1 scope is the anthropic-direct provider only; shell-orchestrator capture is a Phase 2 follow-on that does not gate this merge.

**New manifest field.** `CompileManifestSchema` gains an optional `compile_worker_fingerprint: string` sibling to the existing `model` field. The fingerprint is `sha256(canonicalStringify({model, temperature?, seed?, promptTemplateContentHash}))` — `canonicalStringify` drops undefined keys, so the fingerprint records _absence_ (omits the slot) when the configured model rejects a sampling parameter rather than encoding a placeholder. Pre-#1937 manifests parse unchanged (field is optional).

**New `@mmnto/totem` exports:** `computeCompileWorkerFingerprint`, `modelStripsTemperature`, `readPromptTemplateContentHash`, plus the `CompileWorkerFingerprintInputs` type. The `compile_run` event type joins the LedgerEventSchema enum.

**Capture in `totem compile`.** When `config.orchestrator.provider === 'anthropic'`, both manifest-write sites (post-prune at compile.ts:1195 and full-recompile at :1739) populate the fingerprint. Other providers leave it undefined; `verify-manifest` drift surveillance is a no-op when either side is undefined. The `--refresh-manifest` path (compile.ts:814) preserves the existing fingerprint — refresh is provenance-preserving by design; `output_hash` and `compile_worker_fingerprint` are orthogonal axes (recompute trigger vs. worker attestation). Each compile-worker invocation also emits a `compile_run` event to the Trap Ledger (`source: 'lint'`, `activity_name: <provider>`); fire-and-forget per A.3.a writer contract.

**Drift gate in `totem verify-manifest`.** After the existing input/output hash checks, the command reads origin/main's `compile_worker_fingerprint` via `git show main:.totem/compile-manifest.json` (falling back to `origin/main`) and compares. When the fingerprints differ AND `packages/cli/src/commands/compile-templates.ts` is NOT in the branch diff (`git diff main...HEAD --name-only`), the command fails with a recovery hint. The check is best-effort on origin/main lookup: when the remote ref is unreachable, the drift check no-ops rather than blocking — verify-manifest's existing hash gates still apply.

**`--allow-compile-drift` override flag.** Bypasses the drift gate with mandatory articulation. Two enforcement paths:

1. **CI (PR body available via `gh pr view --json body`):** requires a `## Compile Drift Justification` heading in the PR body. The heading is the binding accountability surface at merge time.
2. **Pre-push (no open PR):** requires the `TOTEM_DRIFT_JUSTIFICATION` env var to be set non-empty. Contents are not validated — the act of typing the justification is the forcing function. Per Proposal 278 § Q3 fortification.

**Intent-not-reality (Tenet 19).** The fingerprint reflects what the worker is _configured_ to send, not what the API _accepts_. For Opus 4.7+ (per `docs/reference/supported-models.md` lines 50-52, which rejects `temperature`/`top_p`/`top_k` with HTTP 400), `modelStripsTemperature()` returns true and the fingerprint records temperature absence — even though `compile.ts:1257` still hardcodes `temperature: 0` at the `runOrchestrator` call. [mmnto-ai/totem#1476](https://github.com/mmnto-ai/totem/issues/1476) tracks the latent SDK fix for the seven sites that still pass `temperature` against the SDK; this PR documents the latency without fixing it.

**Prompt-template content hash.** Hashes `packages/cli/src/commands/compile-templates.ts` (or its built `compile-templates.js` sibling at runtime, resolved via `import.meta.url`). Per Path A in Proposal 278 § Open Questions, the source `.ts` and built `.js` move in lockstep through tsc — drift surfaces either way. The file is 100% prompt-relevant (`KIND_ALLOW_LIST` + `COMPILER_SYSTEM_PROMPT` + `PIPELINE3_COMPILER_PROMPT`); no orthogonal utility code makes the file-level hash a false-positive risk.

**Detection regex.** `modelStripsTemperature()` matches `/opus-4-[7-9]|opus-[5-9]/`. Naive but matches the current Anthropic family naming (`claude-opus-4-7`, `claude-opus-4-7-1`, future `claude-opus-5-0`). When Anthropic ships a new family that strips sampling params (Sonnet 5.0+, Haiku 5.0+), widen here. A.3.b's `totem doctor --compliance` is the natural future home for richer reconciliation.

**Tests.** 6 new unit tests on `computeCompileWorkerFingerprint` (determinism, model/temperature/prompt-hash sensitivity, absence-vs-placeholder distinction, sha256-shape), 12 cases on `modelStripsTemperature`, 2 cases on `readPromptTemplateContentHash` (line-ending normalization, missing-file error class), 2 cases on the schema (pre-#1937 manifest parses; new manifest roundtrips). 6 integration tests on `verify-manifest` exercise the drift gate against real git repos: same-fingerprint passes, no-fingerprint passes (Phase 1 anthropic-only), drift-without-template-edit fails, drift-with-template-edit passes, override-without-justification fails, override-with-`TOTEM_DRIFT_JUSTIFICATION` passes. Full local sweep: 1947 `@mmnto/totem` tests + 2174 `@mmnto/cli` tests green.

**Cohort pause.** This is the gating implementation PR for [mmnto-ai/totem-strategy#335](https://github.com/mmnto-ai/totem-strategy/pull/335) Proposal 278. The cohort PR pause broadcast at `_broadcast/inbox/2026-05-16T0818Z-strategy-claude.md` (non-urgent rule-touching PRs deferred across cohort) lifts once this lands.

Closes the Action 3 Phase 1 implementation surface. Phase 2 (shell-orchestrator capture) + sibling option (d) (decouple wind-tunnel fixtures from `lessonHash`) + [mmnto-ai/totem#1938](https://github.com/mmnto-ai/totem/issues/1938) per-orphan dispositions proceed in parallel post-merge.
