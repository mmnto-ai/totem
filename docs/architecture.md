# Architecture

## The Vision

Totem is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. It operates completely locally within the consuming project.

## Core Components

### 1. Vector Database (`@mmnto/totem`)

- **Engine:** LanceDB (embedded, in-process Node.js).
- **Storage:** Creates a `.lancedb/` folder in the consumer's root. This folder is gitignored and treated as a replaceable build artifact.
- **Embeddings:** Supports OpenAI (`text-embedding-3-small`) by default, with Ollama (`nomic-embed-text`) as an offline fallback.
- **Chunking:** Syntax-aware chunking (Tree-sitter for universal AST parsing of code, heading hierarchy for Markdown, hierarchical breadcrumbs for session logs). No blind character splitting.
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
- `totem docs`: Automated per-document LLM passes to keep project documentation in sync with the codebase. Supports targeting individual documents via explicit path arguments (with automatic path fixes) for precision updates (safeguarded by XML sentinels for reliable output extraction).
- `totem bridge` / `totem wrap`: Mid-session context resets and end-of-task workflow automation.

### 3. Deterministic Compiler & Zero-LLM Shield

`totem compile` reads `.totem/lessons.md` and translates each lesson into a regex rule (or marks it as non-compilable). Rules are stored in `.totem/compiled-rules.json` (with support for `fileGlobs` scoping to target specific files) and validated at compile-time with both syntax checking and ReDoS static analysis (`safe-regex2`). Vulnerable patterns (nested quantifiers, star height > 1) are rejected, leaving them to be handled by the standard LLM-based shield. `totem shield --deterministic` applies these rules against `git diff` additions with zero LLM calls — ideal for CI enforcement without API keys or quota.

### 4. Shield GitHub Action (`action.yml`)

A composite GitHub Action that runs `totem shield --deterministic` as a pass/fail CI quality gate on pull requests. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to physically block known architectural traps from merging.

Because it operates in `--deterministic` mode, it requires **zero LLM API calls**, eliminating statistical hallucinations in CI and maintaining a strict, air-gapped security posture for enterprise environments.

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

## Orchestrator Providers

The CLI orchestrator supports three provider types via a discriminated union config (`provider` field). SDKs for native API providers are **optional peer dependencies** — loaded via dynamic `import()` at runtime with friendly install prompts (featuring package manager auto-detection) if missing (BYOSD: "Bring Your Own SDK").

### Shell Provider (default)

Pipes prompts to any CLI tool via `{file}` and `{model}` placeholders:

```typescript
orchestrator: {
  provider: 'shell',
  command: 'gemini --model {model} -o json -e none < {file}',
  defaultModel: 'gemini-3-flash-preview',
  fallbackModel: 'gemini-2.5-flash',
  overrides: { spec: 'gemini-3.1-pro-preview' },
}
```

### Gemini Provider (native API)

Direct SDK calls via `@google/genai`. Requires `GEMINI_API_KEY` (or `GOOGLE_API_KEY`):

```typescript
orchestrator: {
  provider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  fallbackModel: 'gemini-2.5-pro',
}
```

### Anthropic Provider (native API)

Direct SDK calls via `@anthropic-ai/sdk`. Requires `ANTHROPIC_API_KEY`:

```typescript
orchestrator: {
  provider: 'anthropic',
  defaultModel: 'claude-sonnet-4-5-20250514',
}
```

### Shared Configuration

All providers support: `defaultModel`, `fallbackModel`, `overrides` (per-command model routing, supporting `provider:model` syntax for cross-provider routing), `systemPrompts` (per-command custom system prompt overrides), and `cacheTtls` (per-command cache TTL in seconds). Each command resolves its model via: `--model` flag > `overrides[command]` > `defaultModel`. Quota-exhaustion (429/rate-limit) triggers automatic fallback to `fallbackModel` if configured. Legacy configs without a `provider` field are auto-migrated to `provider: 'shell'`.

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
