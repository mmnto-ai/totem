# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a standard library for codebase governance — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the active progression of enforcement primitives, platform validation, and rule distribution.

---

## 1.26.0: Pack Ecosystem Graduation (Active)

**Theme:** Close the Pack Ecosystem alpha-pilot graduation by completing the publishes-and-wires arc for bot packs, then collapse convention-rule duplication between agent memory and packs. Pair with deterministic-substrate hardening for rule classes currently encoded only as LLM-prose in CR / GCA styleguides (Tenet 15 violations surfaced by drift firing N=7+ across PR cycles).

The strategic frame is "publishing without runtime-wiring is incomplete; ship gates require both." Memory rule `feedback_publishing_requires_wiring.md` codifies the principle after the substrate-wiring gap took 1.22.0 → 1.25.0 to close.

- **Headline Work — Pack v0.1 Graduation:**
  - [ ] **Bot-pack publish:** `@mmnto/pack-bot-coderabbit@1.x` and `@mmnto/pack-bot-gemini-code-assist@1.x` to npm. Lift from `pack-staging/` per the proven `@mmnto/pack-rust-architecture` publish pipeline.
  - [ ] **Bot-pack wire-into-hooks:** Session-start hooks for Claude Code and Gemini CLI consult the bot packs alongside the existing orientation pass.
  - [ ] **Memory-as-pack-pointer refactor:** Thin or remove the bot-specific rules in agent memory that duplicate pack content; replace with one pointer rule citing `@mmnto/pack-bot-coderabbit/workflows/*` and `@mmnto/pack-bot-gemini-code-assist/workflows/*` as canonical.
  - [ ] **LC un-quarantine validation:** Pattern-quality review per `mmnto-ai/totem#1793` BEFORE un-quarantining the 4-rule `.rs` cohort. End-to-end empirical validation that PR #1795's substrate-wiring fix unblocks the LC PR-C cascade is the load-bearing signal that closes the alpha-pilot gate.

- **Headline Work — Substrate Hardening (Tenet 15):**
  - [ ] **`@mmnto/pack-voice` (`mmnto-ai/totem#1798`).** Tier-2, scope: core, domain: architecture. Compile voice rules from `voice-tuning-dataset.md` (em-dash detection, banned-vocab list, "Not X, but Y" patterns) into a deterministic pack with regex / ast-grep rules. Solves the cross-repo voice-rules access path problem.
  - [ ] **upstream-feedback/049 substrate response.** Two options not mutually exclusive: (A) local lint pack in totem-strategy for doubled-slug variants, bare-ref forms, section-anchor enforcement, truncation residues; (B) lift to `@mmnto/pack-governance` or built-in lint pack for cross-repo adoption. Sequencing: (A) first as fast-feedback proof, then (B) if false-positive rate stays low.
  - [ ] **`mmnto-ai/totem#1796` cwd/configRoot harmonization.** Tier-3. Mirror the eager `repoRoot` resolution pattern from PR #1787's `first-lint-promote-runner.ts` into `compile.ts:663` and `test-rules.ts`.

- **Bundled Cleanup / Validation:**
  - [ ] **`mmnto-ai/totem#1685`** — `totem doctor` Stage 4 UX. T4 of #1684. Surface verification-outcomes state to operators.
  - [ ] **`mmnto-ai/totem#1686`** — Stage 4 perf hardening. T5 of #1684.
  - [ ] **`mmnto-ai/totem#1226`** SARIF hex escape fix.

---

## Backlog — Horizon 3+

Strategic research not currently scoped to 1.26.0:

- **Strategy #6** — Adversarial trap corpus: evaluation suite to test the deterministic engine against evasion techniques
- **Strategy #62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- **Strategy #64** — Formal model routing matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 upgrade-target lessons silenced during 1.13.0 cleanup
- **ADR-090 Substrate DX** — `mmnto-ai/totem#1497` (rich `describe_project` MCP), `mmnto-ai/totem#1498` (`totem init` agent-runtime auto-detect). Likely 1.27.0 or later.
- **ADR-091 non-Stage-4 ingestion work** — Classifier gate (Stage 2), GHAS / SARIF Extraction (Strategy #50, gated on ADR-086), Lint Warning Extraction (Strategy #51 ↔ #1253 `totem extract-lint`), ADR-mining extractor.

---

## Shipped Milestones

### 1.25.0: Pack v0.1 Substrate-Wiring (2026-05-02)

Closes the Pack Ecosystem alpha-pilot graduation gate runtime-completeness leg.

- **PR #1795** (`5cf67abe`) — `bootstrapEngine(config, projectRoot)` helper at `packages/cli/src/utils/bootstrap-engine.ts` (async, dynamic-import per styleguide § 6, idempotent via `isEngineSealed()` short-circuit). Wired into `lint`, `shield` (estimate + main paths), `compile`, `test-rules`. Closes #1794.
- The substrate-wiring gap was discovered empirically by Liquid City's reproduction post-1.24.0 cohort cut: `loadInstalledPacks()` was exported from `@mmnto/totem` since 1.22.0 but had no invocation site in the CLI lint, shield, compile, or test-rules runtime paths. Filed via `upstream-feedback/048`.

### 1.24.0: Pack Pending-Verification Promotion

Shipped 2026-05-02. T3 of `mmnto-ai/totem#1684` — pack `pending-verification` rules promoted to active on first `totem lint` run after install.

- **PR #1787** (`67c3ad3f`) — Public Bootstrap API (`promotePendingRules`, `applyOutcomeToRule`, `readVerificationOutcomes`, `writeVerificationOutcomes`). Outcomes persisted to a committable `.totem/verification-outcomes.json`. `CompiledRule.status` 4-value enum: `'active' | 'archived' | 'untested-against-codebase' | 'pending-verification'`.

### 1.22.0 → 1.23.0: Pack v0.1 Substrate + First Consumer

Shipped 2026-05-01.

- **1.22.0** — ADR-097 § 10 Pack v0.1 substrate. Public API: `loadInstalledPacks()`, `loadedPacks()`, `isEngineSealed()`, `InstalledPacksManifestSchema`, `PackRegistrationAPI`, `PackRegisterCallback`, `LoadedPack`, `LoadInstalledPacksOptions`, `InstalledPacksManifest`. Synchronous `require()` mandated by ADR-097 § 5 Q5. Engine seal in `loadInstalledPacks()`.
- **1.23.0** — `@mmnto/pack-rust-architecture` first non-trivial third-party pack live on npm. `register.cjs` calls `api.registerLanguage('.rs', 'rust', wasmLoader)` AND `napi.registerDynamicLanguage({ rust })`. Bundles `tree-sitter-rust.wasm` (1.1 MB) from `@vscode/tree-sitter-wasm@0.3.1`.
- Namespace rename `@totem/*` → `@mmnto/*` shipped in PR #1785. The `@totem` scope is abandoned.

### 1.18.0 → 1.19.0: STRATEGY_ROOT Resolver + Stage 4 Verifier

Shipped 2026-04-29 → 2026-04-30.

- **1.18.0** — STRATEGY_ROOT resolver substrate. `packages/core/src/strategy-resolver.ts` walks four precedence layers (`TOTEM_STRATEGY_ROOT` env → `totem.config.ts:strategyRoot` → sibling `<gitRoot>/../totem-strategy` → legacy `.strategy/` submodule). The `.strategy/` submodule was retired in PR #1749.
- **1.19.0 (PR #1757, T1 of `mmnto-ai/totem#1682`)** — ADR-091 Stage 4 Codebase Verifier headline. Public API: `verifyAgainstCodebase`, `getDefaultBaseline`, `resolveStage4Baseline`, `DEFAULT_BASELINE_GLOBS`. Four outcomes: no-matches → `'untested-against-codebase'`; out-of-scope → archive with `archivedReason: 'stage4-out-of-scope-match'`; in-scope-bad-example → `confidence: 'high'` (PROMOTE); candidate-debt → force `severity: 'warning'`.
- **PR #1766** — T2 of `mmnto-ai/totem#1683` (baseline override) + `mmnto-ai/totem#1758` (matchesGlob primitive).

### 1.16.0 (2026-04-26)

Ingestion Pipeline DX scaffolding.

### 1.15.0: Pack Distribution (2026-04-20)

The first shippable Totem pack plus the compile-hardening and zero-trust substrate that makes packs safe to distribute. Published `@mmnto/cli@1.15.0`, `@mmnto/totem@1.15.0`, `@mmnto/mcp@1.15.0` to npm on 2026-04-20 PM.

- **Pack Distribution:** `@mmnto/pack-agent-security` flagship pack (5 immutable security rules covering unauthorized process spawning, dynamic code evaluation, network exfiltration, obfuscated string assembly), `totem install pack/<name>` command, `pack-merge` primitive refusing immutable downgrade, content-hash substrate across TypeScript and bash.
- **Zero-trust default (ADR-089):** Pipeline 2 and Pipeline 3 LLM-generated rules ship `unverified: true` unconditionally; `totem rule promote <hash>` atomic activation CLI; Pipeline 1 (manual) keeps its conditional semantics.
- **Compile hardening (ADR-088 Phase 1):** Layer 3 verify-retry, bidirectional smoke gate (`badExample` + `goodExample`), `archivedAt` round-trip preservation, 9-value `NonCompilableReasonCodeSchema` enum, `totem doctor` stale-rule + grandfathered-rule advisories.
- **Platform:** Compound ast-grep rules (ADR-087, from Proposal 226), Windows shell-injection fix in `safeExec` via `cross-spawn.sync`, Cross-Repo Context Mesh, standalone binaries on darwin-arm64 / linux-x64 / win32-x64.
- **Positioning:** ADR-090 (Multi-Agent State Substrate) bounds future "is this a Totem feature?" decisions; ADR-091 (Ingestion Pipeline Refinements) redefines the 1.16.0 ingestion flow as a 5-stage funnel; ADR-085 (Pack Ecosystem) accepted with five deferred decisions resolved.

**1.15.x patch trail (2026-04-22 → 2026-04-26):** Eight patch releases over five days closing the LC-velocity classifier batch and the strategy upstream-feedback queue.

- **1.15.1** (2026-04-22): `totem proposal new` + `totem adr new` governance authoring scaffolding (#1615).
- **1.15.2** (2026-04-22): Archive-in-place durability (#1587). `totem lesson compile --refresh-manifest` no-LLM primitive + `totem lesson archive <hash>` atomic command.
- **1.15.3** (2026-04-23): Compile-worker quality cluster + runtime ReDoS defense. `context-required` classifier (#1639), `semantic-analysis-required` classifier + ledger hygiene (#1640), bounded regex execution + `totem lint --timeout-mode` flag (#1644).
- **1.15.4** (2026-04-24): LC-velocity classifier improvements. Test-contract scope classifier (#1652), declared severity override (#1658).
- **1.15.5** (2026-04-25): `applies-to` lesson frontmatter substrate (#1667). Strategy upstream-feedback item 020.
- **1.15.6** (2026-04-25): source-Scope override (#1674). Strategy upstream-feedback item 023.
- **1.15.7** (2026-04-26): `self-suppressing-pattern` reasonCode (#1688). Strategy upstream-feedback item 021.
- **1.15.8** (2026-04-26): `totem triage-pr` strict-by-id dedup (#1690). Strategy upstream-feedback item 024.

### 1.14.x: Foundation + Pack Substrate

Shipped 2026-04-09 → 2026-04-19.

Fourteen releases over ten days. Headline foundation work in 1.14.0, a four-P0 governance sweep across 1.14.3 → 1.14.5, quality sweep + capstone in 1.14.6 / 1.14.7, perf follow-up in 1.14.8, precision + bundle release on 2026-04-15, ADR-088 Phase 1 substrate + `@mmnto/pack-agent-security` flagship pack in 1.14.11 → 1.14.13.

- **1.14.0** (2026-04-09): Cross-Repo Context Mesh (#1295), LLM Context Caching opt-in preview (#1292), `/preflight` v2 design-doc gate (#1296).
- **1.14.5** (2026-04-11): `safeExec` rewrite on `cross-spawn.sync` (#1356), closing a latent Windows shell-injection vector that had been open for three weeks.
- **1.14.9** (2026-04-15): The Precision Engine. Compound ast-grep rule support (#1410, #1412, #1415), compile-time smoke gate, `badExample` requirement (#1420) closing the LLM-hallucination loop.
- **1.14.10** (2026-04-15): The Bundle Release. Shell-orchestrator `{model}` token RCE fix (#1429), Pipeline 1 compound rule authoring + fail-loud fixes in git.ts and rule-engine.ts (#1454).
- **1.14.11 → 1.14.13** (2026-04-17 → 2026-04-19): Pre-1.15 Phase B substrate. `@mmnto/pack-agent-security` scaffold (#1503), ADR-088 Phase 1 Layer 3 verify-retry (#1513), immutable severity flag + pack-merge primitive (#1510, #1515), `totem install pack/<name>` (#1516), `unverified` flag on `CompiledRule` (#1544), Read/Write schema split, `RuleEngineContext` thread-through (#1553).

### 1.13.0: The Refinement Engine (2026-04-07)

**Theme:** Telemetry-driven rule refinement, compilation routing, and structural pattern upgrades.

- **Compilation Routing:** Compile pipeline routes through Claude Sonnet 4.6 (90% correctness vs Gemini Pro's 73%, 2.4s vs 19.6s avg per Strategy #73 benchmark). Bulk recompile of 1156 lessons dropped 438 rules to 393 after purging 143 noisy Gemini-hallucinated rules and upgrading 102 regex rules to ast-grep structural matching.
- **Telemetry-Driven Refinement:** `RuleMetric.contextCounts` tracks per-context match distribution (code, string, comment, regex, unknown). `totem doctor checkUpgradeCandidates` flags regex rules with >20% non-code-context matches. `totem compile --upgrade <hash>` re-compiles a single rule with a telemetry-driven directive prompt. Self-healing `totem doctor --pr` calls `compileCommand` in-process.
- **Pipeline Hygiene:** Wind tunnel skips auto-scaffolded TODO fixtures. Extract pipeline dedups at heading level before embedding similarity. Config drift test uses token-aware character + directive count limit.
- **AST Coverage:** 8 empty-catch rules upgraded from the legacy Tree-sitter `#eq?` engine to ast-grep structural matching. Backtick wrapper stripping hardened in both Pipeline 1 (manual `**Pattern:**` extraction) and Pipeline 2 (LLM JSON output).
- **Governance:** Lesson Protection Rule (Pipeline 1 lint rule, severity error) blocks destructive shell removal of `.totem/lessons.md` at the point of intent. Added after a 41-rule near-miss. Self-governance: use totem to govern totem.
- **Standalone Binaries:** Real binaries shipped on darwin-arm64 (68 MB), linux-x64 (111 MB), win32-x64 (125 MB) via the #1241 arc (4 PRs: #1260, #1261, #1266, #1267).

### 1.12.0 — The Umpire & The Router (2026-04-05)

Standalone binary, research validation, and platform hardening.

- **Lite-Tier Binary:** Standalone executable with WASM ast-grep engine, no native dependencies, three platforms (linux-x64, darwin-arm64, win32-x64).
- **gemma4 Evaluation:** Auto-detect Ollama environments and validate local model viability. gemma4:26b benchmarked at 80% parse / 93% safe / 90s avg, kept for triage but ruled out for compile.
- **AST-Grep Coverage:** Extended ast-grep coverage to ESLint restricted-properties rules.
- **Windows CI:** Resolved orchestrator timeout constraints on Windows runners.
- **Context Tuning:** Proposal 213 Phases 2+3, CLAUDE.md pulse check, GCA / CR tenets injected into bot configs.

### 1.11.0 — The Import Engine (2026-04-04)

Brought governance rules from external tools and other instances into the platform.

- **Portability:** Enabled cross-repository rule sharing between instances and imported rules from modern ESLint flat config formats.
- **Language Support:** Added baseline proactive rule packs for TypeScript, Shell, and Node.js built on established best practices.

### 1.10.0 — The Invisible Exoskeleton (2026-04-02)

Reduced adoption friction for solo developers and new repository environments.

- **Developer Experience:** Time-bounded pilot modes, local extraction options, and global profile support.
- **Enforcement Validation:** Strict tiers with agent auto-detection and formalized format checks in pre-push hooks.
- **Pipeline Refactoring:** Hardened environment variable parsing and refactored the extraction pipeline into distinct per-mode modules.

### 1.9.0 — Pipeline Engine (2026-04-01)

Established multiple pipelines for rule creation ranging from manual scaffolding to fully autonomous extraction.

- **Rule Scaffolding:** Manual generation with test fixtures, example-based compilation, and prose-to-pattern translation.
- **Automation:** Staged observation findings automatically and translated external tool configurations without relying on language models.
- **Ecosystem:** Refreshed documentation, overhauled the playground, and published pre-compiled baseline rules for additional languages.

### 1.7.0 — Platform of Primitives (2026-03-29)

Redesigned the command structure and stabilized context engineering.

- **Architecture:** Stateless hooks, hierarchical command structures, and hash-locked execution boundaries.
- **Context Management:** Fallback search for agent context injection, repository discovery commands, and structured handoff validations.
- **Lifecycle:** Garbage collection with adaptive decay and throughput-based ETA for compilation progress.

### 1.6.0 — Pipeline Maturity (2026-03-22)

Finalized the core self-healing loop and core enforcement testing structures.

- **Enforcement Core:** Inline rule unit testing, standard libraries, and tracking ledgers for evasion traps.
- **Developer Experience:** Improved compiler workflows, implemented auto-refreshing flag mechanisms, and integrated stress testing.
