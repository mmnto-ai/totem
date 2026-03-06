### Active Work Summary

The project is currently focused on "Phase 2: Core Stability & Data Safety," prioritizing the robustness of LLM prompts and the local vector index before expanding to enterprise data ingestion. Recent momentum centers on stabilizing CLI orchestration, refining background sync mechanisms, and ensuring secure context delivery to the AI.

### Prioritized Roadmap

**Do Next (Core Stability & Security)**

1. #149 — security: XML-delimit MCP tool responses to mitigate indirect prompt injection — Critical immediate fix to ensure prompt data safety and prevent poisoning.
2. #148 — feat: add Zod schema validation for Claude settings.local.json — Vital for configuration stability and predictable agent behavior.
3. #147 — chore: extract inline shell hooks into dedicated Node.js scripts — Cleans up the `totem init` injection path and improves cross-platform reliability.
4. #127 — feat: Add heading hierarchy breadcrumbs to MarkdownChunker labels — Enhances vector index chunking quality and retrieval context.

**Up Next (Workflow & CLI Enhancements)** 5. #107 — UX: Emit background sync logs via MCP progress events — Improves observability and user trust during black-box sync operations. 6. #143 — feat(cli): add `totem wrap` command to chain post-merge workflow — Directly extends the orchestrator's workflow capabilities. 7. #126 — Epic: Invisible Orchestration & Auto-Triggering (The 'Init and Forget' Protocol) — Core to the project's foundational vision of automated workflows. 8. #44 — Feature: Add `totem bridge` command for mid-session context compaction — Addresses immediate workflow friction regarding token bloat.

**Backlog (Phase 3: Power User Tools & Observability)** 9. #119 — Epic: Custom Workflow Runner (`totem run <workflow>`) — Key Phase 3 goal for workflow expansion. 10. #130 — Epic: Database Observability & Management (`totem inspect`) — Key Phase 3 goal to visualize index health and build trust.

### Next Issue (User Story & Scope)

**#149 — security: XML-delimit MCP tool responses to mitigate indirect prompt injection**

- **User Story:** As an AI agent utilizing Totem, I need external knowledge returned by MCP tools to be strictly XML-delimited so that my prompt context remains secure against indirect injection attacks from untrusted repository data.
- **Scope Boundaries:** Update the MCP server response formatters (e.g., in `search-knowledge.ts`) to wrap all text outputs in standardized XML tags. **Do not** refactor the underlying LanceDB retrieval logic. **Do not** change how the chunks are originally generated. Focus solely on the final string formatting before it hits the LLM.
- **Why Next:** It directly fulfills the Phase 2 mandate for "Data Safety." If the LLM context isn't secure from the data it retrieves, the entire ingestion pipeline is a liability.

### Blocked / Needs Input

- **#4** — Validate OpenAI Embedding Provider (Happy Path) (P1, blocked)
- **#8** — Validate dogfood sync with OpenAI embeddings (P1, blocked)
