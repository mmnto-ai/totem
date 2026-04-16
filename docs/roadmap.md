# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a standard library for codebase governance — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the active progression of enforcement primitives, platform validation, and rule distribution.

---

## 1.15.0: The Distribution Pipeline (Active)

**Theme:** The Totem Pack Ecosystem. 1.13.0 proved the engine can generate high-fidelity ast-grep rules. The 1.14.x cycle wired the nervous system foundation: cross-repo context mesh, LLM context caching preview, `/preflight` v2 design-doc gate, compound ast-grep rule support, compile-time smoke gate, precision engine. 1.15.0 is where proven rules leave the repo and teams bundle and share them across repositories via the npm registry.

Blocked by the pre-1.15.0 deep review gate (#1421). ~29 tickets carry the `pre-1.15-review` label after the 2026-04-16 ADR-088 Phase 1 decomposition. The 2026-04-15 joint planning pass locked a three-phase sequence. See `docs/active_work.md` for the full phase breakdown, ticket sequencing, and proposal dispositions.

- **Phase A: Workflow setup before the grind. [DONE 2026-04-16]** Monitor tool and `/loop` self-paced examples into CLAUDE.md (#1466), PreCompact hook (#1470), review-gate `if`-scope (#1468), turbo cache hash-scope fix (#1472). `/preflight` v2 shipped via #1296 + #1299 (1.14.0/1.14.1). `/autofix-pr` trial remains outstanding.
- **Phase A.5: Architectural gates. [DONE 2026-04-16]** Three ADRs Accepted on the strategy repo: ADR-088 (Stacked Compilation, from Proposal 202, `mmnto-ai/totem-strategy#85`), ADR-089 (Zero-Trust Agent Governance, from Proposal 228, `#85`), ADR-085 (Totem Pack Ecosystem, `#86`) with its five deferred decisions resolved. ADR-090 (Totem as the Multi-Agent State Substrate, `#87`) landed as the positioning principle bounding future "is this a Totem feature?" decisions.
- **Phase B: Pre-1.15-review grind. [IN PROGRESS]** First PR #1503 merged 2026-04-16 scaffolding `@totem/pack-agent-security`. Next five by audit-driven dependency order: #1479 Layer 3 verify-retry loop (biggest compounding value, foundational), #1485 immutable severity flag (prereq for security rules), #1491 `totem install` command (prereq for pack consumption), #1489 obfuscated-string-concat research spike (time-boxed, unblocks #1490), then #1486-#1490 security rules once #1485 lands. Tactical cleanup batch (#1456, #1457, #1459) in parallel where scope allows; #1458 already closed via #1501. Tier-1 bundles grouped by `scope:` label; one bundle per PR; deepest architectural layer first within each bundle.
- **Phase C: Pack Distribution headline.** ADR-085 Accepted, decomposition tickets filed as #1484 (scaffold, merged) + #1485 (immutable flag) + #1491 (install) + #1492 (Sigstore + in-toto) + #1493 (lifecycle) + #1494 (doctor shadowing warning). Ship `@totem/pack-agent-security` with the four attack-surface rules (#1486, #1487, #1488, #1490). Wire Proposal 229 TBench spot-check as the pack-release gate (full harness stays Horizon 3).

Quarantined out of 1.15.0: Proposal 217 (LLM context caching, 1.16.0) and Proposal 230 (content-hash embedding cache, 1.17.0). Both touch compile pipeline substrate; changing substrate and the feature built on top of it in the same release is a silent-regression risk.

---

## 1.16.0: The Ingestion Pipeline + ADR-090 Substrate DX

**Theme:** Source Diversity, the Self-Healing Loop, and substrate-layer DX polish. Expand the extraction pipeline to convert external signals (GitHub Advanced Security alerts, lint warnings) into deterministic Totem lessons. Pair that with the Human DX and Agent AX tracks from ADR-090 so the substrate is friction-free for human setup and incoming agent sessions.

Also lands Proposal 217 (LLM context caching, quarantined out of 1.15.0 because it touches compile pipeline substrate).

- **Headline Work — Ingestion:**
  - [ ] **GHAS / SARIF Extraction:** Convert GitHub Advanced Security alerts into Totem lessons (Strategy #50). Originally scoped with #1131; telemetry-driven refinement won that cycle. 1.14.0 distribution now gives us a way to ship the resulting rules back out.
  - [ ] **Lint Warning Extraction:** Convert repository lint warnings (ESLint, Semgrep, Sonar) into actionable lessons (Strategy #51).

- **Headline Work — ADR-090 Substrate DX:**
  - [ ] **Rich `describe_project` MCP endpoint (#1497).** Agent AX track. Drops session-start briefing from ~5 tool calls to 1 by returning active roadmap, open `pre-1.15-review` tickets, current strategy pointer, rule counts, and recent merged PRs in one structured payload.
  - [ ] **`totem init` auto-detects agent runtimes (#1498).** Human DX track. Detects Cursor, Windsurf, Claude Code and offers MCP-config injection so the substrate wires itself into the user's chosen agent runtime without manual config. Supersedes closed #124 and #129.

- **Bundled Cleanup / Validation:**
  - [ ] **SARIF Hex Escape Fix:** Fix SARIF upload failing on invalid hex escape sequences (#1226) — load-bearing for the new SARIF ingestion path.
  - [ ] **Governance Eval Harness:** Tooling to evaluate rule enforcement against the new ingested inputs (Strategy #17) — the ingestion pipeline needs validation to prove the extracted rules actually catch what GHAS/lint flagged.

---

## Backlog — Horizon 3+

Strategic research not currently scoped to 1.14.0 or 1.15.0:

- **Strategy #6** — Adversarial trap corpus: evaluation suite to test the deterministic engine against evasion techniques
- **Strategy #62** — Model-specific prompt adapters (partially addressed by #1220 rewrite)
- **Strategy #64** — Formal model routing matrix (partially addressed by #73 benchmark)
- **#1236** — Revisit 6 upgrade-target lessons silenced during 1.13.0 cleanup

---

## Shipped Milestones

### 1.14.x: Nervous System Foundation + Hotfix Cycle

Eleven releases over six days (2026-04-09 to 2026-04-15). Headline foundation work in 1.14.0, a four-P0 governance sweep across 1.14.3 through 1.14.5, quality sweep + capstone in 1.14.6 and 1.14.7, perf follow-up in 1.14.8, precision + bundle release on 2026-04-15.

- **1.14.0** (2026-04-09): Cross-Repo Context Mesh (#1295), LLM Context Caching opt-in preview (#1292), `/preflight` v2 design-doc gate (#1296).
- **1.14.1** (2026-04-11): Hotfix Sweep and Phase 1 Papercuts. Nine PRs including Pipeline 5 sanity gate, compile prune no-op fix, tilde-fence support.
- **1.14.2** (2026-04-11): `DISPLAY_TAG = 'Review'` cosmetic split; `TAG = 'Shield'` internal routing key preserved (coordinated rename tracked in #1335).
- **1.14.3** (2026-04-11): Archive Lie filter (#1345). `loadCompiledRules` now filters out archived status; self-healing loop is no longer a placebo.
- **1.14.4** (2026-04-11): Compile manifest drift refresh (#1348) + parser-based ast-grep validation (#1349).
- **1.14.5** (2026-04-11): `safeExec` rewrite on `cross-spawn.sync` (#1356), closing a latent Windows shell-injection vector that had been open for three weeks.
- **1.14.6** (2026-04-13): Quality Sweep Phase 1-2 and Voice Compliance. 7 over-broad rules archived; voice-scrub follow-ups (#1379, #1382, #1383).
- **1.14.7** (2026-04-13): Nervous System Capstone. Mesh completion (#1396), bot reply protocol docs (#1395), cause-chain migration (#1357).
- **1.14.8** (2026-04-14): Perf Follow-up. `cwd` threading (#1401), batch upgrade hashes (#1401), PR template enforcement (#1402).
- **1.14.9** (2026-04-15): The Precision Engine. Compound ast-grep rule support (#1410, #1412, #1415), compile-time smoke gate, `badExample` requirement (#1420) closing the LLM-hallucination loop.
- **1.14.10** (2026-04-15): The Bundle Release. Shell-orchestrator `{model}` token RCE fix (#1429), Pipeline 1 compound rule authoring + fail-loud fixes in git.ts and rule-engine.ts (#1454).

### 1.13.0: The Refinement Engine (2026-04-07)

**Theme:** Telemetry-driven rule refinement, compilation routing, and structural pattern upgrades.

- **Compilation Routing:** Compile pipeline routes through Claude Sonnet 4.6 (90% correctness vs Gemini Pro's 73%, 2.4s vs 19.6s avg per Strategy #73 benchmark). Bulk recompile of 1156 lessons dropped 438 rules to 393 after purging 143 noisy Gemini-hallucinated rules and upgrading 102 regex rules to ast-grep structural matching.
- **Telemetry-Driven Refinement:** `RuleMetric.contextCounts` tracks per-context match distribution (code, string, comment, regex, unknown). `totem doctor checkUpgradeCandidates` flags regex rules with >20% non-code-context matches. `totem compile --upgrade <hash>` re-compiles a single rule with a telemetry-driven directive prompt. Self-healing `totem doctor --pr` calls `compileCommand` in-process.
- **Pipeline Hygiene:** Wind tunnel skips auto-scaffolded TODO fixtures. Extract pipeline dedups at heading level before embedding similarity. Config drift test uses token-aware character + directive count limit.
- **AST Coverage:** 8 empty-catch rules upgraded from the legacy Tree-sitter `#eq?` engine to ast-grep structural matching. Backtick wrapper stripping hardened in both Pipeline 1 (manual `**Pattern:**` extraction) and Pipeline 2 (LLM JSON output).
- **Governance:** Lesson Protection Rule (Pipeline 1 lint rule, severity error) blocks destructive shell removal of `.totem/lessons.md` at the point of intent. Added after a 41-rule near-miss. Self-governance: use totem to govern totem.
- **Standalone Binaries:** Real binaries shipped on darwin-arm64 (68 MB), linux-x64 (111 MB), win32-x64 (125 MB) via the #1241 arc (4 PRs: #1260, #1261, #1266, #1267). Original 50 MB cap was aspirational; actual Bun 1.2.x runtime baseline is 60-104 MB depending on platform.

### 1.12.0 — The Umpire & The Router (2026-04-05)

Standalone binary, research validation, and platform hardening.

- **Lite-Tier Binary:** Standalone executable with WASM ast-grep engine — no native dependencies, three platforms (linux-x64, darwin-arm64, win32-x64).
- **gemma4 Evaluation:** Auto-detect Ollama environments and validate local model viability. gemma4:26b benchmarked at 80% parse / 93% safe / 90s avg — kept for triage but ruled out for compile.
- **AST-Grep Coverage:** Extended ast-grep coverage to ESLint restricted-properties rules.
- **Windows CI:** Resolved orchestrator timeout constraints on Windows runners.
- **Context Tuning:** Proposal 213 Phases 2+3 — CLAUDE.md pulse check, GCA/CR tenets injected into bot configs.

### 1.11.0 — The Import Engine (2026-04-04)

Brought governance rules from external tools and other instances into the platform.

- **Portability:** Enabled cross-repository rule sharing between instances and imported rules from modern ESLint flat config formats.
- **Language Support:** Added baseline proactive rule packs for TypeScript, Shell, and Node.js built on established best practices.

### 1.10.2 — Phase 2: Import Engine Foundations (2026-04-04)

Hardened compiler safety and expanded ESLint import coverage.

- **Safety:** Rejected self-suppressing patterns and tracked removed rules via a retirement ledger to prevent re-extraction.
- **Enforcement:** Updated default model selections and expanded extraction handlers for restricted properties and syntax rules.

### 1.10.1 — Phase 1 Bug Fixes (2026-04-04)

Hardened the release pipeline and improved rule hygiene prior to major feature additions.

- **Hygiene:** Deduplicated false-positive exemptions and audited rule conflicts to reduce overall rule overlaps.
- **Compliance:** Narrowed exit scope rules to exclude CLI entries and improved POSIX compliance for multi-line shell hooks.

### 1.10.0 — The Invisible Exoskeleton (2026-04-02)

Reduced adoption friction for solo developers and new repository environments.

- **Developer Experience:** Added time-bounded pilot modes, local extraction options, and global profile support.
- **Enforcement Validation:** Introduced strict tiers with agent auto-detection and formalized format checks in pre-push hooks.
- **Pipeline Refactoring:** Hardened environment variable parsing and refactored the extraction pipeline into distinct per-mode modules.

### 1.9.0 — Pipeline Engine (2026-04-01)

Established multiple pipelines for rule creation ranging from manual scaffolding to fully autonomous extraction.

- **Rule Scaffolding:** Supported manual generation with test fixtures, example-based compilation, and prose-to-pattern translation.
- **Automation:** Staged observation findings automatically and translated external tool configurations without relying on language models.
- **Ecosystem:** Refreshed documentation, overhauled the playground, and published pre-compiled baseline rules for additional languages.

### 1.7.0 — Platform of Primitives (2026-03-29)

Redesigned the command structure and stabilized context engineering.

- **Architecture:** Transitioned to stateless hooks, hierarchical command structures, and hash-locked execution boundaries.
- **Context Management:** Deployed fallback search for agent context injection, repository discovery commands, and structured handoff validations.
- **Lifecycle:** Added garbage collection with adaptive decay and throughput-based ETA for compilation progress.

### 1.6.0 — Pipeline Maturity (2026-03-22)

Finalized the core self-healing loop and core enforcement testing structures.

- **Enforcement Core:** Delivered inline rule unit testing, standard libraries, and tracking ledgers for evasion traps.
- **Developer Experience:** Improved compiler workflows, implemented auto-refreshing flag mechanisms, and integrated stress testing.
