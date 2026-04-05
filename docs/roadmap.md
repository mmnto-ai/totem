# Totem Roadmap

This document outlines the strategic milestones for the Totem project.

Totem is a standard library for codebase governance — deterministic primitives that let teams enforce architectural boundaries on AI agents without opinionated workflows. The roadmap below tracks the active progression of enforcement primitives, platform validation, and rule distribution.

---

## 1.12.0 — The Umpire & The Router (Active)

**Theme:** Internal quality, research validation, and platform hardening.

- **Engine & Stability:**
  - [x] **Lite-Tier Binary:** Standalone binary with WASM AST-grep engine requiring no native dependencies.
  - [x] **AST-Grep Integration:** Applied AST-grep engine to restricted property rules.
  - [x] **Windows CI Fix:** Resolved timeout constraints for orchestrator execution on Windows environments.
  - [ ] **Adversarial Trap Corpus:** Evaluation suite to test the deterministic engine against evasion techniques.
- **Models & Routing:**
  - [x] **Local Model Support:** Auto-detect Ollama environments with default routing to Gemma 4 models.
  - [ ] **Classification Evaluation:** Evaluate Gemma 4 variants for the internal classification task.
  - [ ] **Model Routing Matrix:** Matrix for delegating tasks to appropriate models based on capability.
  - [ ] **Prompt Adapters:** Model-specific prompt tuning to improve rule extraction across different LLM backends.
- **Validation:**
  - [ ] **Governance Evaluation Harness:** Tooling to evaluate rule enforcement and agent compliance.

---

## 1.13.0 — The Refinement Engine (Next)

**Theme:** Rule refinement and pack distribution.

- **Refinement:**
  - [ ] **False-Positive Tuning:** Refine active rules based on false-positive scan alerts.
  - [ ] **AST Upgrades:** Auto-detect string-content matches eligible for AST patterns.
  - [ ] **Empty Catch Tracking:** Identify and flag empty catch blocks using AST patterns.
- **Distribution:**
  - [ ] **Pack System:** Standardized bundles for reusable rule distribution.
  - [ ] **Rule Sharing:** Broaden the mechanisms for distributing compiled rules across teams.
- **Extraction:**
  - [ ] **Security Alerts:** Extract rules directly from GitHub Advanced Security alerts.
  - [ ] **Lint Warnings:** Convert standard repository lint warnings into actionable lessons.

---

## Shipped Milestones

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
