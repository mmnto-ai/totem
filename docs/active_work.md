> **DEPRECATED — DO NOT MAINTAIN.** This document is intentionally stale. State is derived from substrate (journals + handoff frontmatter + git history), not declared in a hand-maintained doc. See `mmnto-ai/totem-strategy:proposals/active/264-derived-standing-state.md` (Derived Standing State — `totem status` dashboard with TUI/JSON/MCP views) for the replacement surface. The "derive, don't maintain" principle: if state is derivable from primary artifacts, declaration surfaces add agent-discipline burden without paying for themselves. This file is retained until Proposal 264 lands; do not treat as authoritative.

### Active Work Summary

**1.25.0 published 2026-05-02.** Pack v0.1 alpha pilot's runtime-completeness leg landed via PR #1795 (`bootstrapEngine` helper wires `loadInstalledPacks()` into the CLI lint / shield / compile / test-rules paths, closing the substrate-wiring gap discovered post-1.24.0). Five-package cohort all at 1.25.0 on npm via OIDC: `@mmnto/cli`, `@mmnto/totem`, `@mmnto/mcp`, `@mmnto/pack-agent-security`, `@mmnto/pack-rust-architecture`. The first non-trivial third-party pack (`@mmnto/pack-rust-architecture`) is fully reachable end-to-end through the published registry, with `tree-sitter-rust.wasm` registered via the dual-channel side-channel pattern (synchronous `require()` per ADR-097 § 5 Q5 plus napi `registerDynamicLanguage`).

**455 compiled rules** in `.totem/compiled-rules.json` (active + archived; rules with unset `status` treated as active per the schema default). 5 immutable rules in `packages/pack-agent-security/compiled-rules.json`. 1,226 lessons on disk. Test counts post-1.25.0: 1,760 core, 1,971 cli, 18 pack-rust, 57 pack-agent-security.

**Strategic frame.** The 1.16.0 ingestion-pipeline arc (ADR-091 Stage 4 Codebase Verifier) shipped across 1.16.0 → 1.19.0; Pack v0.1 alpha shipped 1.22.0 → 1.25.0 (publishes leg + runtime-wiring leg); zero-trust default (ADR-089) in production from 1.14.16. Focus rotates to **1.26.0: Pack Ecosystem Graduation** — bot-pack publish, memory-as-pack-pointer refactor, and the deterministic-substrate gap surfaced by upstream-feedback/049 (convention rules currently encoded as LLM-prose in CR/GCA styleguides; Tenet 15 violation). See "Current: 1.26.0" section below.

### Recently Shipped

**2026-05-02** (1.25.0 published) — Pack v0.1 substrate-wiring fix. Closes the Pack Ecosystem alpha-pilot graduation gate runtime-completeness leg.

- **PR #1795** (`5cf67abe`) → **1.25.0 published** — `bootstrapEngine(config, projectRoot)` helper at `packages/cli/src/utils/bootstrap-engine.ts` (async, dynamic-import per styleguide § 6, idempotent via `isEngineSealed()` short-circuit). Wired into `lint`, `shield` (estimate + main paths), `compile`, `test-rules`. No core API changes — `isEngineSealed` and `loadInstalledPacks` were already exported from `@mmnto/totem` since 1.22.0; the gap was that nothing in the CLI runtime was invoking them. Discovered empirically by Liquid City's reproduction post-1.24.0 cohort cut: `@mmnto/pack-rust-architecture@1.24.0` published correctly, LC pinned and `extends`d it, lint still threw `ASTGREP_RUST_LANGUAGE_MISSING`. Filed as `mmnto-ai/totem#1794` from `upstream-feedback/048` (`mmnto-ai/totem-strategy#198`). Closes #1794.
- **PR #1797** (`69ce7f40`) — Version Packages auto-PR releasing 1.25.0 across the cohort.
- **Tickets filed during the arc.** #1796 (Tier-3) — cwd/configRoot harmonization in `compile.ts:663` + `test-rules.ts`; mirror the eager `repoRoot` resolution pattern from PR #1787's first-lint-promote-runner.

**2026-05-02 (earlier in the day)** (1.24.0 published) — ADR-091 § Bootstrap Semantics: pack pending-verification install→lint promotion path live for consumers.

- **PR #1787** (`67c3ad3f`) → **1.24.0 published** — T3 of `mmnto-ai/totem#1684`. Pack `pending-verification` rules promoted to active on first `totem lint` run after install, with outcomes persisted to a committable `.totem/verification-outcomes.json` (canonical-key-order via shared `canonicalStringify`). Public Bootstrap API: `promotePendingRules`, `applyOutcomeToRule`, `readVerificationOutcomes`, `writeVerificationOutcomes`, schemas in `verification-outcomes.ts`. CLI exports `stampPackRulesAsPending` + `PACK_INSTALL_ACTIVATION_MESSAGE`. `CompiledRule.status` enum is the 4-value form: `'active' | 'archived' | 'untested-against-codebase' | 'pending-verification'`.
- **PR #1789** (`a4e24611`) — Version Packages auto-PR releasing 1.24.0.
- **PR #1790** (`e5a2b15e`) — Postmerge curation. 17 lessons extracted, 2 auto-archived for over-broad patterns; tier-3 follow-ups #1791 (closed by-design — verifier behavior is ADR-091 explicit design) and #1793 (extractor pattern-quality telemetry signal).

**2026-05-01** (1.22.0 → 1.23.0 published) — Pack v0.1 substrate + first non-trivial consumer.

- **1.22.0** — ADR-097 § 10 Pack v0.1 substrate. Public API: `loadInstalledPacks(options?)`, `loadedPacks()`, `isEngineSealed()`, `InstalledPacksManifestSchema`, `PackRegistrationAPI`, `PackRegisterCallback`, `LoadedPack`, `LoadInstalledPacksOptions`, `InstalledPacksManifest`. Synchronous `require()` mandated by ADR-097 § 5 Q5. Engine seal in `loadInstalledPacks()`. `extensionToLang` migrated to a registry in `ast-grep-query.ts`.
- **1.23.0** — `@mmnto/pack-rust-architecture` first non-trivial third-party pack live on npm. `register.cjs` calls `api.registerLanguage('.rs', 'rust', wasmLoader)` AND `napi.registerDynamicLanguage({ rust })` (substrate-extension follow-up `mmnto-ai/totem#1774`). Bundles `tree-sitter-rust.wasm` (1.1 MB) from `@vscode/tree-sitter-wasm@0.3.1`. Tracer-bullet seed rule (`lesson-8cefba95`); full LLM-compile of 8-lesson set deferred until γ (`mmnto-ai/totem#1655`).
- Namespace rename `@totem/*` → `@mmnto/*` shipped in PR #1785 (closes #1784, #1779). The `@totem` scope is abandoned; `@mmnto` is the canonical pack namespace.

**2026-04-29** (1.18.0 published) — STRATEGY_ROOT resolver substrate.

- `packages/core/src/strategy-resolver.ts` walks four precedence layers: `TOTEM_STRATEGY_ROOT` env (or `STRATEGY_ROOT` alias) → `totem.config.ts:strategyRoot` → sibling clone at `<gitRoot>/../totem-strategy` → legacy `.strategy/` submodule. The first layer that resolves to a real directory wins.
- The `.strategy/` submodule was retired in PR #1749. Sibling clone at `../totem-strategy/` is the recommended setup.
- Each consumer surface (MCP `describe_project`, governance scaffolding, federated search, bench scripts, `totem doctor`) handles unresolvable state with actionable graceful degradation.

**2026-04-26 → 2026-04-30** (1.16.0 → 1.19.0 published) — ADR-091 Ingestion Pipeline + Stage 4 Codebase Verifier.

- **1.16.0** — Ingestion Pipeline DX scaffolding.
- **1.19.0 (PR #1757, T1 of `mmnto-ai/totem#1682`)** — ADR-091 Stage 4 Codebase Verifier headline. Public API: `verifyAgainstCodebase`, `getDefaultBaseline`, `resolveStage4Baseline`, `DEFAULT_BASELINE_GLOBS`, types `Stage4VerificationResult` / `Stage4Baseline` / `Stage4Outcome` / `Stage4VerifierDeps`. Four outcomes: no-matches → `'untested-against-codebase'`; out-of-scope → archive with `archivedReason: 'stage4-out-of-scope-match'`; in-scope-bad-example → `confidence: 'high'` (PROMOTE untested→active); candidate-debt → force `severity: 'warning'`. Status-machine seam: positive Stage 4 evidence on a previously-`untested` rule MUST promote to `'active'` or it stays inert forever.
- **PR #1766 (T2 of `mmnto-ai/totem#1683` + `mmnto-ai/totem#1758` matchesGlob)** — Baseline override + matchesGlob primitive.

**2026-04-25 / 2026-04-26** (1.15.5 → 1.15.8) — Upstream-feedback batch from Liquid City Session 17 closed five-for-five (items 020 / 021 / 022 / 023 / 024).

- **PR #1667** → **1.15.5** — `applies-to` lesson frontmatter substrate. Compiler honors `LessonFrontmatterSchema.appliesTo` (`fileGlobs`, `pathContains`, `excludeGlobs`) as authoritative scope override; conflicts surface as warnings.
- **PR #1674** → **1.15.6** — source-Scope override. Lesson frontmatter `scope: 'tests' | 'src' | 'all'` flips compiler default scope inversion.
- **PR #1688** → **1.15.7** — `self-suppressing-pattern` reasonCode. Engine-detected ledger superset value on `NonCompilableReasonCodeSchema`. Architectural distinction codified: LLM-emittable codes go in `CompilerOutputBaseSchema.reasonCode`; engine-guard codes go ONLY in `NonCompilableReasonCodeSchema`.
- **PR #1690** → **1.15.8** — `totem triage-pr` strict-by-id dedup using deterministic `rootCommentId`.

### Current: 1.26.0 — Pack Ecosystem Graduation

**Theme:** Close the Pack Ecosystem alpha-pilot graduation by completing the publishes-and-wires arc for bot packs, then collapse the convention-rule duplication between memory and packs. Pair with deterministic-substrate hardening for the rule classes currently encoded only as LLM-prose in CR/GCA styleguides (Tenet 15 violations surfaced by drift firing N=7+ in upstream-feedback/049).

The strategic frame is "publishing without runtime-wiring is incomplete; ship gates require both." Memory rule `feedback_publishing_requires_wiring.md` codifies the principle after the substrate-wiring gap took 1.22.0 → 1.25.0 to close.

#### Headline work — Pack v0.1 graduation

> **Bot-pack arc retired (2026-05-12).** The bot-pack publish + wire-into-hooks + memory-refactor bullets that previously sat here are superseded by [ADR-105 (Bot-Protocol Centralization)](https://github.com/mmnto-ai/totem-strategy/blob/main/adr/adr-105-bot-protocol-centralization.md). Bot-interaction protocols now live at `mmnto-ai/totem-strategy:doctrine/bot-protocols.md`; mechanical enforcement is tracked at [`mmnto-ai/totem#1900`](https://github.com/mmnto-ai/totem/issues/1900).

- [ ] **`mmnto-ai/totem#1803` Option C — engines field migration.** Move the pack engine-version constraint from `peerDependencies['@mmnto/totem']` to `engines['@mmnto/totem']` per ADR-097 § Q6 amendment. Closes the structural collision with `mmnto-ai/totem#1777` (fixed-group sibling cannot peer-dep `@mmnto/totem` without triggering a MAJOR cascade) while preserving real semver cross-check at boot. Resolver mod + schema cascade across `pack-rust-architecture` and `pack-agent-security` + warning-text fix in `totem sync`. Unblocks Pack v0.1 alpha-pilot Leg 3 (external consumer adoption / LC un-quarantine).
- [ ] **LC un-quarantine validation.** Pattern-quality review per `mmnto-ai/totem#1793` BEFORE un-quarantining the 4-rule `.rs` cohort (3 from upstream-014, 1 from upstream-048). End-to-end validation that PR #1795's substrate-wiring fix + #1803's engines-field migration unblock the LC PR-C cascade is the load-bearing signal that closes the alpha-pilot gate.

#### Headline work — Substrate hardening (Tenet 15)

Convention rules currently encoded only as LLM-prose in CR `.coderabbit.yaml` and GCA `.gemini/styleguide.md`. Drift firing N=7+ documented in `mmnto-ai/totem-strategy/upstream-feedback/049`. Strategic posture: replace LLM-prose enforcement with regex / AST / schema enforcement wherever the rule has a deterministic shape.

- [ ] **`@mmnto/pack-voice` (`mmnto-ai/totem#1798`).** Tier-2, scope: core, domain: architecture. Compile voice rules from `voice-tuning-dataset.md` (em-dash detection, banned-vocab list, "Not X, but Y" patterns) into a deterministic pack with regex / ast-grep rules. Solves the cross-repo voice-rules access path problem (rules currently live only in totem-strategy; consuming repos read by discipline).
- [ ] **upstream-feedback/049 substrate response.** Two options not mutually exclusive: (A) local lint pack in totem-strategy for doubled-slug variants + bare-ref forms + section-link + truncation residues; (B) lift to `@mmnto/pack-governance` or built-in lint pack for cross-repo adoption. Recommended sequencing: (A) first as fast-feedback proof, then (B) if false-positive rate stays low.
- [ ] **`mmnto-ai/totem#1796` cwd/configRoot harmonization.** Tier-3. Mirror the eager `repoRoot` resolution pattern from PR #1787's `first-lint-promote-runner.ts` into `compile.ts:663` and `test-rules.ts`. Same monorepo-subpackage class of bug as PR #1787 fixed in T6.

#### Bundled cleanup / validation

- [ ] **`mmnto-ai/totem#1685`** — `totem doctor` Stage 4 UX. T4 of #1684. Surface verification-outcomes state to operators.
- [ ] **`mmnto-ai/totem#1686`** — Stage 4 perf hardening. T5 of #1684.
- [ ] **`mmnto-ai/totem#1226`** SARIF hex escape fix.

#### Carried over from prior cycles (not load-bearing for 1.26.0)

- **ADR-091 non-Stage-4 ingestion work.** Classifier gate (Stage 2), GHAS / SARIF Extraction (Strategy #50, gated on ADR-086), Lint Warning Extraction (Strategy #51 ↔ #1253), ADR-mining extractor. Strategy-side decomposition pending; not in 1.26.0 critical path.
- **ADR-090 Substrate DX.** `mmnto-ai/totem#1497` (rich `describe_project` MCP), `mmnto-ai/totem#1498` (`totem init` agent-runtime auto-detect). Likely 1.27.0 or later.
- **`mmnto-ai/totem#1414`** — Pipeline 1 smoke-gate flip after 136-lesson Bad Example backfill. Mechanism shipped in #1415; hard enforcement deferred until the curation sweep.
- **`mmnto-ai/totem#1419`** — Cryptographic attestation for the Trap Ledger (SOX compliance gap, Proposal 225 enterprise pitch).

#### Tier-1 drain queue (post-1.25.0)

- **#1432** add_lesson concurrency
- **#1435** CompilerOutputSchema round-trip
- **#1431** MarkdownChunker YAML
- **#1555 / #1556 / #1557** totem spec correctness
- **#1569 / #1570 / #1572** compile-worker durability cluster
- **#1504** pre-1.13.0 legacy corpus audit (now eligible — Stage 4 verifier shipped in 1.19.0)

#### Watch-outs

- **Substrate separation.** Don't change compile-pipeline substrate (Proposal 230 embedding cache, future caching extensions) in the same release as features built on top of it. The 2026-04-20 dependency-inversion finding still applies.
- **Empirical-vs-cached drift (`feedback_empirical_vs_cached_drift.md`).** Drift firing N=7+ across multiple agents and repos. Verify empirical state before acting on memory-cached descriptions; this rule fires equally on confident-but-stale recommendations and confident-but-stale ticket framings.
- **Pack-cohort fixed-group invariant.** No pack within the fixed-group cohort may declare a fixed-group sibling as a peerDependency. Test invariant locked at `packages/pack-rust-architecture/test/structure.test.ts`. The 1.22.0 → 2.0.0 wiggle on `mmnto-ai/totem#1776` was caused by exactly this gap; closed by #1777.

### Backlog (Horizon 3+)

- Strategy **#6** — Adversarial trap corpus
- Strategy **#62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- Strategy **#64** — Model Routing Matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 silenced upgrade-target lessons (1.13.0 cleanup)

### Recently Completed

**1.16.0 → 1.25.0 cycle (2026-04-26 → 2026-05-02)** — ADR-091 Stage 4 + Pack v0.1 alpha pilot.

- **1.16.0** (2026-04-26) — Ingestion Pipeline DX scaffolding.
- **1.18.0** (2026-04-29) — STRATEGY_ROOT resolver substrate (PR #1743). `.strategy/` submodule retired (PR #1749).
- **1.19.0** (2026-04-30) — ADR-091 Stage 4 Codebase Verifier headline (PR #1757, T1 of #1682).
- **1.22.0** (2026-05-01) — Pack v0.1 substrate per ADR-097 § 10. `loadInstalledPacks()` substrate exported.
- **1.23.0** (2026-05-01) — `@mmnto/pack-rust-architecture` first non-trivial pack live on npm.
- **1.24.0** (2026-05-02) — Pack pending-verification install→lint promotion path (PR #1787, T3 of #1684). `verification-outcomes.json` substrate.
- **1.25.0** (2026-05-02) — Substrate-wiring fix (PR #1795). `bootstrapEngine` helper closes the Pack v0.1 graduation runtime-wiring leg.

**1.15.0 — Pack Distribution (2026-04-20)**

The first shippable Totem pack plus the compile-hardening and zero-trust substrate that makes packs safe to distribute.

- **Pack Distribution:** `@mmnto/pack-agent-security` flagship pack (5 immutable security rules), `totem install pack/<name>`, `pack-merge` immutable-downgrade refusal, content-hash substrate.
- **Zero-trust default (ADR-089):** Pipeline 2 + Pipeline 3 LLM rules ship `unverified: true` unconditionally; `totem rule promote <hash>` atomic activation CLI.
- **Compile hardening (ADR-088 Phase 1):** Layer 3 verify-retry, bidirectional smoke gate (`badExample` + `goodExample`), `archivedAt` round-trip preservation, 9-value reason-code enum, two `totem doctor` advisories (stale + grandfathered).
- **Platform:** Compound ast-grep rules (ADR-087), Windows `safeExec` shell-injection fix, Cross-Repo Context Mesh, standalone binaries.
- **Positioning:** ADR-090 (Multi-Agent State Substrate), ADR-091 (5-stage ingestion funnel), ADR-085 (Pack Ecosystem, five deferred decisions resolved).

The 1.15.x patch trail (2026-04-22 → 2026-04-26) shipped eight patch releases: 1.15.1 governance authoring scaffolding, 1.15.2 archive-in-place durability, 1.15.3 compile-worker quality cluster + ReDoS defense, 1.15.4 LC-velocity classifier improvements, 1.15.5-1.15.8 the upstream-feedback five-for-five batch.

**1.14.x cycle — Nervous System Foundation + Hotfix Sweep + Four-P0 Governance Sweep (2026-04-09 → 2026-04-19)**

- **1.14.0** (2026-04-09) — The Nervous System Foundation. Cross-Repo Context Mesh (#1295), LLM Context Caching preview (#1292), `/preflight` v2 (#1296).
- **1.14.1** (2026-04-11 morning) — Hotfix Sweep + Phase 1 Papercuts. Nine PRs merged.
- **1.14.2** (2026-04-11 morning) — Cosmetic `DISPLAY_TAG = 'Review'` split.
- **1.14.3 / 1.14.4 / 1.14.5** (2026-04-11 afternoon) — Four-P0 governance sweep: archive-lie filter (#1336), compile manifest drift refresh (#1337), parser-based ast-grep validation (#1339), `safeExec` Windows shell-injection fix (#1329).
- **1.14.6 → 1.14.10** (2026-04-13 → 2026-04-15) — Quality sweep, nervous-system capstone, perf follow-up, the precision engine (compound ast-grep + smoke gate), bundle release.
- **1.14.11 → 1.14.13** (2026-04-17 → 2026-04-19) — Pre-1.15 review: `@mmnto/pack-agent-security` scaffold, ADR-088 Phase 1 substrate (Layers 3+4), `RuleEngineContext` thread-through.
- **1.14.14 → 1.14.17** (2026-04-20) — Compile-hardening trio sprint closing the 1.15.0 ship gate.

**1.13.0 — The Refinement Engine (2026-04-07)**

Theme: Telemetry-driven rule refinement, compilation routing, and AST upgrades.

- Sonnet 4.6 compile routing (#1220) with ast-grep prompt bias
- Bulk Sonnet recompile: 438 → 393 rules, 102 regex→ast-grep upgrades, 143 noisy rules purged (#1224)
- Context telemetry in rule metrics (#1132 / #1227)
- `totem doctor` upgrade diagnostic + `compile --upgrade <hash>` (#1131 / PR #1234)
- AST empty-catch detection (#664) — 8 rules upgraded
- Lesson protection rule (Pipeline 1 error-severity block on destructive shell removal of the load-bearing lessons file)
- Standalone binary distribution (#1241 arc) — real binaries on darwin-arm64, linux-x64, win32-x64

**1.12.0 — The Umpire & The Router (2026-04-05)**

- Lite-tier standalone binary with WASM ast-grep engine
- gemma4 eval + Ollama auto-detection
- Context tuning (Proposal 213 Phases 2+3)

**1.11.0 — The Import Engine (2026-04-04)**

- Proactive language packs containing 50 default rules
- ESLint flat configuration import support
- Cross-repository rule sharing via direct import
