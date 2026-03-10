### Active Work Summary

Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, establishing the Turborepo architecture, syntax-aware chunking (now powered by Tree-sitter #173), and local data stores. Recent momentum has delivered the Shield GitHub Action (#180), Drift Detection (#177, #211), Automated Doc Sync (#190), MVC Configuration Tiers (#187), a "Universal Lessons" baseline (#128), Cross-Platform Onboarding (#210), OpenAI Embedding validation (#4), a deterministic lesson compiler with zero-LLM shield mode (#213, #216) backed by regex ReDoS protection (#218), integrated into CI workflows (#222, #226), and expanded with inline suppression directives and false-positive resolution (#251, #255), XML sentinels for automated doc sync (#228), native API orchestrators (#229) for Gemini and Anthropic with BYOSD optional peer dependencies and package manager auto-detection (#236), cross-provider routing in orchestrator overrides with negated glob support (#243, #246), individual document targeting with hallucination and stability fixes for the `totem docs` pipeline (#206, #224, #238, #241, #249, #250), centralized orchestrator resolution logic (#248), and fixes for truncated lesson extraction headings (#253). Additionally, the project has been relicensed to Apache 2.0. Internal dogfooding (#8) is validated. Focus is now on orchestrator stabilization and Phase 3 workflow expansions.

### Prioritized Roadmap

**Do Next (Orchestrator Stabilization)**

- #244 — test: Provider Conformance Suite for orchestrator implementations — Essential validation gate to ensure all new and existing models behave consistently before expanding features.
- #245 — test: Nightly integration smoke tests for orchestrator providers — Automates the conformance suite against live APIs to catch upstream provider drift immediately.

**Up Next (Shift-Left & CI Integration)**

- #195 — Epic: Model Compatibility & Auditing Strategy — Directly aligns with the shift toward orchestration by defining how models are audited for compatibility.
- #196 — Build Adversarial Evaluation Harness for CI (Model Drift Mitigation) — Establishes the CI drift gate, pushing AI verification shift-left.
- #214 — Feature: CI Drift Gate (Structural Integrity Check) — Provides the infrastructure to run the adversarial harness in standard CI pipelines.
- #247 — Analysis: Multi-Agent Code Review & The Three-Lens Model — Research necessary to define the next generation of automated PR review workflows.

**Backlog (Exploratory, Epics, & Phase 4)**

- #176 — Epic: Agent-Optimized MCP (Dynamic Token Budgeting & Write Access) — Future foundation for power-user workflows.
- #175 — Epic: Multiplayer Cache Syncing — Phase 4 enterprise/team scaling capability.
- #123 — Epic: Federated Memory (Mothership Pattern) — Phase 4 architecture.

### Next Issue (User Story & Scope)

**#244 — test: Provider Conformance Suite for orchestrator implementations**

- **User Story:** As a maintainer, I want a standard conformance test suite for all API orchestrators so that we can verify consistent behavior across different LLM providers (Anthropic, Gemini, etc.) and prevent regressions when updating models.
- **Scope:** Build a shared testing suite that validates the core orchestrator interface (request formatting, XML parsing, error handling) using mocked responses. Apply it to the current Anthropic and Gemini orchestrators.
- **Why Next:** With orchestrator resolution successfully centralized (#248), we must ensure existing models behave consistently before introducing nightly smoke tests (#245) or new providers.

### Blocked / Needs Input

- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Blocked pending technical design approval and validation of the architectural approach.
- #182 — RFC: Tree-sitter Multi-Language Support — Blocked pending consensus on scope and prioritization versus current orchestrator work.
