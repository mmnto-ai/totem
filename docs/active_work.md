### Active Work Summary

The project is currently focused on "Phase 2: Core Stability & Data Safety," prioritizing the robustness of LLM prompts and the local vector index before expanding to enterprise data ingestion. Recent momentum centers on stabilizing CLI orchestration, refining background sync mechanisms, and ensuring secure context delivery to the AI.

### Prioritized Roadmap

**Do Next (Core Stability & Security)**

1. #122 — test: Backfill unit and integration tests for `@mmnto/totem` core database and chunking logic — Ensures core pipeline stability.
2. #121 — bug: LanceDB `deleteByFile` edge cases causing silent incremental sync failures.
3. #131 — feat: Clean Ejection Path (`totem eject`) — Safely remove git hooks and prompts.

**Up Next (Workflow & CLI Enhancements)** 4. #143 — feat(cli): add `totem wrap` command to chain post-merge workflow — Directly extends the orchestrator's workflow capabilities. 5. #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Core to the project's foundational vision of automated workflows. 6. #168 — UX: Interactive multi-select pruning for `totem learn` — Allows human-in-the-loop filtering of AI-extracted lessons.

**Backlog (Phase 3: Power User Tools & Observability)** 7. #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Key Phase 3 goal for workflow expansion. 8. #130 — Epic: Database Observability & Management (`totem inspect`) — Key Phase 3 goal to visualize index health and build trust.

### Next Issue (User Story & Scope)

**#143 — feat(cli): add `totem wrap` command to chain post-merge workflow**

- **User Story:** As a developer finishing a feature, I want a single command (`totem wrap`) that automatically triggers the `learn` extraction loop, syncs the database, and generates a `handoff` briefing, so I don't have to manually execute 3 distinct commands.
- **Scope Boundaries:** Create a new CLI command `packages/cli/src/commands/wrap.ts` that sequentially invokes the logic of `learn`, `sync`, and `handoff`. Do not rewrite the underlying logic of those commands; just compose them.
- **Why Next:** With `totem bridge` complete for mid-task context resets, `totem wrap` is the logical next step to provide a frictionless end-of-task experience.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) (P1, blocked)
- **#8** — Validate dogfood sync with OpenAI embeddings (P1, blocked)
