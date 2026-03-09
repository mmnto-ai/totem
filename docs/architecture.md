# Architecture

## The Vision

Totem is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. It operates completely locally within the consuming project.

## Core Components

### 1. Vector Database (`@mmnto/totem`)

- **Engine:** LanceDB (embedded, in-process Node.js).
- **Storage:** Creates a `.lancedb/` folder in the consumer's root. This folder is gitignored and treated as a replaceable build artifact.
- **Embeddings:** Supports OpenAI (`text-embedding-3-small`) by default, with Ollama (`nomic-embed-text`) as an offline fallback.
- **Chunking:** Syntax-aware chunking (TypeScript Compiler API for code, heading hierarchy for Markdown, hierarchical breadcrumbs for session logs). No blind character splitting.
- **Drift Detection:** Self-cleaning sync engine that purges orphaned vectors when source files are deleted or renamed, keeping the index in sync with the physical codebase.

### 2. The CLI (`@mmnto/cli`)

- `totem init` / `totem eject`: Scaffolds or safely removes `totem.config.ts`, git hooks, and AI memory reflexes.
- `totem sync`: Crawls target directories defined in `totem.config.ts`, chunks, embeds, and updates the LanceDB index.
- `totem search`: Direct debug query interface.
- `totem spec` / `totem shield` / `totem triage`: Standardized workflow orchestration commands (spec planning, pre-push review, issue prioritization).
- `totem briefing` / `totem handoff`: Session start/end context snapshots.
- `totem extract`: Batch lesson extraction from PR review threads with interactive multi-select curation.
- `totem add-lesson`: Inline lesson capture (also exposed as MCP tool `add_lesson`).
- `totem compile`: Translates natural-language lessons into deterministic regex rules via constrained LLM prompt at compile-time.
- `totem docs`: Automated per-document LLM passes to keep project documentation in sync with the codebase.
- `totem bridge` / `totem wrap`: Mid-session context resets and end-of-task workflow automation.

### 3. Deterministic Compiler & Zero-LLM Shield

`totem compile` reads `.totem/lessons.md` and translates each lesson into a regex rule (or marks it as non-compilable). Rules are stored in `.totem/compiled-rules.json` and validated at compile-time. `totem shield --deterministic` applies these rules against `git diff` additions with zero LLM calls — ideal for CI enforcement without API keys or quota.

### 4. Shield GitHub Action (`action.yml`)

A composite GitHub Action that runs `totem sync` + `totem shield` as a pass/fail CI quality gate on pull requests. Gate-only (no PR commenting) — complements conversational review bots like Gemini Code Assist.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration. Provides two tools:

- `search_knowledge(query)`: Semantic retrieval of codebase context and lessons.
- `add_lesson(lesson, tags)`: Appends human-readable architectural lessons to `.totem/lessons.md` with descriptive content-derived headings.
- **Security:** XML-delimits all MCP responses (#149) and sanitizes persisted content to mitigate prompt injection and terminal injection attacks.

## Configuration Tiers

Totem supports three configuration tiers, auto-detected from the environment during `totem init`:

| Tier         | Requirements                               | Available Commands                                                                          |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `add-lesson`, `bridge`, `eject`                                                     |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`                                                            |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `shield`, `triage`, `briefing`, `handoff`, `extract`, `wrap`, `docs`) |

The `embedding` field in `totem.config.ts` is optional. When omitted, Totem operates in Lite tier — users can still capture lessons and manage hooks, but cannot index or search. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime with clear upgrade instructions.

## Orchestrator Model Configuration

The CLI orchestrator supports per-command model overrides via `totem.config.ts`:

```typescript
orchestrator: {
  provider: 'shell',
  command: 'gemini --model {model} -o json -e none < {file}',
  defaultModel: 'gemini-3-flash-preview',
  fallbackModel: 'gemini-2.5-flash',
  overrides: {
    docs: 'gemini-3.1-pro-preview',
    spec: 'gemini-3.1-pro-preview',
    shield: 'gemini-3.1-pro-preview',
    triage: 'gemini-3.1-pro-preview',
  },
}
```

Each command resolves its model via: `--model` flag > `overrides[command]` > `defaultModel`. Quota-exhaustion triggers automatic fallback to `fallbackModel` if configured.

## The `.totem/` Directory

The `lessons.md` file within `.totem/` is meant to be version-controlled (committed to git). It acts as the explicit, human-readable ledger of traps and architectural decisions. Lesson headings are derived from content (not timestamps) for scannable PR diffs. When updated, `totem sync` re-indexes it.

During `totem init`, users are offered an optional **Universal Baseline** — a curated set of foundational AI developer lessons (security, hallucination traps, architecture rules). These are appended to `lessons.md` with a `<!-- totem:baseline -->` marker for idempotency. The baseline solves the cold-start problem where a fresh install has no knowledge to retrieve.

## Phase 4 Vision: Federated Memory & Swarm Intelligence

Because Totem treats memory as static files (`.totem/lessons.md`, `session-handoff.md`, `active_work.md`), we can unlock "Swarm Intelligence" across a team without inventing a complex peer-to-peer mesh network.

By configuring `totem.config.ts` to read upstream or aggregated LanceDB indexes, an enterprise team can achieve:

1. **Platform Policy Inheritance:** Local agents query a central platform database to inherit security and architectural rules before writing code.
2. **Zero-Friction Standups:** A central AI aggregates local `handoff.md` and `active_work.md` artifacts from developer branches to synthesize team status without Jira.
3. **Collision Detection:** Developers can query if an uncommitted architectural change exists in a teammate's active work tree.

The core philosophy remains: **Keep the infrastructure dumb (static files and LanceDB), and the queries smart.**
