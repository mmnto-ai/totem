### Active Work Summary

The project is currently focused on "Phase 2: Core Stability & Data Safety," prioritizing the robustness of LLM prompts and the local vector index before expanding to enterprise data ingestion. Recent momentum centers on stabilizing CLI orchestration, refining background sync mechanisms, and ensuring secure context delivery to the AI.

### Prioritized Roadmap

**Do Next (Core Stability & Security)**

1. #127 — feat: Add heading hierarchy breadcrumbs to MarkdownChunker labels — Enhances vector index chunking quality and retrieval context.
2. #160 — feat: Defensive Context Management Reflexes (Auto-Warnings) — Promotes safety by warning the AI about approaching context limits and proposing `totem bridge`.
3. #122 — test: Backfill unit and integration tests for `@mmnto/totem` core database and chunking logic — Ensures core pipeline stability.
4. #121 — bug: LanceDB `deleteByFile` edge cases causing silent incremental sync failures.

**Up Next (Workflow & CLI Enhancements)** 5. #107 — UX: Emit background sync logs via MCP progress events — Improves observability and user trust during black-box sync operations. 6. #143 — feat(cli): add `totem wrap` command to chain post-merge workflow — Directly extends the orchestrator's workflow capabilities. 7. #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Core to the project's foundational vision of automated workflows. 8. #44 — Feature: Add `totem bridge` command for mid-session context compaction — Addresses immediate workflow friction regarding token bloat.

**Backlog (Phase 3: Power User Tools & Observability)** 9. #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Key Phase 3 goal for workflow expansion. 10. #130 — Epic: Database Observability & Management (`totem inspect`) — Key Phase 3 goal to visualize index health and build trust.

### Next Issue (User Story & Scope)

**#127 — feat: Add heading hierarchy breadcrumbs to MarkdownChunker labels**

- **User Story:** As an AI querying the vector index, I need markdown chunks to include their full heading hierarchy (e.g., `[Session 142 > Traps > Next.js]`) in the `contextPrefix` so I don't lose the structural context of isolated paragraphs.
- **Scope Boundaries:** Update `MarkdownChunker` and `SessionLogChunker` to track heading depth during AST traversal and prepend the breadcrumb trail to the chunk's label/prefix. Do not modify the underlying `remark` parsing or Zod schemas.
- **Why Next:** Without structural breadcrumbs, retrieved markdown paragraphs often lack enough context for the AI to understand _what_ the paragraph is describing, reducing the quality of `totem spec` and `totem shield` outputs.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) (P1, blocked)
- **#8** — Validate dogfood sync with OpenAI embeddings (P1, blocked)
