# Totem Roadmap

This document outlines the strategic phases for the Totem project, focusing on moving from a solid architectural foundation to frictionless user adoption, and eventually enterprise scale.

## Foundations (Functionally Complete)

The core embedded vector database, MCP server, and baseline CLI commands established the foundational architecture and validation workflows.

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
  - **Tool Automation:** Auto-configured AI tools with JetBrains Junie and Copilot support. Added configurable embedding detection defaulting to Gemini.
  - **CLI Experience:**
    - Delivered cross-platform installers and versioned reflex upgrade paths.
    - Provided premium CLI UI polish with onboarding dares and brief terminal outputs.
    - Added `--bare` scaffolding support for streamlined `totem init`.
- **Host Integration:**
  - **Seamless Hooks:** Agent hooks for Claude Code, Gemini, and Junie.
  - **Baseline Intelligence:** Universal Baseline delivered, shipping 60 battle-tested lessons automatically during `totem init` alongside harder vector database reflexes.
  - **Enforcement:** Involuntary enforcement strategy under research.
- [ ] **Interactive CLI Tutorial:** Build an animated, interactive CLI tutorial (`totem tutorial`). This allows users to pause the walkthrough, ask the AI contextual questions, and resume seamlessly.
- [ ] **Invisible Orchestration:** Audit AI model hooks and Git hooks to trigger `shield`, `sync`, and `handoff` automagically. Recent additions include invisible sync hooks, driving toward a "run init and forget" workflow via deterministic `totem lint` gates and auto-installs.

## Phase 2: Core Stability & Data Safety (Functionally Complete)

**Goal:** Before ingesting enterprise databases, the local vector index and LLM prompts must be bulletproof across all environments.

This phase fortified the core architecture, delivering native orchestration, zero-LLM linting, and rigorous security measures.

- **AST & Orchestration:**
  - **AST Governance:** Universal Tree-sitter parsing and AST gating for zero-LLM `totem lint`. Shared execution logic unifies the underlying rule runner, now advanced by the syntax-aware AST engine.
  - **Graceful Degradation:** Cross-provider LLM routing with SDK-to-CLI and Ollama fallbacks.
  - **Provider Coverage:**
    - Supported Cloud Providers including Gemini, Anthropic, and OpenAI.
    - Supported Local Providers via Ollama fallbacks.
- **Data Safety & Memory:**
  - **Transactions & Sync:**
    - Saga-based document rollbacks and auto-healing database version recovery.
    - Automated sync with dual-read migrations.
    - Filesystem concurrency locks to safely manage operations.
  - **Integrity & State:** Air-gapped zero-telemetry enforced, alongside index health checks at startup. Enhanced auto-healing with dimension mismatch detection via internal metadata.
  - **Portability:** Zero-LLM session snapshots via `totem handoff --lite`, cross-model export support, and a portability audit across Windows, macOS, and Linux.
- **Security & DX:**
  - **Data Loss Prevention:** Implemented DLP secret masking middleware to proactively strip secrets prior to embedding.
  - **Adversarial Hardening:**
    - Adversarial ingestion scrubbing and extraction hardening.
    - Suspicious lesson detection algorithms.
    - MCP taskkill injection prevention and capability caps.
  - **Git Enforcements:** Native Git hook enforcement prioritizing zero-LLM `totem lint` for fast validation, with monorepo and Bun support.
  - **Installation Automation:** Auto-installation of `totem hooks` and continuous integration drift gating foundations. Expanded drift gating with a cross-platform CI matrix ensuring stable tests across Ubuntu, Windows, and macOS.

## Phase 3: Workflow Expansion (Power User Tools)

**Goal:** Give existing users more ways to interact with their data locally and visualize their usage.

- **Observability & Maintenance:**
  - **Metrics & Diagnostics:**
    - [x] **Semantic Rule Observability:** Separated zero-LLM `totem lint` from AI-powered `totem shield` for targeted rule enforcement, and introduced `totem explain` for violation lookups. Integrated callback warnings and a unified error hierarchy with typed subclasses and recovery hints.
    - [ ] **CLI Metrics & Observability:** Reframed to local CLI metrics (`totem stats`) with terminal output only. Includes violation history, lesson coverage, and rule fire counts from local storage.
    - [ ] **Database Observability:** Build `totem inspect` or a local UI to visualize vector chunks and track index health.
  - **System Maintenance:**
    - [ ] **v1.0 Documentation:** Develop full documentation and extensive wiki migrations covering dev environments and release processes. Includes core tagline positioning and architecture limitations.
    - [ ] **Automated Memory Consolidation:** Command (`totem consolidate`) to clean up and merge old lessons.
    - [x] **Documentation Generation:** Stripped known-not-shipped issue references from documentation generation to prevent hallucinations and the persistence of stale references.
- **Workflow & Execution:**
  - **Data & Backlog:**
    - [x] **Strategic Backlog Audit:** Added `totem audit` for backlog auditing with a human approval gate.
    - [x] **Configurable Issue Sources:** Added support for multiple repositories during triage and extraction workflows.
  - **Knowledge Integration:**
    - [x] **Context Injection:** Embedded relevant vector database lessons into orchestrator commands using a recency sandwiching pattern.
    - [x] **Knowledge Promotion:** Audited local AI memory and promoted contributor knowledge to version-controlled surfaces.
    - [x] **Toolchain Exports:** Exported compiled lessons to code assistant instructions.
    - [x] **Local Sharing:** Introduced `totem link` to securely share compiled lessons across repositories. Enabled cross-totem queries via linked index configurations and added extensive CI testing.
  - **Task Orchestration:**
    - [x] **Automation & Skills:**
      - Restructured skills into a directory format and cleaned up stale commands.
      - Upgraded `totem spec` to a strict checklist format for preflight validation.
      - Refactored agent instructions to a lean root router pattern and expanded hooks with a capability manifest.
    - [ ] **totem run <workflow>:** Introduce a custom AI task runner to execute user-defined markdown workflows via the orchestrator.
    - [ ] **totem oracle:** Add a frictionless Q&A command to query the vector database without strict personas.
    - [ ] **totem review:** Implement full codebase review powered by external context mixers and vector database lessons.
    - [ ] **Dynamic CLI Imports:** Convert static framework imports to dynamic await calls in command files to optimize startup performance.
  - **Extraction & Authority:**
    - [ ] **Document Authority Modes:** Implement generated vs. assisted authority modes to protect human-curated strategic decisions.
    - [ ] **PR Lesson Extraction:** Auto-extract lessons from pull request review comments. Extracted lessons are strictly validated before disk writes.
- **Shift-Left & Advanced Intelligence:**
  - **Governance & Verification:**
    - [ ] **Shift-Left AI Verification:** Define model compatibility and auditing strategy to systematically verify models.
    - [ ] **Adaptive Agent Governance:** Establish a codebase immune system. Transitions compilation from regex-only to AST-aware rules for provably complex cases.
    - [x] **Rule Testing Harness:** Implemented a compiled rule testing harness to identify regex false-positives and drive AST requirements.
    - [ ] **Adversarial Trap Corpus:** Develop synthetic violations to measure precision and recall of the deterministic engine.
    - [x] **Quality Control:** Addressed joint code review conditions and deployed a Docker test harness for stability validation. Implemented phase-gate enforcement and integrated security hardening from codebase reviews.
  - **Rules & Standards:**
    - [x] **SARIF Output:** Standardized output for continuous integration, enhanced with organizational trap ledgers and linting support.
    - [x] **External Rule Ingestion:** Built support to automatically ingest external configurations and prompt templates into compiled rules during initialization.
    - **Rule Invariant Audit:**
      - Categorized rules by invariant, style, and security to establish strict baseline severity.
      - Refined to a curated 147-rule set and consolidated near-duplicate rules to reduce false positives.
      - Introduced "Complete or Broken" guardrails and added baseline fix guidance with mandatory verify steps.
    - [x] **Compilation Optimization:**
      - Implemented a compiler facade pattern and cached non-compilable lessons to optimize performance.
      - Refined glob boundaries and introduced a pre-compilation lesson file linter to ensure structural validity.
    - [x] **Core Rule Engine:** Integrated manual patterns and reverse-compiled curated rules into the primary execution pipeline. Streamlined compilation by extracting engine helper fields and enriched context with body-text backfills.
    - [ ] **Rule Exports:** Export compiled rules to standard linter configurations. Deferred until core governance is finalized.
    - [ ] **Lesson Packs Prototype:** Mine open-source projects as a proof of concept for distributable rule sets.
  - **Data Architecture & Agents:**
    - [x] **Agent-Optimized MCP:** Implemented enforcement tools enabling active self-correction and zombie process harvesting. Hardened with capability caps, pre-push enforcement, and boundary parameters for precise knowledge queries.
    - [x] **VectorDB Structure:** Defined multi-type schemas, delivered health checks, and integrated local embeddings. Advanced querying by introducing index partitions with alias resolution.
    - [ ] **Cross-File Knowledge Graph (Blocked):** Implement symbol resolution to enable multi-file architectural reasoning.

## Phase 4: Enterprise Expansion

**Goal:** Scale Totem from individual developers to entire organizations by ingesting third-party data sources.

- **Enterprise Memory & Scaling:**
  - **Ingestion & Domains:**
    - [ ] **Documentation Ingestion Pipeline:** Build Pull/Push models for enterprise wikis or internal knowledge bases.
    - [x] **Rust Core Extraction:** Evaluated high-performance core extraction for enterprise-scale operations.
    - [x] **Multi-Totem Domains:** Established multi-totem knowledge domains with an indexed strategy repository and consumer playground.
- **Integration & DevEx:**
  - **Onboarding Journeys:**
    - [ ] **Frictionless 10-Minute Init:** Build an onboarding command to generate contextual briefings tailored to a new developer's first ticket.
    - [x] **Universal Lessons Baseline:** Delivered baseline dataset and refined ignore patterns to ensure frictionless bootstrapping.
  - **Adapters & Guardrails:**
    - [ ] **Issue Tracking Adapters:** Implement project management adapters using the established internal interface.
    - [ ] **Universal AI DevEx:** Evolve initialization to inject best practices guardrails like anti-refactor and test coverage triggers.
- **Governance & Licensing:**
  - **Policy & Licensing:**
    - [ ] **Configurable Governance:** Let enterprise teams configure AI review loops. Shield severity thresholds are established for granular control.
    - [ ] **Open Core & Licensing:** Evaluate open source licensing strategies (resolved to Apache 2.0).
    - [x] **Relicensing:** Relicensed project from MIT to Apache 2.0.
  - **Security & Compliance:**
    - [x] **Security Scanning:** Configured automated dependency updates and enabled advanced security code scanning.
    - [x] **Governance & Security:** Migrate strategic documentation to a private submodule for secure collaboration and indexing.
  - **Contributor Workflow:**
    - [x] **Release Management:** Implement standardized changesets and package publishing.
    - [x] **Governance:** Implement Contributor License Agreement automation and contribution guidelines.
