### Active Work Summary

Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are complete. The project has been relicensed to Apache 2.0 and is validated through internal dogfooding (#8). See `CHANGELOG.md` for the full Phase 2 delivery list.

**Key capabilities shipped in Phase 2:**

- **AST & Chunking:** Tree-sitter universal parsing, deterministic lesson compiler, zero-LLM shield with AST gating
- **Orchestration:** Native providers (Gemini, Anthropic, OpenAI, Ollama) with BYOSD, cross-provider routing, conformance suites
- **Doc Sync & Memory:** Automated doc sync with XML sentinels, drift detection, cross-model lesson export (including Copilot)
- **Shield & CI:** Shield GitHub Action, inline suppression, structural review, `--learn` mode, CI drift gate
- **Security:** Adversarial ingestion scrubbing, extract prompt hardening, suspicious lesson detection, ANSI sanitization
- **DX & Hooks:** Git hook enforcement, `totem hooks` command with monorepo support, Bun support, CI guard

Focus is now on **Phase 3 (Workflow Expansion)** and shift-left CI integration.

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
