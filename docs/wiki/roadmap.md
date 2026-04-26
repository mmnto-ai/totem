# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a standard library for codebase governance - deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the active progression of enforcement primitives, platform validation, and rule distribution.

---

## 1.16.0: Ingestion + Substrate DX (Active)

**Theme:** Deterministic architectural enforcement through a five-stage ingestion funnel (`Extract -> Classify -> Compile -> Verify-Against-Codebase -> Activate`) per **ADR-091 Ingestion Pipeline Refinements** (promoted 2026-04-19 via Proposal 234). Pair the pipeline with the Human DX and Agent AX tracks from ADR-090 so the substrate is friction-free for human setup and incoming agent sessions.

Also lands Proposal 217 (LLM context caching, quarantined out of 1.15.0 because it touches compile pipeline substrate).

- **Headline Work - Ingestion (ADR-091 funnel):**
  - [ ] **Classifier gate (Stage 2):** Routes candidates into Compile vs Candidate Debt per ADR-091. Strategy-side implementation ticket pending decomposition.
  - [ ] **Verify-Against-Codebase (Stage 4):** Runs compiled candidate against a baseline snapshot before Activate. Decomposed by strategy Claude into **totem#1682 / #1683 / #1684 / #1685 / #1686** during the 2026-04-25/26 session (strategy PR #143).
  - [ ] **GHAS / SARIF Extraction:** Convert GitHub Advanced Security alerts into Totem lessons (Strategy #50). Originally scoped with #1131; telemetry-driven refinement won that cycle. ADR-086 External Alert Ingestion gates this.
  - [ ] **Lint Warning Extraction:** Convert repository lint warnings (ESLint, Semgrep, Sonar) into actionable lessons (Strategy #51 <-> totem#1253 `totem lesson extract-lint`).
  - [ ] **ADR-mining extractor:** Decision-record ingestion into the same funnel. Strategy-side implementation ticket pending decomposition.

- **Headline Work - ADR-090 Substrate DX:**
  - [ ] **Rich `describe_project` MCP endpoint (#1497).** Agent AX track. Drops session-start briefing from ~5 tool calls to 1 by returning active roadmap, open `pre-1.15-review` tickets, current strategy pointer, rule counts, and recent merged PRs in one structured payload.
  - [ ] **`totem init` auto-detects agent runtimes (#1498).** Human DX track. Detects Cursor, Windsurf, Claude Code and offers MCP-config injection so the substrate wires itself into the user's chosen agent runtime without manual config. Supersedes closed #124 and #129.

- **Bundled Cleanup / Validation:**
  - [ ] **SARIF Hex Escape Fix:** Fix SARIF upload failing on invalid hex escape sequences (#1226) - load-bearing for the new SARIF ingestion path.
  - [ ] **Governance Eval Harness:** Tooling to evaluate rule enforcement against the new ingested inputs (Strategy #17) - the ingestion pipeline needs validation to prove the extracted rules actually catch what GHAS/lint flagged.

---

## Backlog: Horizon 3+

Strategic research not currently scoped to 1.16.0:

- **Strategy #6** - Adversarial trap corpus: evaluation suite to test the deterministic engine against evasion techniques
- **Strategy #62** - Model-specific prompt adapters (partially addressed by #1220 rewrite)
- **Strategy #64** - Formal model routing matrix (partially addressed by #73 benchmark)
- **#1236** - Revisit 6 upgrade-target lessons silenced during 1.13.0 cleanup

---

## Shipped Milestones

### 1.15.0: Pack Distribution (2026-04-20)

The first shippable Totem pack plus the compile-hardening and zero-trust substrate that makes packs safe to distribute. Published `@mmnto/cli@1.15.0`, `@mmnto/totem@1.15.0`, `@mmnto/mcp@1.15.0` to npm on 2026-04-20 PM. `@totem/pack-agent-security` stays workspace-private pending #1492 Sigstore signing (tracked as #1609).

- **Pack Distribution:** `@totem/pack-agent-security` flagship pack (5 immutable security rules covering unauthorized process spawning, dynamic code evaluation, network exfiltration, obfuscated string assembly), `totem install pack/<name>` command, `pack-merge` primitive refusing immutable downgrade, content-hash substrate across TypeScript and bash.
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

Fourteen releases over ten days (2026-04-09 to 2026-04-19). Headline foundation work in 1.14.0, a four-P0 governance sweep across 1.14.3 through 1.14.5, quality sweep + capstone in 1.14.6 and 1.14.7, perf follow-up in 1.14.8, precision + bundle release on 2026-04-15, ADR-088 Phase 1 substrate + `@totem/pack-agent-security` flagship pack in 1.14.11-13.

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
- **1.14.10** (2026-04-15): The Bundle Release. Shell-orchestrator `{model}` token RCE fix (#1429), Pipeline 1 compound rule authoring + fail-loud fixes in git.ts and rule-engine.ts (#1454).
- **1.14.11** (2026-04-17 - 2026-04-18): Pre-1.15-review Phase B first wave. `@totem/pack-agent-security` scaffold (#1503), ADR-088 Phase 1 Layer 3 verify-retry (#1513), immutable severity flag + pack-merge primitive (#1510, #1515), `totem install pack/<name>` (#1516). `--force` / `--no-force` content-hash stamping (#1531).
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

- **Lite-Tier Binary:** Standalone executable with WASM ast-grep engine - no native dependencies, three platforms (linux-x64, darwin-arm64, win32-x64).
- **gemma4 Evaluation:** Auto-detect Ollama environments and validate local model viability. gemma4:26b benchmarked at 80% parse / 93% safe / 90s avg - kept for triage but ruled out for compile.
- **AST-Grep Coverage:** Extended ast-grep coverage to ESLint restricted-properties rules.
- **Windows CI:** Resolved orchestrator timeout constraints on Windows runners.
- **Context Tuning:** Proposal 213 Phases 2+3 - CLAUDE.md pulse check, GCA/CR tenets injected into bot configs.

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
