### Active Work Summary

Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, establishing the Turborepo architecture, syntax-aware chunking (now powered by Tree-sitter #173), and local data stores. Recent momentum has delivered the Shield GitHub Action (#180), Drift Detection (#177, #211), Automated Doc Sync (#190), MVC Configuration Tiers (#187), a "Universal Lessons" baseline (#128), Cross-Platform Onboarding (#210), OpenAI Embedding validation (#4), a deterministic lesson compiler with zero-LLM shield mode (#213, #216) backed by regex ReDoS protection (#218), integrated into CI workflows (#222, #226), and expanded with inline suppression directives and false-positive resolution (#251, #255), XML sentinels for automated doc sync (#228), native API orchestrators (#229) for Gemini and Anthropic with BYOSD optional peer dependencies and package manager auto-detection (#236), cross-provider routing in orchestrator overrides with negated glob support (#243, #246), and individual document targeting with hallucination and stability fixes for the `totem docs` pipeline (#206, #224, #238, #241, #249, #250). Internal dogfooding (#8) is validated. Focus is now on orchestrator stabilization and Phase 3 workflow expansions.

### Prioritized Roadmap

**Do Next (Orchestrator Stabilization)**

- #248 — refactor: extract `resolveOrchestrator()` helper to deduplicate model resolution — Critical technical debt that must be cleared to support stable expansion of provider testing.
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
- #198 — RFC: Open Core & Defensive Licensing Strategy — Awaiting strategic business consensus.

### Next Issue (User Story & Scope)

**#248 — refactor: extract `resolveOrchestrator()` helper to deduplicate model resolution**

- **User Story:** As a maintainer, I want a single, centralized helper to resolve orchestrator configurations so that adding new models or changing fallback logic is done in exactly one place, reducing bugs and maintenance overhead.
- **Scope:** Extract existing model/orchestrator resolution logic into a single shared helper function. Update all current callers. Do NOT add new model providers or change the existing configuration schema.
- **Why Next:** Before building out the Provider Conformance Suite (#244) or the Nightly Integration Tests (#245), the core orchestration resolution logic must be centralized.

### Blocked / Needs Input

- #198 — RFC: Open Core & Defensive Licensing Strategy (MIT vs. Fair Source) — Blocked pending executive/strategic decision on business model and license choice.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Blocked pending technical design approval and validation of the architectural approach.
- #182 — RFC: Tree-sitter Multi-Language Support — Blocked pending consensus on scope and prioritization versus current orchestrator work.
