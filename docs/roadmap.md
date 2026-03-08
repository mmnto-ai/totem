# Totem Roadmap

This document outlines the strategic phases for the Totem project, focusing on moving from a solid architectural foundation to frictionless user adoption, and eventually enterprise scale.

## Foundations (Mostly Complete)

The core embedded vector database, MCP server, and baseline CLI commands have been implemented.

- [x] Turborepo scaffolding (core, cli, mcp)
- [x] Syntax-aware chunkers and LanceDB store with incremental `totem sync`
- [x] MCP Server with `search_knowledge` and `add_lesson`
- [x] Auto-Injection of memory reflexes into `CLAUDE.md`, `.cursorrules`, and `.gemini/`
- [x] Ported native `@mmnto/cli` orchestrator commands (`spec`, `shield`, `triage`, `briefing`, `handoff`, `extract`)
- [x] **PR Learning Loop:** `totem extract <pr-number>` parses reviews to extract architectural lessons.
- [x] **Evidence-Based Quality Gate:** `totem shield` enforces test coverage and returns exit codes.
- [ ] Validate OpenAI Happy Path (Issue #4 / #8)

---

## Phase 1: The "Magic" Onboarding & Polish

**Goal:** If users can't install Totem easily and don't trust what it does, advanced features won't matter. Make onboarding frictionless and the CLI feel premium.

- [x] **#87 Auto-configure AI tools:** `totem init` scaffolds `.gemini/settings.json`, `CLAUDE.md`, and `.cursorrules` automatically.
- [x] **#89 UX Polish for `totem init`:** Fix double-prompting and print clean success summaries so developers trust the onboarding.
- [x] **#128 Epic: Universal Baselines:** Ship a curated list of foundational AI security/architectural lessons that users can optionally install during `totem init` to solve the "cold start" problem.
- [ ] **#129 Epic: Interactive CLI Tutorial:** Build an animated, interactive CLI tutorial (`totem tutorial`) that allows users to pause the walkthrough, ask the LLM contextual questions about their codebase, and resume seamlessly.
- [ ] **#125 Epic: Invisible Orchestration:** Audit AI model hooks and Git hooks to trigger `shield`, `sync`, and `handoff` automagically, achieving a "run `init` and forget" workflow.
- [x] **#86 Seamless Host Integration:** Build the `SessionStart` hooks, Claude custom commands, and `Totem Architect` skills that #87 installs.
- [x] **#21 CLI UI/UX Polish:** Branded colors (picocolors), ora spinners, ASCII banner. @clack/prompts multiselect shipped in v0.13.0 (#168).
- [ ] **#12 Cross-platform onboarding:** Ensure docs and installers work flawlessly across Windows (PowerShell) and macOS.

## Phase 2: Core Stability & Data Safety

**Goal:** Before ingesting enterprise databases, the local vector index and LLM prompts must be bulletproof across all environments.

- [x] **#121 Bug: LanceDB `deleteByFile`** edge cases causing silent incremental sync failures.
- [x] **#122 Core Tests:** Backfill unit and integration tests for `@mmnto/totem` core database and chunking logic.
- [x] **#180 Shield GitHub Action:** `action.yml` composite action for CI/CD enforcement — pass/fail quality gate on PRs.
- [x] **#168 Interactive multi-select:** `totem extract` uses `@clack/prompts` multiselect for cherry-picking lessons.
- [x] **#185 CLI command renames:** `learn` → `extract`, removed `anchor` alias (use `add-lesson`).
- [x] **#131 Clean Ejection:** Build `totem eject` to safely remove git hooks, prompt injections, and database artifacts if a user uninstalls.
- [x] **#127 Core:** Add heading hierarchy breadcrumbs to MarkdownChunker labels.
- [x] **#158 Chore:** Unify XML escaping utilities across MCP and CLI.
- [x] **#156 Core:** Incremental sync now removes deleted files from LanceDB.
- [x] **#155 Core:** Stateful incremental sync via `.totem/cache/sync-state.json`.
- [x] **#160 Security:** Defensive Context Management Reflexes (Auto-Warnings).
- [x] **#109 Performance:** Condense context payloads for fast-boot commands.
- [x] **#107 UX:** Emit background sync logs via MCP progress events.
- [x] **#149 Security:** XML-delimit MCP tool responses to mitigate indirect prompt injection.
- [x] **#148 Config:** Add Zod schema validation for Claude settings.local.json.
- [x] **#147 Core:** Extract inline shell hooks into dedicated Node.js scripts.
- [x] **#80 Security: Add XML delimiting:** Close the prompt injection gap in orchestrator commands.
- [x] **#111 Security:** Mitigate indirect prompt injection in `extract` command via PR comments.
- [x] **#116 Security:** Sanitize CLI output streams to prevent terminal injection attacks.
- [x] **#106 Robustness:** Prevent stale LanceDB handles by re-initializing store on error.
- [x] **#105 Resilience:** Add exponential backoff to OpenAI embedder for rate limits.
- [x] **#104 Performance:** Stream chunks to LanceDB during sync to prevent OOM on large repos.
- [x] **#91 Normalize LanceDB paths:** Fix Windows backslash issues before users share `.lancedb` folders across OS boundaries.
- [x] **#90 Refactor to `IssueAdapter` / `PrAdapter`:** Extract `gh` CLI logic into interfaces to decouple from GitHub.
- [x] **#77 Test audit:** Backfill CLI unit tests using the newly added Vitest infrastructure. (103+ tests passing)
- [x] **#78 Shell escaping edge cases:** Validate `execSync` safety with PowerShell as default shell. (No changes needed — `execSync` always uses `cmd.exe` on Windows.)

## Phase 3: Workflow Expansion (Power User Tools)

**Goal:** Give existing users more ways to interact with their data locally and visualize their usage.

- [ ] **#130 Epic: Database Observability:** Build `totem inspect` or a local UI to visualize vector chunks, index health, and ignored files to build trust in the "black box".
- [ ] **#119 `totem run <workflow>`:** Introduce a custom AI task runner to execute user-defined markdown workflows via the orchestrator.
- [x] **#120 Custom Prompt Overrides:** Allow users to override the hardcoded personas for built-in commands (`spec`, `shield`, etc.) via `.totem/prompts/`.
- [x] **#44 `totem bridge`:** Build a mid-session context compaction tool to clear token windows without losing place.
- [ ] **#74 `totem oracle`:** Add a frictionless Q&A command to query LanceDB without strict personas.
- [ ] **#92 Telemetry Logging & Dashboard:** Persist token stats to `.totem/telemetry.jsonl` and build `totem stats` to track API quota usage.
- [x] **#83 Support GitHub issue URLs:** Allow users to paste full URLs in addition to issue numbers for `totem spec` and `triage`.
- [ ] **#23 Automated Memory Consolidation:** Command (`totem consolidate`) to clean up and merge old lessons.
- [x] **#187 Minimum Viable Configuration:** Tiered config (Lite/Standard/Full) with auto-detection. Embedding is optional; Lite tier works with zero API keys.
- [x] **#190 Automated Doc Sync:** `totem docs` command to keep project docs updated via per-doc LLM passes. Integrated into `totem wrap` as Step 4/4.
- [ ] **#181 Drift Detection:** Self-cleaning memory — detect and prune stale lessons automatically.

## Phase 4: Enterprise Expansion

**Goal:** Scale Totem from individual developers to entire organizations by ingesting third-party data sources.

- [ ] **#124 Epic: Automated Onboarding:** Build `totem onboard <issue>` to generate contextual Day 1 briefings (architecture + traps) tailored to a new developer's first assigned ticket.
- [ ] **#123 Epic: Federated Memory:** Allow `totem.config.ts` to declare external/upstream LanceDB indexes (The Mothership Pattern) to inherit meta-lessons or team-wide policies.
- [ ] **#84 Issue Tracking Adapters:** Implement Jira and Linear adapters using the interface built in Phase 2.
- [ ] **#79 Documentation Ingestion Pipeline:** Build Pull/Push models for Notion, Confluence, or internal wikis.
- [ ] **#34 Configurable Governance:** Let enterprise teams configure AI review loops (`auditLoopLimit`, `shieldSeverityThreshold`).
- [ ] **#42 Universal AI DevEx:** Evolve `totem init` to inject "Best Practices" guardrails (Anti-Refactor, Test Coverage triggers).
- [x] Implement Changesets and npm publishing (Issue #5 / #46)
