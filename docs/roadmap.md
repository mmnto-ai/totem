# Totem Roadmap

This document outlines the strategic phases for the Totem project, focusing on moving from a solid architectural foundation to frictionless user adoption, and eventually enterprise scale.

## Foundations (Functionally Complete)

The core embedded vector database, MCP server, and baseline CLI commands have been successfully implemented. This established the foundational architecture and validation workflows.

- **Core Architecture:** Turborepo scaffolding and syntax-aware LanceDB store with incremental `totem sync`.
- **Integrations:** MCP Server implementation and auto-injection of memory reflexes into AI tools.
- **CLI & Workflows:** Ported native orchestrator commands, PR Learning Loop (`extract`), and Evidence-Based Quality Gate (`shield`).
- **Validation:** Validated OpenAI happy path and dogfood sync with embeddings (#4, #8).

---

## Phase 1: The "Magic" Onboarding & Polish (Functionally Complete)

**Goal:** If users can't install Totem easily and don't trust what it does, advanced features won't matter. Make onboarding frictionless and the CLI feel premium.

This phase delivered seamless cross-platform onboarding, automated AI tool configuration, and universal baseline lessons.

- **Onboarding & UX:**
  - Auto-configured AI tools with JetBrains Junie support (`totem init`) (#371).
  - Versioned reflex upgrade paths for existing consumers (#375, #376).
  - Cross-platform installers and proper `--help` output (#210, #358).
  - Premium CLI UI polish (#21, #89).
- **Host Integration:**
  - Seamless host integration hooks for Claude and Gemini (#86).
  - Universal baseline lessons injected with harder vector DB reflexes (#372).
- [ ] **#129 Epic: Interactive CLI Tutorial:** Build an animated, interactive CLI tutorial (`totem tutorial`). This allows users to pause the walkthrough, ask the LLM contextual questions, and resume seamlessly.
- [ ] **#125 Epic: Invisible Orchestration:** Audit AI model hooks and Git hooks to trigger `shield`, `sync`, and `handoff` automagically. Achieves a "run `init` and forget" workflow via deterministic shield gates and auto-installs (#310, #332, #355).

## Phase 2: Core Stability & Data Safety (Functionally Complete)

**Goal:** Before ingesting enterprise databases, the local vector index and LLM prompts must be bulletproof across all environments.

This phase fortified the core architecture, delivering native orchestration, zero-LLM gating, and rigorous security measures.

- **AST & Orchestration:**
  - Universal Tree-sitter parsing and AST gating for zero-LLM shielding.
  - Cross-provider routing across Gemini, Anthropic, OpenAI, and Ollama.
- **Data Safety & Memory:**
  - Saga-based transactional docs and cross-model export (#351).
  - Automated document synchronization, drift detection, and zero-LLM session snapshots.
- **Security & DX:**
  - Adversarial ingestion scrubbing, extraction hardening, and suspicious lesson detection.
  - Native Git hook enforcement with monorepo and Bun support.
  - `totem hooks` auto-installation and CI drift gating foundations.

## Phase 3: Workflow Expansion (Power User Tools)

**Goal:** Give existing users more ways to interact with their data locally and visualize their usage.

- **Observability & Maintenance:**
  - [ ] **#130 Epic: Database Observability:** Build `totem inspect` or a local UI to visualize vector chunks. This will track index health and ignored files.
  - [ ] **#92 Telemetry Logging & Dashboard:** Persist token stats to `.totem/telemetry.jsonl` and build `totem stats` to track API quota usage.
  - [ ] **#23 Automated Memory Consolidation:** Command (`totem consolidate`) to clean up and merge old lessons.
- **Workflow & Execution:**
  - [x] **#362 Strategic Backlog Audit:** Added `totem audit` for backlog auditing with a human approval gate (#362, #389).
  - [x] **Context Injection:** Embedded relevant vector DB lessons into all orchestrator commands and `totem spec` output (#366, #391).
  - [ ] **#119 `totem run <workflow>`:** Introduce a custom AI task runner to execute user-defined markdown workflows via the orchestrator.
  - [ ] **#74 `totem oracle`:** Add a frictionless Q&A command to query LanceDB without strict personas.
- **Shift-Left & Advanced Intelligence:**
  - [ ] **#195 / #196 / #214 Epic: Shift-Left AI Verification:** Define model compatibility and auditing strategy to systematically verify models. Build adversarial evaluation harness for CI and implement CI Drift Gate.
  - [ ] **#176 Agent-Optimized MCP:** Dynamic token budgeting and write access for deeper agent-to-agent interactions. Includes multi-agent permissions and role-based access control (#312).
  - [ ] **#183 Cross-File Knowledge Graph (Blocked):** Implement symbol resolution to enable multi-file architectural reasoning.

## Phase 4: Enterprise Expansion

**Goal:** Scale Totem from individual developers to entire organizations by ingesting third-party data sources.

- **Enterprise Memory & Scaling:**
  - [ ] **#123 Epic: Federated Memory:** Allow `totem.config.ts` to declare external/upstream LanceDB indexes (The Mothership Pattern). Enables teams to inherit meta-lessons or team-wide policies (Post-1.0).
  - [ ] **#175 Epic: Multiplayer Cache Syncing:** Phase 4 enterprise/team scaling capability (Post-1.0).
  - [ ] **#79 Documentation Ingestion Pipeline:** Build Pull/Push models for Notion, Confluence, or internal wikis.
  - [x] **#286 Epic: Rust Core Extraction:** Evaluated `totem-core-rs` for enterprise-scale extraction performance.
- **Integration & DevEx:**
  - [ ] **#124 Epic: Automated Onboarding:** Build `totem onboard <issue>` to generate contextual Day 1 briefings. These will be tailored to a new developer's first assigned ticket.
  - [ ] **#84 Issue Tracking Adapters:** Implement Jira and Linear adapters using the interface built in Phase 2.
  - [ ] **#42 Universal AI DevEx:** Evolve `totem init` to inject "Best Practices" guardrails like Anti-Refactor and Test Coverage triggers.
- **Governance & Licensing:**
  - [ ] **#34 Configurable Governance:** Let enterprise teams configure AI review loops (`auditLoopLimit`, `shieldSeverityThreshold`).
  - [ ] **#198 RFC: Open Core & Licensing:** Evaluate MIT vs. Fair Source licensing strategy. Closed in favor of Apache 2.0, with FSL intelligence layer re-evaluated (#353).
  - [x] Implement Changesets and npm publishing (#5, #46).
  - [x] Chore: Relicense project from MIT to Apache 2.0.
  - [x] **#258 / #266 Governance:** Implement Contributor License Agreement (CLA) automation and CONTRIBUTING.md.
  - [x] **#267 / #268 Security Scanning:** Configured Dependabot and enabled GitHub CodeQL for Advanced Security.
  - [x] **#300 / #321 Governance & Security:** Migrate `.strategy` directory to a private submodule for secure collaboration. Ensures proper git submodule setup, pointer tracking, and indexing (#363).
