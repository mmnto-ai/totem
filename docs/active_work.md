### Active Work Summary

Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, establishing the Turborepo architecture, syntax-aware chunking (now powered by Tree-sitter #173), and local data stores. Recent momentum has delivered the Shield GitHub Action (#180), Drift Detection (#177, #211), Automated Doc Sync (#190), MVC Configuration Tiers (#187), a "Universal Lessons" baseline (#128), Cross-Platform Onboarding (#210), OpenAI Embedding validation (#4), a deterministic lesson compiler with zero-LLM shield mode (#213, #216) backed by regex ReDoS protection (#218), integrated into CI workflows (#222, #226), and expanded with inline suppression directives and false-positive resolution (#251, #255), XML sentinels for automated doc sync (#228), native API orchestrators (#229) for Gemini and Anthropic with BYOSD optional peer dependencies and package manager auto-detection (#236), cross-provider routing in orchestrator overrides with negated glob support (#243, #246), individual document targeting with hallucination and stability fixes for the `totem docs` pipeline (#206, #224, #238, #241, #249, #250), centralized orchestrator resolution logic (#248), fixes for truncated lesson extraction headings (#253), provider conformance suites and nightly smoke tests (#244, #245, #263), selective lesson acceptance (#265), cross-model lesson export targets (#264, #269), structural context-blind reviews (#270), multi-agent code review analysis (#247), repository hygiene including CLA automation and Dependabot configuration (#258, #266, #267, #272), concise lesson headings and GCA on-demand reviews (#271, #278, #282), the CI drift gate and adversarial evaluation harness (#214, #280), Tree-sitter AST gating for deterministic shield (#287), generic OpenAI-compatible orchestration for Ollama/local support (#285, #293) expanded by a native Ollama orchestrator with dynamic `num_ctx` (#298, #306), handoff `--lite` mode with path containment and ANSI sanitization (#281, #284, #288, #292), extract prompt hardening against prompt injection (#279, #289, #295), GitHub Copilot lesson exports (#294), suspicious lesson detection with `--yes` mode blocking and false-positive reduction (#290, #291, #299, #302), secure collaboration via `.strategy` private submodule migration (#300), `shield --learn` for optional lesson extraction from LLM verdicts (#303, #307), alongside git hook enforcement with deterministic shield gating and memory classification (#310, #318), and strengthened safety rules and explicit consent in GEMINI.md (#309, #311). Additionally, the project has been relicensed to Apache 2.0. Internal dogfooding (#8) is validated. With orchestrator stabilization achieved, focus is now on Phase 3 workflow expansions and shift-left CI integration.

### Prioritized Roadmap

**Do Next (Shift-Left & CI Integration)**

- #195 — Epic: Model Compatibility & Auditing Strategy — Directly aligns with the shift toward orchestration by defining how models are audited for compatibility.

**Backlog (Exploratory, Epics, & Phase 4)**

- #176 — Epic: Agent-Optimized MCP (Dynamic Token Budgeting & Write Access) — Future foundation for power-user workflows.
- #175 — Epic: Multiplayer Cache Syncing — Phase 4 enterprise/team scaling capability.
- #123 — Epic: Federated Memory (Mothership Pattern) — Phase 4 architecture.

### Next Issue (User Story & Scope)

**#195 — Epic: Model Compatibility & Auditing Strategy**

- **User Story:** As a maintainer, I want a defined model compatibility and auditing strategy so that we can systematically verify how different models are supported and audited following the shift to centralized orchestration.
- **Scope:** Define how models are audited for compatibility, providing the strategic foundation to support the newly implemented adversarial evaluation harness in CI.
- **Why Next:** With orchestrator providers stabilized through the conformance suite and nightly smoke tests (#244, #245), the foundation is ready to formalize the model compatibility strategy as we move toward shift-left CI integrations.

### Blocked / Needs Input

- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Blocked pending technical design approval and validation of the architectural approach.
