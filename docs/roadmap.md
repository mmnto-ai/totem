# Totem Roadmap

This document outlines the strategic phases for the Totem project, focusing on moving from a solid architectural foundation to frictionless user adoption, and eventually enterprise scale.

## Foundations (Functionally Complete)

The core embedded vector database, MCP server, and baseline CLI commands have been implemented.

- [x] Turborepo scaffolding (core, cli, mcp)
- [x] Syntax-aware chunkers and LanceDB store with incremental `totem sync`
- [x] MCP Server with `search_knowledge` and `add_lesson`
- [x] Auto-Injection of memory reflexes into `CLAUDE.md`, `.cursorrules`, and `.gemini/`
- [x] Ported native `@mmnto/cli` orchestrator commands (`spec`, `shield`, `triage`, `briefing`, `handoff`, `extract`)
- [x] **PR Learning Loop:** `totem extract <pr-number>` parses reviews to extract architectural lessons.
- [x] **Evidence-Based Quality Gate:** `totem shield` enforces test coverage and returns exit codes.
- [x] Validate OpenAI Happy Path (Issue #4)
- [x] Validate dogfood sync with OpenAI embeddings (Issue #8)

---

## Phase 1: The "Magic" Onboarding & Polish (Functionally Complete)

**Goal:** If users can't install Totem easily and don't trust what it does, advanced features won't matter. Make onboarding frictionless and the CLI feel premium.

- [x] **#87 Auto-configure AI tools:** `totem init` scaffolds `.gemini/settings.json`, `CLAUDE.md`, and `.cursorrules` automatically.
- [x] **#89 UX Polish for `totem init`:** Fix double-prompting and print clean success summaries so developers trust the onboarding.
- [x] **#128 Epic: Universal Baselines:** Ship a curated list of foundational AI security/architectural lessons that users can optionally install during `totem init` to solve the "cold start" problem.
- [ ] **#129 Epic: Interactive CLI Tutorial:** Build an animated, interactive CLI tutorial (`totem tutorial`) that allows users to pause the walkthrough, ask the LLM contextual questions about their codebase, and resume seamlessly.
- [ ] **#125 Epic: Invisible Orchestration:** Audit AI model hooks and Git hooks to trigger `shield`, `sync`, and `handoff` automagically, achieving a "run `init` and forget" workflow (Git hook enforcement and deterministic shield gate implemented via #310, #318).
- [x] **#86 Seamless Host Integration (#138, #139, #140):** Build the `SessionStart` hooks, Claude custom commands (Claude Code), and Totem Architect skills (Gemini CLI) that #87 installs.
- [x] **#21 CLI UI/UX Polish:** Branded colors (picocolors), ora spinners, ASCII banner. @clack/prompts multiselect shipped in v0.13.0 (#168).
- [x] **#12 / #210 Cross-platform onboarding:** Ensure docs and installers work flawlessly across Windows (PowerShell), macOS, and Linux.

## Phase 2: Core Stability & Data Safety (Functionally Complete)

**Goal:** Before ingesting enterprise databases, the local vector index and LLM prompts must be bulletproof across all environments.

- [x] **#310 / #318 / #316 / #317 Git Hook Enforcement:** Block direct `main` commits and enforce deterministic shield gate locally via git hooks, including memory classification, non-bash hook detection, and Bun support.
- [x] **#309 / #311 Security:** Restructure `GEMINI.md` for stronger rule compliance, explicit consent, and safety rules.
- [x] **#315 / #323 Security:** Bulletproof ingestion pipeline with adversarial content scrubbing, evaluation harness, and Bun support.
- [x] **#267 / #272 Security:** Configure Dependabot for automated security vulnerability scanning.
- [x] **#218 Security:** Add ReDoS protection to compiled regex rules.
- [x] **#206 / #224 Robustness:** Refactor orchestrator from `execSync` to async `spawn` and fix `node-fetch` aborts on large files like `architecture.md` via Gemini CLI.
- [x] **#173 Epic: Universal AST Parsing:** Implement Tree-sitter for robust, language-agnostic code chunking.
- [x] **#121 Bug: LanceDB `deleteByFile`** edge cases causing silent incremental sync failures.
- [x] **#122 Core Tests:** Backfill unit and integration tests for `@mmnto/totem` core database and chunking logic.
- [x] **#174 / #180 Shield GitHub Action:** `action.yml` composite action for CI/CD enforcement — pass/fail quality gate on PRs.
- [x] **#222 / #226 CI Workflows:** Implement deterministic shield workflow, linting, tests, and compiled rules enforcement into the Totem repository CI pipeline.
- [x] **#168 / #265 Interactive multi-select:** `totem extract` uses `@clack/prompts` multiselect for cherry-picking lessons and supports selective acceptance via the `--pick` flag.
- [x] **#185 CLI command renames:** `learn` → `extract`, removed `anchor` alias (use `add-lesson`).
- [x] **#131 Clean Ejection:** Build `totem eject` to safely remove git hooks, prompt injections, and database artifacts if a user uninstalls.
- [x] **#127 Core:** Add heading hierarchy breadcrumbs to MarkdownChunker labels.
- [x] **#203 UX:** Descriptive headings for extracted lessons to improve search relevance (Fixed truncation in #253, enforced concise lesson headings in #271, #278).
- [x] **#158 Chore:** Unify XML escaping utilities across MCP and CLI.
- [x] **#156 Core:** Incremental sync now removes deleted files from LanceDB.
- [x] **#155 Core:** Stateful incremental sync via `.totem/cache/sync-state.json`.
- [x] **#160 Security:** Defensive Context Management Reflexes (Auto-Warnings).
- [x] **#117 UX:** Allow `spec` and `extract` commands to accept multiple arguments.
- [x] **#109 Performance:** Condense context payloads for fast-boot commands.
- [x] **#108 UX:** Clean up orphaned temporary prompt files.
- [x] **#107 UX:** Emit background sync logs via MCP progress events.
- [x] **#149 Security:** XML-delimit MCP tool responses to mitigate indirect prompt injection.
- [x] **#148 Config:** Add Zod schema validation for Claude settings.local.json.
- [x] **#147 Core:** Extract inline shell hooks into dedicated Node.js scripts.
- [x] **#80 Security: Add XML delimiting:** Close the prompt injection gap in orchestrator commands.
- [x] **#111 Security:** Mitigate indirect prompt injection in `extract` command via PR comments (Further hardened with SECURITY NOTICE via #279, #289, #295).
- [x] **#290 / #299 Security:** Post-extraction suspicious lesson detection with `--yes` mode blocking and false-positive reduction (#291, #302).
- [x] **#116 Security:** Sanitize CLI output streams to prevent terminal injection attacks.
- [x] **#106 Robustness:** Prevent stale LanceDB handles by re-initializing store on error.
- [x] **#105 Resilience:** Add exponential backoff to OpenAI embedder for rate limits.
- [x] **#104 Performance:** Stream chunks to LanceDB during sync to prevent OOM on large repos.
- [x] **#91 Normalize LanceDB paths:** Fix Windows backslash issues before users share `.lancedb` folders across OS boundaries.
- [x] **#90 Refactor to `IssueAdapter` / `PrAdapter`:** Extract `gh` CLI logic into interfaces to decouple from GitHub.
- [x] **#77 Test audit:** Backfill CLI unit tests using the newly added Vitest infrastructure. (103+ tests passing)
- [x] **#78 Shell escaping edge cases:** Validate `execSync` safety with PowerShell as default shell.

## Phase 3: Workflow Expansion (Power User Tools)

**Goal:** Give existing users more ways to interact with their data locally and visualize their usage.

- [ ] **#130 Epic: Database Observability:** Build `totem inspect` or a local UI to visualize vector chunks, index health, and ignored files to build trust in the "black box".
- [ ] **#119 `totem run <workflow>`:** Introduce a custom AI task runner to execute user-defined markdown workflows via the orchestrator.
- [x] **#181 Drift Detection (#177, #211, #284):** Self-cleaning memory — detect and prune stale lessons automatically (Includes path containment checks).
- [x] **#120 Custom Prompt Overrides:** Allow users to override the hardcoded personas for built-in commands (`spec`, `shield`, etc.) via `.totem/prompts/`.
- [x] **#44 `totem bridge`:** Build a mid-session context compaction tool to clear token windows without losing place.
- [x] **#281 / #288 Handoff Lite:** `totem handoff --lite` for zero-LLM session snapshots, including path containment and ANSI terminal injection sanitization (#284, #292).
- [ ] **#74 `totem oracle`:** Add a frictionless Q&A command to query LanceDB without strict personas.
- [ ] **#92 Telemetry Logging & Dashboard:** Persist token stats to `.totem/telemetry.jsonl` and build `totem stats` to track API quota usage.
- [x] **#83 Support GitHub issue URLs:** Allow users to paste full URLs in addition to issue numbers for `totem spec` and `triage`.
- [ ] **#23 Automated Memory Consolidation:** Command (`totem consolidate`) to clean up and merge old lessons.
- [x] **#187 Minimum Viable Configuration:** Tiered config (Lite/Standard/Full) with auto-detection. Embedding is optional; Lite tier works with zero API keys.
- [x] **#190 / #228 / #238 / #241 Automated Doc Sync (#249, #250):** `totem docs` command to keep project docs updated via per-doc LLM passes, now supporting individual doc targeting, path fixes, hallucination fixes, and XML sentinels. Integrated into `totem wrap` as Step 4/4 (#143).
- [x] **#213 / #216 / #255 Zero-LLM Shield Mode (#251, #270, #287):** Deterministic lesson compiler, zero-LLM shield mode (including `--mode=structural` context-blind review), false-positive resolution, inline suppression directives, and Tree-sitter AST gating (#287).
- [x] **#303 / #307 Shield Learning Loop:** Optional lesson extraction from LLM verdicts via `totem shield --learn`, integrated with false-positive reduction.
- [x] **#229 Epic: Native API Orchestrator (#230–#234, #236, #237, #285, #293, #298, #306):** Replace CLI shell-spawning with direct SDK calls to Gemini (`@google/genai`) and Anthropic (`@anthropic-ai/sdk`). BYOSD pattern with optional peer dependencies, discriminated union config, package manager auto-detection for install prompts, generic OpenAI-compatible orchestrator support (Ollama / local), and a native Ollama orchestrator with dynamic `num_ctx`.
- [x] **#243 / #246 Multi-Model Orchestration (#235, #324, #325, #327):** Enable cross-provider routing in orchestrator overrides using `provider:model` syntax with negated glob support, audited default model IDs, and a supported models reference document.
- [x] **#248 Orchestrator Refactoring:** Extract `resolveOrchestrator()` helper to deduplicate model resolution.
- [x] **#144 Epic: AI PR Review Posture & Noise Reduction:** Refine AI PR review posture to reduce noise (Includes GCA on-demand reviews and configuration fixes via #278, #282).
- [x] **#264 / #269 Cross-Model Enforcement:** Enable cross-model lesson export via `totem compile --export` and GitHub Copilot instructions (#294).
- [x] **#244 / #245 Provider Conformance Suite (#263):** Build conformance suite and nightly integration smoke tests to ensure all orchestrator models behave consistently.
- [ ] **#195 / #196 / #214 Epic: Shift-Left AI Verification:** Define model compatibility strategy, build adversarial evaluation harness for CI (Model Drift Mitigation), and implement CI Drift Gate (Harness and Drift Gate implemented via #280, adversarial eval harness updated via #323).
- [x] **#247 Analysis: Multi-Agent Code Review:** Research multi-agent code review and the Three-Lens Model for automated PR review workflows.
- [ ] **#176 Agent-Optimized MCP:** Dynamic token budgeting and write access for deeper agent-to-agent interactions.
- [ ] **#183 Cross-File Knowledge Graph (Blocked):** Implement symbol resolution to enable multi-file architectural reasoning.

## Phase 4: Enterprise Expansion

**Goal:** Scale Totem from individual developers to entire organizations by ingesting third-party data sources.

- [ ] **#124 Epic: Automated Onboarding:** Build `totem onboard <issue>` to generate contextual Day 1 briefings (architecture + traps) tailored to a new developer's first assigned ticket.
- [ ] **#123 Epic: Federated Memory:** Allow `totem.config.ts` to declare external/upstream LanceDB indexes (The Mothership Pattern) to inherit meta-lessons or team-wide policies.
- [ ] **#175 Epic: Multiplayer Cache Syncing:** Phase 4 enterprise/team scaling capability.
- [ ] **#84 Issue Tracking Adapters:** Implement Jira and Linear adapters using the interface built in Phase 2.
- [ ] **#79 Documentation Ingestion Pipeline:** Build Pull/Push models for Notion, Confluence, or internal wikis.
- [ ] **#34 Configurable Governance:** Let enterprise teams configure AI review loops (`auditLoopLimit`, `shieldSeverityThreshold`).
- [ ] **#42 Universal AI DevEx:** Evolve `totem init` to inject "Best Practices" guardrails (Anti-Refactor, Test Coverage triggers).
- [ ] **#198 RFC: Open Core & Defensive Licensing Strategy (Blocked):** Evaluate MIT vs. Fair Source licensing strategy (Closed in favor of Apache 2.0).
- [x] Implement Changesets and npm publishing (Issue #5 / #46)
- [x] Chore: Relicense project from MIT to Apache 2.0
- [x] **#258 / #266 Governance:** Implement Contributor License Agreement (CLA) automation and CONTRIBUTING.md.
- [x] **#300 / #321 Governance & Security:** Migrate `.strategy` directory to a private submodule for secure collaboration and ensure proper git submodule setup.
