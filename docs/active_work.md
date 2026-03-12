### Active Work Summary

Current momentum is heavily focused on evolving Totem from a memory database into a full "Shift-Left orchestrator" utilizing an embedded LanceDB vector index. The `@mmnto/cli@0.29.0` release significantly advances this goal by injecting vector DB lessons across all orchestrator commands (including `totem spec` and the newly introduced `totem audit` command). Additional improvements include establishing versioned reflex upgrade paths for `totem init` and adding support for JetBrains Junie integration.

### Prioritized Roadmap

**Do Next (Tier-1 Core & Shift-Left Foundation)**

- #364 — research: vectordb structure for multi-type knowledge retrieval at scale — Critical data-model prerequisite for the LanceDB embedding architecture.
- #314 — Epic: The Codebase Immune System — Adaptive Agent Governance — Establishes the core product requirements for the Shift-Left orchestrator transition.
- #176 — Epic: Enforcement Sidecar MCP Tools — Directly equips AI agents with the tools to self-correct during active work.
- #124 — Epic: Frictionless 10-Minute Init (totem init) — Required to ensure the new orchestration features are rapidly adoptable by new developers.
- #128 — Epic: Ship "Universal Lessons" baseline during `totem init` — Pairs with #124 to provide immediate, out-of-the-box value.

**Up Next (Tier-1 UX & Telemetry)**

- #283 — Epic: v1.0 Documentation Site & README Minimization — Essential for the v1.0 launch and reducing cognitive load.
- #92 — Feature: Telemetry Logging and Local Dashboard (`totem stats`) — Needed to track local-first adoption and agent performance metrics.

**Backlog (Tier-2 / Tier-3 Integrations)**

- #387 — feat: SARIF output for deterministic shield — Highly relevant for standardizing Shift-Left CI/CD output.
- #385 — Export compiled rules to Semgrep YAML and ESLint configs — Excellent integration strategy, but deferred until the core agent governance (#314) is finalized.
- #392 — feat: `totem review` — full codebase review powered by repomix + vectordb lessons — High-value Phase 3 power-user tool.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Core requirement for Enterprise scaling (Phase 4).

### Next Issue (User Story & Scope)

**#364 — research: vectordb structure for multi-type knowledge retrieval at scale**

- **User Story:** As an AI orchestrator, I need a strictly defined schema within the local LanceDB index so that I can accurately filter and retrieve specific knowledge types (e.g., architectural invariants vs. general context) without context collision.
- **Scope Boundaries:** Deliver a written Architecture Decision Record (ADR) defining the LanceDB table structures, metadata schema, chunking strategy, and embedding dimensions required to support multi-type knowledge. **DO NOT** write database connection code, do not implement the LanceDB setup, and do not migrate any existing test data.
- **Why it should be next:** The roadmap mandates an embedded LanceDB vector index to power the Shift-Left orchestrator. Foundational Epics (#314, #176) and high-value workflow tools (#392) cannot be built until the underlying multi-type vector database structure is locked in.

### Blocked / Needs Input

- #383 — Auto-handoff on MCP session lifecycle events (Explicitly marked as `blocked`).
- #175 — Epic: Multiplayer Cache Syncing (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).
- #123 — Epic: Federated Memory (Mothership Pattern) (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).
