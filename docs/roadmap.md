# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a standard library for codebase governance — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the active progression of enforcement primitives, platform validation, and rule distribution.

---

## 1.13.0 — The Refinement Engine (Active — release prep)

**Theme:** Telemetry-driven rule refinement, compilation routing, and structural pattern upgrades.

- **Compilation Routing:**
  - [x] **Sonnet Routing:** Compile pipeline routes through Claude Sonnet 4.6 (90% correctness vs Gemini Pro's 73%, 2.4s vs 19.6s avg). Validated by Strategy #73 benchmark across 30 lessons in 4 difficulty tiers.
  - [x] **Bulk Recompile:** All 1156 lessons recompiled through Sonnet — 438 → 397 rules, 102 regex→ast-grep upgrades, 143 noisy Gemini-hallucinated rules purged. Quality > quantity.
  - [x] **Prompt Rewrite:** Compiler system prompt rewritten with explicit ast-grep preference, syntax cheat sheet, and 6 compound pattern examples mined from benchmark failures.
  - [x] **Parser Hardening:** Backtick wrapper stripping in both Pipeline 1 (manual `**Pattern:**` extraction) and Pipeline 2 (LLM JSON output) so generated patterns no longer ship with code-fence artifacts.

- **Telemetry-Driven Refinement:**
  - [x] **Context Telemetry:** `RuleMetric` now tracks the per-context match distribution (code, string, comment, regex, unknown). Match-context comes from the rule runner's `astContext` field; historical hits are seeded into the `unknown` bucket so older metrics remain interpretable.
  - [x] **`totem doctor` Diagnostic:** New `checkUpgradeCandidates` flags regex rules whose telemetry shows >20% of matches landing in non-code contexts (excluding `unknown` from the ratio, with a 5-event minimum-confidence floor).
  - [x] **`totem compile --upgrade <hash>`:** Re-compile a single targeted rule through Claude Sonnet with a telemetry-driven directive prompt. Scoped cache eviction preserves the rule's original `createdAt` metadata; failure paths leave the old rule intact (fail-safe) while replacement paths handle both `compiled` and `skipped` outcomes consistently.
  - [x] **Self-Healing Integration:** `totem doctor --pr` upgrade phase calls `compileCommand` in-process, bundles results into the existing branch + commit + PR flow, reports only actual replacements (not noop/skipped/failed) in the auto-heal PR body, and stages `compile-manifest.json` alongside the rules file.
  - [x] **AST Empty Catch:** 8 empty-catch rules upgraded from the legacy `ast` (Tree-sitter `#eq?`) engine to `ast-grep` structural matching, correctly handling parameterless catch blocks and multi-line empty bodies.

- **Pipeline Hygiene:**
  - [x] **Wind Tunnel:** Skip auto-scaffolded TODO fixtures so empty placeholder fixtures don't dilute the gate signal.
  - [x] **Extract Dedup:** Heading-level exact-match deduplication runs before embedding similarity to short-circuit duplicate ingestion at zero cost.
  - [x] **Config Drift Test:** Replaced the line-count limit on instructional files with a token-aware character + directive count limit.

- **Governance (eat your own dogfood):**
  - [x] **Lesson Protection Rule:** A near-miss almost deleted `.totem/lessons.md` (which sources 41+ functional ast-grep rules) under the mistaken assumption it was legacy cruft. Encoded the constraint as a Pipeline 1 lint rule with severity `error` that flags the destructive `git rm .totem/lessons.md` shell command at the point of intent across all script and documentation files. Demonstrates the totem thesis: when an agent makes a mistake, write a deterministic constraint, not a sticky note.

---

## 1.14.0 — The Distribution Pipeline (Next)

**Theme:** The Totem Pack Ecosystem. We spent 1.13.0 proving the engine can generate high-fidelity ast-grep rules — the bulk Sonnet recompile produced 397 precise rules and the refinement diagnostic closes the loop on noisy ones. 1.14.0 is about letting teams **bundle and share** those proven rules across repositories via the npm registry.

- **Headline Work:**
  - [ ] **Rule Pack Distribution:** Standardized bundles for reusable rule distribution (#1059). Teams should be able to publish a versioned pack of compiled rules to npm and consume them in other projects under the same governance contract that locally-compiled rules satisfy.
  - [ ] **Distributing Compiled Rules:** Strategy #35 research — mechanisms, versioning model, trust anchors, and integrity verification for cross-team rule sharing.

- **Bundled Cleanup (operational chores on the way):**
  - [ ] **Cloud Compile → Sonnet:** Update the cloud compile worker to route through Claude Sonnet (#1221) — critical prerequisite for cloud distribution, since packs compiled through the cloud need to meet the same quality bar as local Sonnet compile.
  - [ ] **`cwd` Threading:** Thread explicit `cwd` through `compileCommand` so packs can be compiled from arbitrary working directories (#1232, #1234 follow-up).
  - [ ] **Build Artifact:** Investigate and fix the stray `packages/core/{}` file produced by `pnpm build` (#1233).
  - [ ] **Batch `--upgrade`:** Refactor `compileCommand` to accept an array of hashes so `runSelfHealing` doesn't reload config + lessons + rules + manifest per candidate (#1235).
  - [ ] **Broad `throw $ERR` Pattern:** Refine the overly-broad ast-grep pattern (#1218).
  - [ ] **Lazy Compile Templates:** Lazy-load compiler prompt templates to reduce CLI startup cost (#1219).

---

## 1.15.0 — The Ingestion Pipeline

**Theme:** Source Diversity and the Self-Healing Loop. Expand the extraction pipeline to automatically convert external signals — GitHub Advanced Security (GHAS) alerts and standard repository lint warnings — into deterministic Totem lessons. Where 1.13.0 refined rules from internal telemetry and 1.14.0 distributes them across teams, 1.15.0 is about where the _inputs_ come from.

- **Headline Work:**
  - [ ] **GHAS / SARIF Extraction:** Convert GitHub Advanced Security alerts into Totem lessons (Strategy #50). This is the original #1131 scope we pivoted away from when telemetry-driven refinement won — now the right time, because 1.14.0 distribution gives us a way to ship the resulting rules back out.
  - [ ] **Lint Warning Extraction:** Convert repository lint warnings (ESLint, Semgrep, Sonar) into actionable lessons (Strategy #51).

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
