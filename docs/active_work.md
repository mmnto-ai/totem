### Active Work Summary

The project is currently focused on "Phase 2: Core Stability & Data Safety," prioritizing the robustness of LLM prompts and the local vector index before expanding to enterprise data ingestion. Recent momentum centers on stabilizing CLI orchestration, refining background sync mechanisms, and ensuring secure context delivery to the AI.

### Prioritized Roadmap

**Do Next (Core Stability & Security)**

1. #180 — Feature: Shield GitHub Action — (This is our #1 priority for workflow lock-in).
2. #121 — bug: LanceDB `deleteByFile` edge cases causing silent incremental sync failures — Data integrity prerequisite for trustworthy CI enforcement.
3. #122 — test: Backfill unit and integration tests for `@mmnto/totem` core database and chunking logic — Ensures core pipeline stability.

**Up Next (Workflow & CLI Enhancements)**

4. #168 — UX: Interactive multi-select pruning for `totem extract` — Allows human-in-the-loop filtering of AI-extracted lessons.
5. #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Core to the project's foundational vision of automated workflows.

**Backlog (Phase 3: Power User Tools & Observability)**

6. #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Key Phase 3 goal for workflow expansion.
7. #130 — Epic: Database Observability & Management (`totem inspect`) — Key Phase 3 goal to visualize index health and build trust.

### Next Issue (User Story & Scope)

**#180 — Feature: Shield GitHub Action**

- **User Story:** As an engineering lead, I want the `totem shield` command to run automatically in CI/CD against pull requests, so that any code changes that violate our local architectural constraints and lessons are automatically blocked from merging.
- **Scope Boundaries:** Create a standalone GitHub Action (`action.yml`) that can be used in any repository. The action should execute `totem shield` on the PR diff, and if a violation occurs, post a blocking comment on the PR indicating the specific lesson violated with a non-zero exit code.
- **Why Next:** This is our #1 priority for workflow lock-in. Ensuring that architectural constraints stored in local memory are strictly enforced at the PR level provides immediate, tangible value for teams adopting Totem.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) (P1, blocked)
- **#8** — Validate dogfood sync with OpenAI embeddings (P1, blocked)
