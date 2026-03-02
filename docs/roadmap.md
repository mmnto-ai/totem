# Totem Roadmap

This document outlines the high-level goals and strategic pillars for the Totem project.

## Pillar 1: The Memory Layer (Phase 1 & 2)

**Status:** Mostly Complete
**Goal:** Provide a persistent memory and context layer for AI agents via an embedded vector database (LanceDB).

- [x] Turborepo scaffolding (core, cli, mcp)
- [x] Syntax-aware chunkers (TypeScript AST, Markdown headings, Session logs)
- [x] Embedders (OpenAI & Ollama fallback)
- [x] LanceDB store and incremental `totem sync`
- [x] MCP Server with `search_knowledge` and `add_lesson`
- [ ] Validate OpenAI Happy Path (Issue #4 / #8)
- [ ] Cross-platform onboarding for Windows/macOS (Issue #12)

## Pillar 2: The Reflex Engine (Phase 3)

**Status:** Completed (Epic #19)
**Goal:** Ensure the memory layer is actively used. Automate the configuration of AI agents to autonomously query and write to Totem.

- [x] **Auto-Injection:** `totem init` injects memory reflexes into `CLAUDE.md`, `.cursorrules`, and `.gemini/`. (Issue #10)
- [x] **Hooks:** Background incremental sync via `post-merge` hook so the local index never goes stale. (Issue #11)
- [x] **Close the Loop:** Auto-trigger incremental sync via the `add_lesson` MCP tool to close the within-session gap. (Issue #22)
- [x] **Proactive Triggers:** Update injected AI reflexes to enforce proactive anchoring rather than reactive learning. (Issue #24)

## Pillar 3: The Workflow Orchestrator (Phase 4)

**Status:** Active Focus (Epic #20)
**Goal:** Serve as the "Org Chart" for a developer's multi-agent AI team, standardizing shift-left workflows.

- [x] **Native CLI Commands:** Ported the bespoke `satur8d` scripts into native `@mmnto/cli` commands (`totem spec`, `totem shield`, `totem triage`, `totem briefing`, `totem handoff`). (Epic #17)
- [ ] **Configurable Governance:** Add `auditLoopLimit` and `shieldSeverityThreshold` to `totem.config.ts` to control AI review depth. (Issue #34)
- [ ] **Roles & Handoffs:** Allow users to map installed tools (Claude CLI, Gemini CLI, Ollama) to roles (Builder, Reviewer) in `totem.config.ts`.
- [ ] **PR Learning Loop:** Build `totem learn <pr-url>` to parse GitHub PR review comments and auto-extract architectural lessons into `.totem/lessons.md`. (Issue #18)

## Pillar 4: Friction Elimination & Polish (Phase 5)
**Status:** Future

- [ ] Implement Changesets and npm publishing (Issue #5)
- [ ] Implement Memory Consolidation command (`totem consolidate`) to clean up old lessons. (Issue #23)
- [ ] CLI UI/UX Polish: Interactive prompts, colors, and the hidden Oregon Trail Easter Egg. (Issue #21)
- [ ] Implement `reset()` and ephemeral memory for the MCP tool
- [ ] Support implicit context via `totem integrate claude` to single-click install the MCP config
