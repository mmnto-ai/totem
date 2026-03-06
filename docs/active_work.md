### Active Work Summary

The project is currently focused on "Phase 2: Core Stability & Data Safety," prioritizing the robustness of LLM prompts and the local vector index before expanding to enterprise data ingestion. Recent momentum centers on stabilizing CLI orchestration, refining background sync mechanisms, and ensuring secure context delivery to the AI.

### Prioritized Roadmap

**Do Next (Core Stability & Security)**

1. #158 — chore: unify XML escaping utilities (`formatXmlResponse` + `wrapXml`) — Follow up to PR #157 to ensure consistent XML generation across CLI and MCP.
2. #156 — bug: incremental sync does not remove deleted files from LanceDB — Core fix to prevent ghost context from polluting orchestrator memory.
3. #155 — bug: incremental sync misses changes due to stateless HEAD~1 diff — Core fix to ensure robust state tracking via `.totem/cache/sync-state.json`.
4. #127 — feat: Add heading hierarchy breadcrumbs to MarkdownChunker labels — Enhances vector index chunking quality and retrieval context.

**Up Next (Workflow & CLI Enhancements)** 5. #107 — UX: Emit background sync logs via MCP progress events — Improves observability and user trust during black-box sync operations. 6. #143 — feat(cli): add `totem wrap` command to chain post-merge workflow — Directly extends the orchestrator's workflow capabilities. 7. #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Core to the project's foundational vision of automated workflows. 8. #44 — Feature: Add `totem bridge` command for mid-session context compaction — Addresses immediate workflow friction regarding token bloat.

**Backlog (Phase 3: Power User Tools & Observability)** 9. #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Key Phase 3 goal for workflow expansion. 10. #130 — Epic: Database Observability & Management (`totem inspect`) — Key Phase 3 goal to visualize index health and build trust.

### Next Issue (User Story & Scope)

**#158 — chore: unify XML escaping utilities (formatXmlResponse + wrapXml)**

- **User Story:** As a maintainer, I need the XML escaping logic to be unified across the MCP server and CLI orchestrator so that indirect prompt injection mitigations are consistently applied and tested in one place.
- **Scope Boundaries:** Move `formatXmlResponse` and `wrapXml` into a shared utility file (e.g., in `@mmnto/core` or a shared utils package). Settle on a single escaping strategy (backslash vs HTML entities) based on the LLM's parsing preference, update all references, and migrate the tests. **Do not** change how the external context itself is fetched or parsed.
- **Why Next:** This is a direct, small follow-up to PR #157 that ensures our new security posture is maintainable and consistent across the monorepo.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) (P1, blocked)
- **#8** — Validate dogfood sync with OpenAI embeddings (P1, blocked)
