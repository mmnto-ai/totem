### Active Work Summary

Current momentum is focused on implementing the Data Layer Foundation defined in ADR-024 (see the strategy ADR directory). The ADR was accepted on 2026-03-13 after a joint Claude/Gemini research session that included LanceDB FTS capability research, a full blast radius audit of the lessons migration, and embedding provider evaluation planning. The work is split into two PRs to manage risk: PR 1 ships additive features (FTS hybrid search, Gemini embedding provider, retrieval eval), while PR 2 isolates the high-touch lessons directory migration.

### Prioritized Roadmap

**In Progress (Tier-1 — ADR-024 Data Layer Foundation)**

- #378 — Hybrid search: FTS + vector in LanceDB — Add BM25 full-text search alongside vector search using RRF reranking. Includes filter-first tiered retrieval (lessons prioritized over code). **PR 1.**
- #380 — Gemini Embedding 2 provider with task-type awareness — Third embedding provider enabling single-key DX (`GEMINI_API_KEY` for both orchestrator + embeddings). Includes retrieval quality eval script. **PR 1.**
- #428 — Lessons directory migration (dual-read/single-write) — Migrate from single lessons file to per-lesson directory. 12+ source files, 11+ test files affected. **PR 2, blocked by PR 1.**

**Do Next (Tier-1 Core & Shift-Left Foundation)**

- #314 — Epic: The Codebase Immune System — Adaptive Agent Governance — Establishes the core product requirements for the Shift-Left orchestrator transition.
- #176 — Epic: Enforcement Sidecar MCP Tools — Directly equips AI agents with the tools to self-correct during active work.
- #124 — Epic: Frictionless 10-Minute Init (totem init) — Required to ensure the new orchestration features are rapidly adoptable by new developers.
- #128 — Epic: Ship "Universal Lessons" baseline during `totem init` — Pairs with #124 to provide immediate, out-of-the-box value.

**Up Next (Tier-1 UX & Telemetry)**

- #283 — Epic: v1.0 Documentation Site & README Minimization — Essential for the v1.0 launch and reducing cognitive load.
- #92 — Feature: Telemetry Logging and Local Dashboard (`totem stats`) — Needed to track local-first adoption and agent performance metrics. Should be instrumented after the data layer is stable, not before.

**Backlog (Tier-2 / Tier-3 Integrations)**

- #387 — feat: SARIF output for deterministic shield — Highly relevant for standardizing Shift-Left CI/CD output.
- #385 — Export compiled rules to Semgrep YAML and ESLint configs — Excellent integration strategy, but deferred until the core agent governance (#314) is finalized.
- #392 — feat: `totem review` — full codebase review powered by repomix + vectordb lessons — High-value Phase 3 power-user tool.
- #79 — Epic: Documentation Ingestion Pipeline & Adapters — Core requirement for Enterprise scaling (Phase 4).

### Next Issue (User Story & Scope)

**#378 + #380 — Data Layer Foundation (PR 1)**

- **User Story:** As a Totem user, I need hybrid search (FTS + vector) so that exact keyword matches aren't missed by semantic-only search, and I need a Gemini embedding provider so I can run the full Totem stack with a single API key.
- **Scope Boundaries:** Implement FTS index creation in `LanceStore`, add hybrid search with RRF reranking, implement `GeminiEmbedder` with optional `@google/genai` peer dep in `packages/core`, build retrieval eval script comparing OpenAI vs Gemini on Totem's own corpus (10-15 queries). **No breaking changes for consumers.**
- **Key decisions (ADR-024):** Filter-first tiered retrieval (query lessons first, fall back to broader search). RRF as default reranker. FTS index dropped and recreated after incremental sync (accepted temporary perf hit). Dimension flexibility via config-driven rebuild.
- **Closes:** #378, #380

### Completed (This Cycle)

- #364 — research: vectordb structure for multi-type knowledge retrieval at scale — **Closed.** Delivered as ADR-024 (accepted 2026-03-13).
- #379 — Add `lesson` as a ContentType for precise filtering — **Closed.** Already implemented in codebase.

### Blocked / Needs Input

- #383 — Auto-handoff on MCP session lifecycle events (Explicitly marked as `blocked`).
- #175 — Epic: Multiplayer Cache Syncing (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).
- #123 — Epic: Federated Memory (Mothership Pattern) (Explicitly marked as `post-1.0`; do not engage until v1.0 ships).
