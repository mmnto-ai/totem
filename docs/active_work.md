### Active Work Summary

The project is currently focused on "Phase 2: Core Stability & Data Safety," prioritizing the robustness of LLM prompts and the local vector index before expanding to enterprise data ingestion. Recent momentum centers on stabilizing CLI orchestration, refining background sync mechanisms, and ensuring secure context delivery to the AI.

### Prioritized Roadmap

**Do Next (Core Stability & Security)**

1. #122 — test: Backfill unit and integration tests for `@mmnto/totem` core database and chunking logic — Ensures core pipeline stability.
2. #121 — bug: LanceDB `deleteByFile` edge cases causing silent incremental sync failures.
3. #131 — feat: Clean Ejection Path (`totem eject`) — Safely remove git hooks and prompts.

**Up Next (Workflow & CLI Enhancements)** 4. #143 — feat(cli): add `totem wrap` command to chain post-merge workflow — Directly extends the orchestrator's workflow capabilities. 5. #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Core to the project's foundational vision of automated workflows. 6. #44 — Feature: Add `totem bridge` command for mid-session context compaction — Addresses immediate workflow friction regarding token bloat.

**Backlog (Phase 3: Power User Tools & Observability)** 7. #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Key Phase 3 goal for workflow expansion. 8. #130 — Epic: Database Observability & Management (`totem inspect`) — Key Phase 3 goal to visualize index health and build trust.

### Next Issue (User Story & Scope)

**#122 — test: Backfill unit and integration tests for core database and chunking logic**

- **User Story:** As a maintainer, I need comprehensive tests around the LanceDB index and syntactic chunkers so I can safely iterate on Phase 2 core stability features without fear of regressions.
- **Scope Boundaries:** Implement unit tests for `TypeScriptChunker` and ensure it handles AST failures gracefully. Write an integration test for `LanceStore` that spins up a test `.lancedb/` directory, inserts chunks, performs vector searches, and verifies `deleteByFile`.
- **Why Next:** Without core test coverage, further optimizations to the ingestion pipeline (like fixing the `deleteByFile` bug) are too risky to merge.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) (P1, blocked)
- **#8** — Validate dogfood sync with OpenAI embeddings (P1, blocked)
