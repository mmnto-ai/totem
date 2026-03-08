### Active Work Summary

Foundations, Phase 1 (Onboarding), and Phase 2 (Core Stability) are functionally complete, establishing the Turborepo architecture, syntax-aware chunking, and local data stores. Recent momentum has shifted toward validating the core embedding pipeline (OpenAI) to enable internal dogfooding and wrapping up remaining interactive onboarding tasks before moving into Phase 3 workflow expansions.

### Prioritized Roadmap

**Do Next (Critical Path & Validation)**

- #4 — Validate OpenAI Embedding Provider (Happy Path) — P1 validation required to ensure core embedding functionality is actually working for end users.
- #8 — Validate dogfood sync with OpenAI embeddings — P1 dogfooding necessary to prove out the system's core value proposition and ingestion stability.

**Up Next (Adoption & Polish)**

- #129 — Epic: Interactive CLI Tutorial & Conversational Onboarding — Specifically flagged in the active work roadmap to finish Phase 1 polish.
- #12 — Cross-platform onboarding: support Windows (PowerShell) & macOS in all docs — Removes immediate setup friction for new users.

**Backlog (Phase 3 Workflow Expansion)**

- #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Sets the foundation for power-user capabilities.
- #176 — Epic: Agent-Optimized MCP (Dynamic Token Budgeting & Write Access) — Crucial for deepening agent-to-agent interactions.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — The next major architectural leap for codebase comprehension.

### Next Issue (User Story & Scope)

**#4 — Validate OpenAI Embedding Provider (Happy Path)**

- **User Story:** As an end user, I want the default OpenAI embedding provider to work flawlessly upon initial setup so that my codebase is successfully ingested and searchable without silent failures.
- **Scope:** Strictly test and fix the happy-path execution of the existing `openai-embedder.ts`. Ensure environment variables are read correctly, payload requests succeed, and vectors are returned properly to the chunker. DO NOT add support for new models, DO NOT refactor the LanceDB storage layer, and DO NOT build advanced retry mechanisms yet.
- **Why Next:** Core embedding stability is a prerequisite for all advanced features and internal dogfooding. We cannot proceed to Phase 3 if the foundational pipeline is unverified.

### Blocked / Needs Input

- #198 — RFC: Open Core & Defensive Licensing Strategy (MIT vs. Fair Source) — Requires strategic business and legal decisions before any actionable work can begin.
- #183 — RFC: Cross-File Knowledge Graph (Symbol Resolution) — Needs architectural consensus on the symbol resolution strategy before technical implementation.
