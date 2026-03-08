### Active Work Summary

Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, establishing the Turborepo architecture, syntax-aware chunking (now powered by Tree-sitter #173), and local data stores. Recent momentum has delivered the Shield GitHub Action (#180), Drift Detection (#177, #211), Automated Doc Sync (#190), MVC Configuration Tiers (#187), a "Universal Lessons" baseline (#128), Cross-Platform Onboarding (#210), OpenAI Embedding validation (#4), and a deterministic lesson compiler with zero-LLM shield mode (#213). Focus is now on internal dogfooding (#8) and expanding the deterministic compiler before scaling Phase 3 workflow expansions.

### Prioritized Roadmap

**Do Next (Critical Path & Validation)**

- #8 — Validate dogfood sync with OpenAI embeddings — P1 dogfooding necessary to prove out the system's core value proposition and ingestion stability.

**Up Next (NASA-Grade Moat & Adoption)**

- #213 — Deterministic Compiler iteration — Expand regex-only MVP to cover more lesson patterns; evaluate ESLint AST selectors as a future engine.
- #129 — Epic: Interactive CLI Tutorial & Conversational Onboarding — Finish Phase 1 polish.

**Backlog (Phase 3 Workflow Expansion)**

- #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Sets the foundation for power-user capabilities.
- #176 — Epic: Agent-Optimized MCP (Dynamic Token Budgeting & Write Access) — Crucial for deepening agent-to-agent interactions.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — The next major architectural leap for codebase comprehension.

### Next Issue (User Story & Scope)

**#8 — Validate dogfood sync with OpenAI embeddings**

- **User Story:** As a developer using Totem in a real project (satur8d), I want to run `totem sync` + `search_knowledge` end-to-end with OpenAI embeddings to verify the full pipeline works reliably.
- **Scope:** Switch the satur8d consumer project from Ollama to OpenAI, run a clean sync, and validate search results. Document any UX friction.
- **Why Next:** #4 (OpenAI validation) is complete. Dogfooding in a real consumer project is the final prerequisite before Phase 3 expansion.

### Blocked / Needs Input

- #198 — RFC: Open Core & Defensive Licensing Strategy (MIT vs. Fair Source) — Requires strategic business and legal decisions before any actionable work can begin.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Needs architectural consensus on the symbol resolution strategy before technical implementation.
