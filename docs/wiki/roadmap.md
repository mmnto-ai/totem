# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a standard library for codebase governance — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the active progression of enforcement primitives, platform validation, and rule distribution.

---

## 1.26.0: Pack Ecosystem Graduation (Active)

**Theme:** Close the Pack v0.1 alpha pilot by completing the publish-and-wire arc for bot packs, then collapse the convention-rule duplication between memory and packs. Pair with deterministic-substrate hardening for the rule classes currently encoded only as LLM-prose in CR/GCA styleguides (Tenet 15 violations surfaced by drift firing across multiple agents and repos).

The strategic frame is **publishing without runtime-wiring is incomplete; ship gates require both**. The substrate-wiring gap shipped in `mmnto-ai/totem#1795` (1.25.0) closed the runtime-completeness leg of the alpha-pilot graduation gate; 1.26.0 closes the publish-and-wire leg for bot packs and starts the convention-rule deterministic substrate.

- **Headline Work — Pack v0.1 graduation:**
  - [ ] **Bot-pack publish.** Lift `pack-staging/pack-bot-coderabbit-v0.1/` and `pack-staging/pack-bot-gemini-code-assist-v0.1/` to `@mmnto/pack-bot-coderabbit@1.x` and `@mmnto/pack-bot-gemini-code-assist@1.x` on npm. Publishing pipeline is proven; low risk.
  - [ ] **Bot-pack wire-into-hooks.** Session-start hooks for Claude Code and Gemini CLI consult the bot packs alongside the existing `totem describe` orientation pass. Same shape as the language-pack `extends` mechanism.
  - [ ] **Memory refactor.** Thin the bot-specific rules in agent memory that duplicate pack content; replace with one pointer rule directing future sessions to `@mmnto/pack-bot-coderabbit/workflows/*` and `@mmnto/pack-bot-gemini-code-assist/workflows/*` as the canonical source. Memory keeps session-incident receipts; the pack holds canonical operational rules.
  - [ ] **LC un-quarantine validation.** Pattern-quality review per `mmnto-ai/totem#1793` BEFORE un-quarantining the 4-rule `.rs` cohort (3 from upstream-014, 1 from upstream-048). End-to-end validation that PR #1795's substrate-wiring fix unblocks the LC PR-C cascade is the load-bearing signal that closes the alpha-pilot gate.

- **Headline Work — Substrate hardening (Tenet 15):**

  Convention rules currently encoded only as LLM-prose in CR `.coderabbit.yaml` and GCA `.gemini/styleguide.md`. Drift firing across multiple agents and repos documented in `mmnto-ai/totem-strategy/upstream-feedback/049`. Strategic posture: replace LLM-prose enforcement with regex / AST / schema enforcement wherever the rule has a deterministic shape.
  - [ ] **Built-in lint pack architecture (`mmnto-ai/totem#1800`).** Tier-1, broader Option B from `upstream-feedback/049`. Lift the convention-rules-as-deterministic-substrate primitive to a built-in lint pack so cross-repo consumers inherit deterministic enforcement of styleguide rules without local pack maintenance.
  - [ ] **`@mmnto/pack-voice` (`mmnto-ai/totem#1798`).** Tier-2, scope: core, domain: architecture. Compile voice rules from `voice-tuning-dataset.md` (em-dash detection, banned-vocab list, "Not X, but Y" patterns) into a deterministic pack with regex / ast-grep rules. First concrete instance of the `#1800` architecture; solves the cross-repo voice-rules access path problem.
  - [ ] **upstream-feedback/049 substrate response.** Local lint pack in totem-strategy for doubled-slug variants, bare-ref forms, section-link enforcement, and truncation residues. Lifts to `@mmnto/pack-governance` after false-positive rate stays low.
  - [ ] **`mmnto-ai/totem#1796` cwd/configRoot harmonization.** Tier-3. Mirror the eager `repoRoot` resolution pattern from PR #1787's `first-lint-promote-runner.ts` into `compile.ts:663` and `test-rules.ts`. Same monorepo-subpackage class of bug as PR #1787 fixed in T6.
  - [ ] **`mmnto-ai/totem#1801` batched embedding requests.** Tier-2. Substrate gap surfaced by upstream-feedback/050 — the `totem sync` provider currently issues one embedding request per chunk; batching reduces token-rate pressure on Gemini and Ollama.

- **Bundled Cleanup / Validation:**
  - [ ] **`mmnto-ai/totem#1685`** — `totem doctor` Stage 4 UX. T4 of #1684. Surface verification-outcomes state to operators.
  - [ ] **`mmnto-ai/totem#1686`** — Stage 4 perf hardening. T5 of #1684.
  - [ ] **`mmnto-ai/totem#1226`** — SARIF hex escape fix.
  - [ ] **`mmnto-ai/totem#1802`** — Tier-3 `config-schema.ts` comment alignment, surfaced from PR #1799 R1 Major.

---

## Backlog: Horizon 3+

Strategic research not currently scoped to 1.26.0:

- **Strategy #6** — Adversarial trap corpus: evaluation suite to test the deterministic engine against evasion techniques.
- **Model-specific prompt adapters** (Strategy #62) — partially addressed by `#1220` rewrite.
- **Formal model routing matrix** (Strategy #64) — partially addressed by `#73` benchmark.
- **`#1236`** — Revisit 6 upgrade-target lessons silenced during 1.13.0 cleanup.

Carried over and de-prioritized for 1.26.0:

- **ADR-091 non-Stage-4 ingestion work.** Classifier gate (Stage 2), GHAS / SARIF Extraction (Strategy #50, gated on ADR-086), Lint Warning Extraction (Strategy #51 ↔ #1253), ADR-mining extractor.
- **ADR-090 Substrate DX.** `mmnto-ai/totem#1497` (rich `describe_project` MCP), `mmnto-ai/totem#1498` (`totem init` agent-runtime auto-detect). Likely 1.27.0 or later.
- **`mmnto-ai/totem#1414`** — Pipeline 1 smoke-gate flip after 136-lesson Bad Example backfill. Mechanism shipped in `#1415`; hard enforcement deferred until the curation sweep.
- **`mmnto-ai/totem#1419`** — Cryptographic attestation for the Trap Ledger (SOX compliance gap, Proposal 225 enterprise pitch).

---

## Shipped Milestones

### 1.16.0 → 1.25.0: Ingestion + Pack v0.1 Alpha

The seven-week arc (2026-04-26 → 2026-05-02) that landed ADR-091 Stage 4 Codebase Verifier and the Pack v0.1 alpha pilot end-to-end.

- **1.16.0** (2026-04-26) — Ingestion Pipeline DX scaffolding.
- **1.18.0** (2026-04-29) — STRATEGY_ROOT resolver substrate (PR #1743). Four-layer precedence walk: env → config → sibling clone → legacy submodule. `.strategy/` submodule retired (PR #1749).
- **1.19.0** (2026-04-30) — ADR-091 Stage 4 Codebase Verifier headline (PR #1757, T1 of #1682). Public API: `verifyAgainstCodebase`, `getDefaultBaseline`, `resolveStage4Baseline`, `DEFAULT_BASELINE_GLOBS`, types `Stage4VerificationResult` / `Stage4Baseline` / `Stage4Outcome` / `Stage4VerifierDeps`. Four outcomes: no-matches → `'untested-against-codebase'`; out-of-scope → archive with `archivedReason: 'stage4-out-of-scope-match'`; in-scope-bad-example → `confidence: 'high'` (PROMOTE untested→active); candidate-debt → force `severity: 'warning'`.
- **1.22.0** (2026-05-01) — Pack v0.1 substrate per ADR-097 § 10. Public API: `loadInstalledPacks(options?)`, `loadedPacks()`, `isEngineSealed()`, `InstalledPacksManifestSchema`, `PackRegistrationAPI`, `PackRegisterCallback`, `LoadedPack`, `LoadInstalledPacksOptions`, `InstalledPacksManifest`. Synchronous `require()` mandated by ADR-097 § 5 Q5. Engine seal in `loadInstalledPacks()`.
- **1.23.0** (2026-05-01) — `@mmnto/pack-rust-architecture` first non-trivial third-party pack live on npm. `register.cjs` calls `api.registerLanguage('.rs', 'rust', wasmLoader)` AND `napi.registerDynamicLanguage({ rust })`. Bundles `tree-sitter-rust.wasm` (1.1 MB) from `@vscode/tree-sitter-wasm@0.3.1`. Tracer-bullet seed rule; full LLM-compile of 8-lesson set deferred until γ (`#1655`).
- **1.24.0** (2026-05-02) — Pack pending-verification install→lint promotion path (PR #1787, T3 of #1684). Public Bootstrap API: `promotePendingRules`, `applyOutcomeToRule`, `readVerificationOutcomes`, `writeVerificationOutcomes`, schemas in `verification-outcomes.ts`. CLI exports `stampPackRulesAsPending` + `PACK_INSTALL_ACTIVATION_MESSAGE`. `CompiledRule.status` enum is the 4-value form: `'active' | 'archived' | 'untested-against-codebase' | 'pending-verification'`. New committable `.totem/verification-outcomes.json` (canonical-key-order via shared `canonicalStringify`).
- **1.25.0** (2026-05-02) — Substrate-wiring fix (PR #1795). `bootstrapEngine(config, projectRoot)` helper at `packages/cli/src/utils/bootstrap-engine.ts` (async, dynamic-import per styleguide § 6, idempotent via `isEngineSealed()` short-circuit). Wired into `lint`, `shield` (estimate + main paths), `compile`, `test-rules`. Closes the Pack v0.1 graduation runtime-wiring leg.

### 1.15.0: Pack Distribution (2026-04-20)

The first shippable Totem pack plus the compile-hardening and zero-trust substrate that makes packs safe to distribute. Published `@mmnto/cli@1.15.0`, `@mmnto/totem@1.15.0`, `@mmnto/mcp@1.15.0` to npm on 2026-04-20 PM.

- **Pack Distribution:** `@mmnto/pack-agent-security` flagship pack (5 immutable security rules covering unauthorized process spawning, dynamic code evaluation, network exfiltration, obfuscated string assembly), `totem install pack/<name>` command, `pack-merge` primitive refusing immutable downgrade, content-hash substrate across TypeScript and bash.
- **Zero-trust default (ADR-089):** Pipeline 2 and Pipeline 3 LLM-generated rules ship `unverified: true` unconditionally; `totem rule promote <hash>` atomic activation CLI; Pipeline 1 (manual) keeps its conditional semantics.
- **Compile hardening (ADR-088 Phase 1):** Layer 3 verify-retry, bidirectional smoke gate (`badExample` + `goodExample`), `archivedAt` round-trip preservation, 9-value `NonCompilableReasonCodeSchema` enum, `totem doctor` stale-rule + grandfathered-rule advisories.
- **Platform:** Compound ast-grep rules (ADR-087, from Proposal 226), Windows shell-injection fix in `safeExec` via `cross-spawn.sync`, Cross-Repo Context Mesh, standalone binaries on darwin-arm64 / linux-x64 / win32-x64.
- **Positioning:** ADR-090 (Multi-Agent State Substrate) bounds future "is this a Totem feature?" decisions; ADR-091 (Ingestion Pipeline Refinements) redefines the 1.16.0 ingestion flow as a 5-stage funnel; ADR-085 (Pack Ecosystem) accepted with five deferred decisions resolved.

### 1.15.x: LC-Velocity Quality Cluster

Eight patch releases over five days (2026-04-22 to 2026-04-26) closing the LC-velocity classifier batch and the strategy upstream-feedback queue.

- **1.15.1** (2026-04-22): `totem proposal new` + `totem adr new` governance authoring scaffolding (#1615). LC upstream triage closeout.
- **1.15.2** (2026-04-22): Archive-in-place durability (#1587). `totem lesson compile --refresh-manifest` no-LLM primitive + `totem lesson archive <hash>` atomic command.
- **1.15.3** (2026-04-23): Compile-worker quality cluster + runtime ReDoS defense. `context-required` classifier (#1639), `semantic-analysis-required` classifier + ledger hygiene (#1640), bounded regex execution via persistent Node worker thread + `totem lint --timeout-mode` flag (#1644).
- **1.15.4** (2026-04-24): LC-velocity classifier improvements. Test-contract scope classifier (#1652), declared severity override (#1658).
- **1.15.5** (2026-04-25): `applies-to` lesson frontmatter substrate (#1667). Closed role taxonomy of seven values plus `'any'` fallback.
- **1.15.6** (2026-04-25): source-Scope override (#1674). Author-declared `**Scope:**` overrides LLM emission and the #1626 test-contract auto-include heuristic.
- **1.15.7** (2026-04-26): `self-suppressing-pattern` reasonCode (#1688). New ledger entry on `NonCompilableReasonCodeSchema` for compile-time self-suppression detection.
- **1.15.8** (2026-04-26): `totem triage-pr` strict-by-id dedup (#1690). Deterministic `rootCommentId` replaces fuzzy fingerprint matching.

### 1.14.x: Foundation + Pack Substrate

Fourteen releases over ten days (2026-04-09 to 2026-04-19). Headline foundation work in 1.14.0, a four-P0 governance sweep across 1.14.3 through 1.14.5, quality sweep + capstone in 1.14.6 and 1.14.7, perf follow-up in 1.14.8, precision + bundle release on 2026-04-15, ADR-088 Phase 1 substrate + `@mmnto/pack-agent-security` flagship pack in 1.14.11–13.

- **1.14.0** (2026-04-09): Cross-Repo Context Mesh (#1295), LLM Context Caching opt-in preview (#1292), `/preflight` v2 design-doc gate (#1296).
- **1.14.1** (2026-04-11): Hotfix Sweep and Phase 1 Papercuts. Nine PRs including Pipeline 5 sanity gate, compile prune no-op fix, tilde-fence support.
- **1.14.2** (2026-04-11): `DISPLAY_TAG = 'Review'` cosmetic split; `TAG = 'Shield'` internal routing identifier preserved (coordinated rename tracked in #1335).
- **1.14.3** (2026-04-11): Archive Lie filter (#1345). `loadCompiledRules` now filters out archived status; self-healing loop is no longer a placebo.
- **1.14.4** (2026-04-11): Compile manifest drift refresh (#1348) + parser-based ast-grep validation (#1349).
- **1.14.5** (2026-04-11): `safeExec` rewrite on `cross-spawn.sync` (#1356), closing a latent Windows shell-injection vector that had been open for three weeks.
- **1.14.6** (2026-04-13): Quality Sweep Phase 1-2 and Voice Compliance. 7 over-broad rules archived; voice-scrub follow-ups (#1379, #1382, #1383).
- **1.14.7** (2026-04-13): Nervous System Capstone. Mesh completion (#1396), bot reply protocol docs (#1395), cause-chain migration (#1357).
- **1.14.8** (2026-04-14): Perf Follow-up. `cwd` threading (#1401), batch upgrade hashes (#1401), PR template enforcement (#1402).
- **1.14.9** (2026-04-15): The Precision Engine. Compound ast-grep rule support (#1410, #1412, #1415), compile-time smoke gate, `badExample` requirement (#1420) closing the LLM-hallucination loop.
- **1.14.10** (2026-04-15): The Bundle Release. Shell-orchestrator `{model}` token RCE fix (#1429), Pipeline 1 compound rule authoring + fail-loud fixes in `git.ts` and `rule-engine.ts` (#1454).
- **1.14.11** (2026-04-17 - 2026-04-18): Pre-1.15-review Phase B first wave. `@mmnto/pack-agent-security` scaffold (#1503), ADR-088 Phase 1 Layer 3 verify-retry (#1513), immutable severity flag + pack-merge primitive (#1510, #1515), `totem install pack/<name>` (#1516). `--force` / `--no-force` content-hash stamping (#1531).
- **1.14.12** (2026-04-18): ADR-088 Phase 1 Layers 3+4 substrate. `unverified` flag on `CompiledRule` (#1544), `nonCompilable` 4-tuple with `NonCompilableReasonCodeSchema` enum (9 values), Read/Write schema split, security zero-tolerance (#1548), `--verbose` layer trace + `totem doctor` stale-rule advisory (#1549). Five security rules shipped on the flagship pack (#1521, #1522).
- **1.14.13** (2026-04-19): RuleEngineContext thread-through. `fix(core)` removes `setCoreLogger` / `resetShieldContextWarning` module-level state in favor of `RuleEngineContext` threaded through `applyRulesToAdditions`, `applyAstRulesToAdditions`, `applyRules`, `extractJustification` (#1553). Closes the #1441 shared-mutable-global concurrency hazard. Inline archive of over-broad `TotemError($MSG, $$$REST)` rule (`4b091a1bc7d286d6`) via postmerge #1568.

### 1.13.0: The Refinement Engine (2026-04-07)

**Theme:** Telemetry-driven rule refinement, compilation routing, and structural pattern upgrades.

- **Compilation Routing:** Compile pipeline routes through Claude Sonnet 4.6 (90% correctness vs Gemini Pro's 73%, 2.4s vs 19.6s avg per Strategy #73 benchmark). Bulk recompile of 1156 lessons dropped 438 rules to 393 after purging 143 noisy Gemini-hallucinated rules and upgrading 102 regex rules to ast-grep structural matching.
- **Telemetry-Driven Refinement:** `RuleMetric.contextCounts` tracks per-context match distribution (code, string, comment, regex, unknown). `totem doctor checkUpgradeCandidates` flags regex rules with >20% non-code-context matches. `totem compile --upgrade <hash>` re-compiles a single rule with a telemetry-driven directive prompt. Self-healing `totem doctor --pr` calls `compileCommand` in-process.
- **Pipeline Hygiene:** Wind tunnel skips auto-scaffolded TODO fixtures. Extract pipeline dedups at heading level before embedding similarity. Config drift test uses token-aware character + directive count limit.
- **AST Coverage:** 8 empty-catch rules upgraded from the legacy Tree-sitter `#eq?` engine to ast-grep structural matching. Backtick wrapper stripping hardened in both Pipeline 1 (manual `**Pattern:**` extraction) and Pipeline 2 (LLM JSON output).
- **Governance:** Lesson Protection Rule (Pipeline 1 lint rule, severity error) blocks destructive shell removal of `.totem/lessons.md` at the point of intent. Added after a 41-rule near-miss. Self-governance: use totem to govern totem.
- **Standalone Binaries:** Real binaries shipped on darwin-arm64 (68 MB), linux-x64 (111 MB), win32-x64 (125 MB) via the #1241 arc (4 PRs: #1260, #1261, #1266, #1267). Original 50 MB cap was aspirational; actual Bun 1.2.x runtime baseline is 60-104 MB depending on platform.

### 1.12.0: The Umpire & The Router (2026-04-05)

Standalone binary, research validation, and platform hardening.

- **Lite-Tier Binary:** Standalone executable with WASM ast-grep engine — no native dependencies, three platforms (linux-x64, darwin-arm64, win32-x64).
- **gemma4 Evaluation:** Auto-detect Ollama environments and validate local model viability. gemma4:26b benchmarked at 80% parse / 93% safe / 90s avg — kept for triage but ruled out for compile.
- **AST-Grep Coverage:** Extended ast-grep coverage to ESLint restricted-properties rules.
- **Windows CI:** Resolved orchestrator timeout constraints on Windows runners.
- **Context Tuning:** Proposal 213 Phases 2+3 — CLAUDE.md pulse check, GCA/CR tenets injected into bot configs.

### 1.11.0: The Import Engine (2026-04-04)

Brought governance rules from external tools and other instances into the platform.

- **Portability:** Enabled cross-repository rule sharing between instances and imported rules from modern ESLint flat config formats.
- **Language Support:** Added baseline proactive rule packs for TypeScript, Shell, and Node.js built on established best practices.

### 1.10.2: Phase 2 Import Engine Foundations (2026-04-04)

Hardened compiler safety and expanded ESLint import coverage.

- **Safety:** Rejected self-suppressing patterns and tracked removed rules via a retirement ledger to prevent re-extraction.
- **Enforcement:** Updated default model selections and expanded extraction handlers for restricted properties and syntax rules.

### 1.10.1: Phase 1 Bug Fixes (2026-04-04)

Hardened the release pipeline and improved rule hygiene prior to major feature additions.

- **Hygiene:** Deduplicated false-positive exemptions and audited rule conflicts to reduce overall rule overlaps.
- **Compliance:** Narrowed exit scope rules to exclude CLI entries and improved POSIX compliance for multi-line shell hooks.

### 1.10.0: The Invisible Exoskeleton (2026-04-02)

Reduced adoption friction for solo developers and new repository environments.

- **Developer Experience:** Added time-bounded pilot modes, local extraction options, and global profile support.
- **Enforcement Validation:** Introduced strict tiers with agent auto-detection and formalized format checks in pre-push hooks.
- **Pipeline Refactoring:** Hardened environment variable parsing and refactored the extraction pipeline into distinct per-mode modules.

### 1.9.0: Pipeline Engine (2026-04-01)

Established multiple pipelines for rule creation, from manual scaffolding to fully autonomous extraction.

- **Rule Scaffolding:** Supported manual generation with test fixtures, example-based compilation, and prose-to-pattern translation.
- **Automation:** Staged observation findings automatically. Translated external tool configurations without any language model involvement.
- **Ecosystem:** Refreshed documentation, overhauled the playground, and published pre-compiled baseline rules for additional languages.

### 1.7.0: Platform of Primitives (2026-03-29)

Redesigned the command structure and stabilized context engineering.

- **Architecture:** Transitioned to stateless hooks, hierarchical command structures, and hash-locked execution boundaries.
- **Context Management:** Deployed fallback search for agent context injection, repository discovery commands, and structured handoff validations.
- **Lifecycle:** Added garbage collection with adaptive decay and throughput-based ETA for compilation progress.

### 1.6.0: Pipeline Maturity (2026-03-22)

Finalized the core self-healing loop and core enforcement testing structures.

- **Enforcement Core:** Delivered inline rule unit testing, standard libraries, and tracking ledgers for evasion traps.
- **Developer Experience:** Improved compiler workflows, implemented auto-refreshing flag mechanisms, and integrated stress testing.
