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

**Status:** Active Focus (Epic #19)
**Goal:** Ensure the memory layer is actively used. Automate the configuration of AI agents to autonomously query and write to Totem.

- [ ] **Auto-Injection:** `totem init` injects memory reflexes into `CLAUDE.md`, `.cursorrules`, and `.gemini/`. (Issues #9, #10)
- [ ] **Hooks:** Background incremental sync via `post-merge` hook so the local index never goes stale. (Issue #11)
- [ ] **Operational Playbooks:** Define mechanisms for surfacing operational rules (e.g. "always use MCP tools") dynamically when needed.

## Pillar 3: The Workflow Orchestrator (Phase 4)

**Status:** Planning (Epic #20)
**Goal:** Serve as the "Org Chart" for a developer's multi-agent AI team, standardizing shift-left workflows.

- [ ] **Native CLI Commands:** Port the bespoke `satur8d` scripts into native `@mmnto/cli` commands (`totem spec`, `totem triage`, `totem shield`).
- [ ] **Roles & Handoffs:** Allow users to map installed tools (Claude CLI, Gemini CLI, Ollama) to roles (Builder, Reviewer) in `totem.config.ts`.
- [ ] **PR Learning Loop:** Build `totem learn <pr-url>` to parse GitHub PR review comments and auto-extract architectural lessons into `.totem/lessons.md`. (Issue #18)

## Pillar 4: Friction Elimination & Polish (Phase 5)

**Status:** Future

- [ ] Implement Changesets and npm publishing (Issue #5)
- [ ] Implement `reset()` and ephemeral memory for the MCP tool
- [ ] Support implicit context via `totem integrate claude` to single-click install the MCP config
