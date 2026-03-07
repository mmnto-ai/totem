# Architecture

## The Vision

Totem is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. It operates completely locally within the consuming project.

## Core Components

### 1. Vector Database (`@mmnto/totem`)

- **Engine:** LanceDB (embedded, in-process Node.js).
- **Storage:** Creates a `.lancedb/` folder in the consumer's root. This folder is gitignored and treated as a replaceable build artifact.
- **Embeddings:** Supports OpenAI (`text-embedding-3-small`) by default, with Ollama (`nomic-embed-text`) as an offline fallback.
- **Chunking:** Syntax-aware chunking (AST for code, Headings for Markdown, Hierarchical breadcrumbs for session logs). No blind character splitting.

### 2. The CLI (`@mmnto/cli`)

- `totem init` / `totem eject`: Scaffolds or safely removes `totem.config.ts`, git hooks, and AI memory reflexes.
- `totem sync`: Crawls target directories defined in `totem.config.ts`, chunks, embeds, and updates the LanceDB index.
- `totem search`: Direct debug query interface.
- `totem spec` / `totem shield` / `totem triage`: Standardized workflow orchestration commands (spec planning, pre-push review, issue prioritization).
- `totem briefing` / `totem handoff`: Session start/end context snapshots.
- `totem extract`: Batch lesson extraction from PR review threads with interactive multi-select curation.
- `totem add-lesson`: Inline lesson capture (also exposed as MCP tool `add_lesson`).
- `totem bridge` / `totem wrap`: Mid-session context resets and end-of-task workflow automation.

### 3. Shield GitHub Action (`action.yml`)

A composite GitHub Action that runs `totem sync` + `totem shield` as a pass/fail CI quality gate on pull requests. Gate-only (no PR commenting) — complements conversational review bots like Gemini Code Assist.

### 4. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration. Provides two tools:

- `search_knowledge(query)`: Semantic retrieval of codebase context and lessons.
- `add_lesson(lesson, tags)`: Appends human-readable architectural lessons to `.totem/lessons.md`.

## The `.totem/` Directory

The `lessons.md` file within `.totem/` is meant to be version-controlled (committed to git). It acts as the explicit, human-readable ledger of traps and architectural decisions. When updated, `totem sync` re-indexes it.

## Phase 4 Vision: Federated Memory & Swarm Intelligence

Because Totem treats memory as static files (`.totem/lessons.md`, `session-handoff.md`, `active_work.md`), we can unlock "Swarm Intelligence" across a team without inventing a complex peer-to-peer mesh network.

By configuring `totem.config.ts` to read upstream or aggregated LanceDB indexes, an enterprise team can achieve:

1. **Platform Policy Inheritance:** Local agents query a central platform database to inherit security and architectural rules before writing code.
2. **Zero-Friction Standups:** A central AI aggregates local `handoff.md` and `active_work.md` artifacts from developer branches to synthesize team status without Jira.
3. **Collision Detection:** Developers can query if an uncommitted architectural change exists in a teammate's active work tree.

The core philosophy remains: **Keep the infrastructure dumb (static files and LanceDB), and the queries smart.**
