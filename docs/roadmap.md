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

- **Onboarding & UX:** Auto-configured AI tools (`totem init`), cross-platform installers (#12, #210), and premium CLI UI polish (#21, #89).
- **Host Integration:** Seamless host integration hooks for Claude and Gemini (#86), alongside universal baseline lessons (#128).
- [ ] **#129 Epic: Interactive CLI Tutorial:** Build an animated, interactive CLI tutorial (`totem tutorial`) that allows users to pause the walkthrough, ask the LLM contextual questions about their codebase, and resume seamlessly.
- [ ] **#125 Epic: Invisible Orchestration:** Audit AI model hooks and Git hooks to trigger `shield`, `sync`, and `handoff` automagically, achieving a "run `init` and forget" workflow (Git hook enforcement, `totem hooks` auto-install, and deterministic shield gate implemented via #310, #318, #332, #335).

## Phase 2: Core Stability & Data Safety (Functionally Complete)

**Goal:** Before ingesting enterprise databases, the local vector index and LLM prompts must be bulletproof across all environments.

This phase fortified the core architecture, shifting focus to native orchestration, zero-LLM gating, and rigorous security measures.

- **AST & Chunking:** Implemented Tree-sitter universal parsing, deterministic lesson compiler, and zero-LLM shield with AST gating (#173, #213).
- **Orchestration:** Integrated native API providers (Gemini, Anthropic, Ollama) and generic OpenAI-compatible models (#229, #298). Enabled cross-provider routing, audited default model IDs, and built conformance suites (#243, #324).
- **Doc Sync & Memory:** Delivered automated doc sync targeting individual files, drift detection with path containment, and cross-model Copilot export (#190, #284, #294).
- **Shield & CI:** Built the Shield GitHub Action, inline suppression, `--learn` mode for lesson extraction, and laid the foundation for CI drift gating (#174, #303).
- **Security:** Added adversarial ingestion scrubbing, suspicious lesson detection with context-aware false positive reduction, and ANSI sanitization (#315, #344). Hardened prompts with XML delimiting and SECURITY NOTICE blocks to mitigate prompt injection (#289).
- **DX & Hooks:** Enforced git hooks natively with monorepo root traversal, non-bash hook detection, and Bun support (#310, #317). Shipped `totem hooks` auto-installation backed by integration tests (#332, #345).

## Phase 3: Workflow Expansion (Power User Tools)

**Goal:** Give existing users more ways to interact with their data locally and visualize their usage.

- **Observability & Maintenance:**
  - [ ] **#130 Epic: Database Observability:** Build `totem inspect` or a local UI to visualize vector chunks, index health, and ignored files.
  - [ ] **#92 Telemetry Logging & Dashboard:** Persist token stats to `.totem/telemetry.jsonl` and build `totem stats` to track API quota usage.
  - [ ] **#23 Automated Memory Consolidation:** Command (`totem consolidate`) to clean up and merge old lessons.
- **Workflow & Execution:**
  - [ ] **#119 `totem run <workflow>`:** Introduce a custom AI task runner to execute user-defined markdown workflows via the orchestrator.
  - [ ] **#74 `totem oracle`:** Add a frictionless Q&A command to query LanceDB without strict personas.
- **Shift-Left & Advanced Intelligence:**
  - [ ] **#195 / #196 / #214 Epic: Shift-Left AI Verification:** Define model compatibility and auditing strategy to systematically verify models. Build adversarial evaluation harness for CI and implement CI Drift Gate.
  - [ ] **#176 Agent-Optimized MCP:** Dynamic token budgeting and write access for deeper agent-to-agent interactions.
  - [ ] **#183 Cross-File Knowledge Graph (Blocked):** Implement symbol resolution to enable multi-file architectural reasoning.

## Phase 4: Enterprise Expansion

**Goal:** Scale Totem from individual developers to entire organizations by ingesting third-party data sources.

- **Enterprise Memory & Scaling:**
  - [ ] **#123 Epic: Federated Memory:** Allow `totem.config.ts` to declare external/upstream LanceDB indexes (The Mothership Pattern) to inherit meta-lessons or team-wide policies.
  - [ ] **#175 Epic: Multiplayer Cache Syncing:** Phase 4 enterprise/team scaling capability.
  - [ ] **#79 Documentation Ingestion Pipeline:** Build Pull/Push models for Notion, Confluence, or internal wikis.
- **Integration & DevEx:**
  - [ ] **#124 Epic: Automated Onboarding:** Build `totem onboard <issue>` to generate contextual Day 1 briefings (architecture + traps) tailored to a new developer's first assigned ticket.
  - [ ] **#84 Issue Tracking Adapters:** Implement Jira and Linear adapters using the interface built in Phase 2.
  - [ ] **#42 Universal AI DevEx:** Evolve `totem init` to inject "Best Practices" guardrails (Anti-Refactor, Test Coverage triggers).
- **Governance & Licensing:**
  - [ ] **#34 Configurable Governance:** Let enterprise teams configure AI review loops (`auditLoopLimit`, `shieldSeverityThreshold`).
  - [ ] **#198 RFC: Open Core & Defensive Licensing Strategy (Blocked):** Evaluate MIT vs. Fair Source licensing strategy (Closed in favor of Apache 2.0).
  - [x] Implement Changesets and npm publishing (Issue #5 / #46)
  - [x] Chore: Relicense project from MIT to Apache 2.0
  - [x] **#258 / #266 Governance:** Implement Contributor License Agreement (CLA) automation and CONTRIBUTING.md.
  - [x] **#300 / #321 Governance & Security:** Migrate `.strategy` directory to a private submodule for secure collaboration and ensure proper git submodule setup and pointer tracking (#331).
