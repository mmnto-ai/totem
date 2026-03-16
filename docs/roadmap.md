# Totem Roadmap

This document outlines the strategic phases for the Totem project, focusing on moving from a solid architectural foundation to frictionless user adoption, and eventually enterprise scale.

## Foundations (Functionally Complete)

The core embedded vector database, MCP server, and baseline CLI commands have been successfully implemented. This established the foundational architecture and validation workflows.

- **Core Architecture:**
  - Turborepo scaffolding and syntax-aware LanceDB store.
  - Incremental synchronization capabilities via `totem sync`.
- **Integrations:**
  - MCP Server implementation.
  - Auto-injection of memory reflexes into AI tools.
- **CLI & Workflows:**
  - Ported native orchestrator commands.
  - PR Learning Loop (`extract`) and Evidence-Based Quality Gate (`shield`).
- **Validation:**
  - Validated OpenAI happy path.
  - Dogfood synchronization with embeddings.

---

## Phase 1: The "Magic" Onboarding & Polish (Functionally Complete)

**Goal:** If users can't install Totem easily and don't trust what it does, advanced features won't matter. Make onboarding frictionless and the CLI feel premium.

This phase delivered seamless cross-platform onboarding, automated AI tool configuration, and universal baseline lessons.

- **Onboarding & UX:**
  - **Tool Automation:** Auto-configured AI tools with JetBrains Junie and Copilot support (#448).
  - **CLI Experience:** Delivered cross-platform installers, versioned reflex upgrade paths, and premium CLI UI polish.
- **Host Integration:**
  - **Seamless Hooks:** Agent hooks for Claude Code, , Gemini, and Junie (#464).
  - **Baseline Intelligence:** Universal baseline lessons injected with harder vector DB reflexes.
  - **Enforcement:** Involuntary enforcement strategy under research (#520).
- [ ] **#129 Epic: Interactive CLI Tutorial:** Build an animated, interactive CLI tutorial (`totem tutorial`). This allows users to pause the walkthrough, ask the LLM contextual questions, and resume seamlessly.
- [ ] **#125 Epic: Invisible Orchestration:** Audit AI model hooks and Git hooks to trigger `shield`, `sync`, and `handoff` automagically. Achieves a "run `init` and forget" workflow via deterministic shield gates and auto-installs.

## Phase 2: Core Stability & Data Safety (Functionally Complete)

**Goal:** Before ingesting enterprise databases, the local vector index and LLM prompts must be bulletproof across all environments.

This phase fortified the core architecture, delivering native orchestration, zero-LLM linting, and rigorous security measures.

- **AST & Orchestration:**
  - **AST Governance:** Universal Tree-sitter parsing and AST gating for zero-LLM linting. Shared execution logic unifies the underlying rule runner for both linting and AI shield gates (#566).
  - **Graceful Degradation:** Cross-provider LLM routing with SDK-to-CLI and Ollama fallbacks (#516, #517).
  - **Provider Coverage:** Supported Cloud Providers (Gemini, Anthropic, OpenAI) and Local Providers (Ollama).
- **Data Safety & Memory:**
  - **Transactions & Sync:** Saga-based document rollbacks, auto-healing DB version recovery (#500, #574), and automated sync with dual-read migrations (#428).
  - **Integrity & State:** Air-gapped zero-telemetry enforced (#474), alongside index health checks at startup (#438).
  - **Portability:** Zero-LLM session snapshots via `totem handoff --lite` and cross-model export support.
- **Security & DX:**
  - **Adversarial Hardening:** Adversarial ingestion scrubbing, extraction hardening, and suspicious lesson detection.
  - **Git Enforcements:** Native Git hook enforcement with monorepo and Bun support. Enhanced by shield severity levels (error vs warning) for strict gating (ADR-028, #498, #576).
  - **Installation Automation:** Auto-installation of `totem hooks` and CI drift gating foundations.

## Phase 3: Workflow Expansion (Power User Tools)

**Goal:** Give existing users more ways to interact with their data locally and visualize their usage.

- **Observability & Maintenance:**
  - **Metrics & Diagnostics:**
    - [x] **Semantic Rule Observability:** Separated zero-LLM `totem lint` from AI-powered `totem shield` to enable targeted rule enforcement (#521, #545).
    - [ ] **#92 CLI Metrics & Observability:** Provide local CLI metrics (`totem stats`) including basic CIS metric percentages (#425) and Trap Ledger integration (#544).
    - [ ] **#130 Epic: Database Observability:** Build `totem inspect` or a local UI to visualize vector chunks and track index health.
  - **System Maintenance:**
    - [ ] **#283 Epic: v1.0 Documentation:** Develop v1.0 docs and extensive wiki migrations covering dev environments and release processes (#450, #477).
    - [ ] **#23 Automated Memory Consolidation:** Command (`totem consolidate`) to clean up and merge old lessons.
- **Workflow & Execution:**
  - **Data & Backlog:**
    - [x] **#362 Strategic Backlog Audit:** Added `totem audit` for backlog auditing with a human approval gate.
    - [x] **Configurable Issue Sources:** Added support for multiple repositories during triage and extraction workflows (#514).
  - **Knowledge Integration:**
    - [x] **Context Injection:** Embedded relevant vector DB lessons into orchestrator commands using a recency sandwiching pattern (#511).
    - [x] **Knowledge Promotion:** Audited local AI memory and promoted contributor knowledge to version-controlled surfaces (#402).
    - [x] **Toolchain Exports:** Exported compiled lessons to GitHub Copilot instructions (#294).
  - **Task Orchestration:**
    - [ ] **#119 `totem run <workflow>`:** Introduce a custom AI task runner to execute user-defined markdown workflows via the orchestrator.
    - [ ] **#74 `totem oracle`:** Add a frictionless Q&A command to query LanceDB without strict personas.
    - [ ] **#392 `totem review`:** Implement full codebase review powered by repomix and vectordb lessons.
    - [ ] **#432 Dynamic CLI Imports:** Convert static imports to dynamic `await import()` in command files to optimize startup performance.
  - **Extraction & Authority:**
    - [ ] **#430 Document Authority Modes:** Implement generated vs. assisted authority modes to protect human-curated strategic decisions.
    - [ ] **#435 PR Lesson Extraction:** Auto-extract lessons from PR review comments using `totem extract --from-pr`. Extracted lessons are strictly validated via Zod before disk writes (#565).
- **Shift-Left & Advanced Intelligence:**
  - **Governance & Verification:**
    - [ ] **#195 / #196 Epic: Shift-Left AI Verification:** Define model compatibility and auditing strategy to systematically verify models.
    - [ ] **#314 Epic: Adaptive Agent Governance:** Establish the Codebase Immune System, incorporating AST compilation design.
    - [x] **#422 Rule Testing Harness:** Implemented a compiled rule testing harness to identify regex false-positives and drive AST requirements.
    - [ ] **#434 Adversarial Trap Corpus:** Develop synthetic violations to measure precision and recall of the deterministic engine.
  - **Rules & Standards:**
    - [x] **#387 SARIF Output:** Standardized output for CI/CD integration, enhanced with organizational trap ledgers and linting support (#418, #561).
    - [x] **External Rule Ingestion:** Built support to automatically ingest `.cursorrules` and `.mdc` files into compiled rules (#558).
    - **Rule Invariant Audit:** Categorized over 130 compiled rules by invariant, style, and security to establish strict baseline severity (#559, #577).
    - [ ] **#385 Rule Exports:** Export compiled rules to Semgrep YAML and ESLint configurations. Deferred until core governance (#314) is finalized.
    - [ ] **#433 Lesson Packs Prototype:** Mine OSS projects as a proof of concept for distributable rule sets.
  - **Data Architecture & Agents:**
    - [x] **#176 Agent-Optimized MCP:** Implemented MCP enforcement tools enabling active self-correction and heartbeat zombie harvesting (#417, #503).
    - [x] **#364 VectorDB Structure:** Defined multi-type schemas, delivered health checks, and integrated Gemini embeddings (#439, #539).
    - [ ] **#183 Cross-File Knowledge Graph (Blocked):** Implement symbol resolution to enable multi-file architectural reasoning.

## Phase 4: Enterprise Expansion

**Goal:** Scale Totem from individual developers to entire organizations by ingesting third-party data sources.

- **Enterprise Memory & Scaling:**
  - **Federated Architectures:**
    - [ ] **#123 Epic: Federated Memory:** Allow `totem.config.ts` to declare external/upstream LanceDB indexes (The Mother Brain Pattern).
    - [ ] **#175 Epic: Multiplayer Cache Syncing:** Phase 4 enterprise/team scaling capability (Post-1.0).
  - **Ingestion & Domains:**
    - [ ] **#79 Documentation Ingestion Pipeline:** Build Pull/Push models for Notion, Confluence, or internal wikis.
    - [x] **#286 Epic: Rust Core Extraction:** Evaluated `totem-core-rs` for enterprise-scale extraction performance.
    - [x] **Multi-Totem Domains:** Established multi-totem knowledge domains with an indexed strategy repository and consumer playground (#463).
- **Integration & DevEx:**
  - **Onboarding Journeys:**
    - [ ] **#124 Epic: Frictionless 10-Minute Init:** Build `totem onboard <issue>` to generate contextual Day 1 briefings tailored to a new developer's first ticket.
    - [x] **#128 Epic: Universal Lessons Baseline:** Delivered baseline "Universal Lessons" dataset and refined ignore patterns to ensure frictionless bootstrapping (#128, #419).
  - **Adapters & Guardrails:**
    - [ ] **#84 Issue Tracking Adapters:** Implement Jira and Linear adapters using the interface built in Phase 2.
    - [ ] **#42 Universal AI DevEx:** Evolve `totem init` to inject "Best Practices" guardrails like Anti-Refactor and Test Coverage triggers.
- **Governance & Licensing:**
  - **Policy & Licensing:**
    - [ ] **#34 Configurable Governance:** Let enterprise teams configure AI review loops (`auditLoopLimit`). Shield severity thresholds (error vs warning) are now established for granular control (#498, #576).
    - [ ] **#198 RFC: Open Core & Licensing:** Evaluate MIT vs. Fair Source licensing strategy (resolved to Apache 2.0).
    - [x] Chore: Relicense project from MIT to Apache 2.0.
  - **Security & Compliance:**
    - [x] **#267 / #268 Security Scanning:** Configured Dependabot and enabled GitHub CodeQL for Advanced Security.
    - [x] **#300 / #321 Governance & Security:** Migrate `.strategy` directory to a private submodule for secure collaboration and indexing (#363).
  - **Contributor Workflow:**
    - [x] Implement Changesets and npm publishing (#5, #46).
    - [x] **#258 / #266 Governance:** Implement Contributor License Agreement (CLA) automation and CONTRIBUTING.md.
