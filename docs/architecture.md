# Architecture

## The Vision

Totem is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. Licensed under Apache 2.0, it operates completely locally within the consuming project.

## Core Components

### 1. Vector Database (`@mmnto/totem`)

- **Engine:** LanceDB (embedded, in-process Node.js).
- **Storage:** Creates a `.lancedb/` folder in the consumer's root. This folder is gitignored and treated as a replaceable build artifact.
- **Embeddings:** Supports OpenAI (`text-embedding-3-small`) by default, with Ollama (`nomic-embed-text`) as an offline fallback.
- **Chunking & Ingestion:**
  - Syntax-aware chunking via Tree-sitter AST parsing, Markdown hierarchy, and session breadcrumbs.
  - **Data Integrity:** Completely avoids blind character splitting.
  - **Security:** Ingestion pipeline includes adversarial content scrubbing to bulletproof against malicious payloads.
- **Drift Detection:** Self-cleaning sync engine purges orphaned vectors when source files are deleted or renamed. It is reinforced by strict path containment checks to prevent directory traversal out-of-bounds.

### 2. The CLI (`@mmnto/cli`)

- **Setup & Infrastructure:**
  - `totem init` / `totem eject`: Scaffolds or safely removes config, hooks, and memory. Package manager auto-detection gracefully handles Bun and non-bash environments.
  - `totem hooks`: Installs or updates git hooks and supports npm `prepare` auto-install. It is monorepo-aware, automatically walking up to the git root from sub-packages.
- **Data & Context Management:**
  - `totem sync`: Crawls target directories defined in `totem.config.ts`, chunks, embeds, and updates the LanceDB index.
  - `totem search`: Direct debug query interface.
  - `totem briefing` / `totem handoff`: Session start/end context snapshots. The `handoff --lite` flag enables zero-LLM state capture with robust ANSI output sanitization.
  - `totem bridge` / `totem wrap`: Mid-session context resets and end-of-task workflow automation.
- **Workflow & Evaluation:**
  - `totem spec` / `totem triage`: Standardized workflow orchestration commands.
  - `totem shield`: Includes `--mode=structural` for context-blind architectural review and `--learn` for lesson extraction.
  - `totem docs`:
    - Automated per-document LLM passes to keep project documentation in sync with the codebase.
    - **Precision:** Targets individual documents via explicit path arguments and XML sentinel safeguards.
    - **Formatting:** Enforces strict sub-bullet thresholds and line-length limits during generation.
    - **Transactional Safety:** Employs a Saga validator for checkpoints and rollbacks, preventing partial or corrupted updates (#356).
- **Lesson Extraction & Compilation:**
  - `totem add-lesson`: Inline lesson capture (also exposed as MCP tool `add_lesson`).
  - `totem extract`:
    - Batch lesson extraction from PR reviews with interactive multi-select curation via `--pick`.
    - **Formatting:** Generated lessons use concise, highly descriptive, content-derived headings.
    - **Security:** Context-aware heuristics minimize false positives in suspicious lesson detection and actively block bad rules.
    - **Protection:** Strict XML tagging and explicit system prompt notices guard against prompt injection from untrusted PR comments.
  - `totem compile`:
    - Translates natural-language lessons into deterministic regex rules at compile-time.
    - Supports an `--export` flag for cross-model lesson targets (like GitHub Copilot instructions).

### 3. Deterministic Compiler & Zero-LLM Shield

`totem compile` reads `.totem/lessons.md` and translates each lesson into a regex rule (or marks it as non-compilable). Rules are stored in `.totem/compiled-rules.json` and validated at compile-time with syntax checking and ReDoS static analysis (`safe-regex2`). The compilation process is context-aware, leveraging Tree-sitter AST gating to prevent false positives within string literals.

Developers can bypass false positives using inline suppression directives (`totem-ignore` / `totem-ignore-next-line`) or negated patterns in `fileGlobs` (e.g., `!*.test.ts`). Rules are strictly scoped using anchored glob matching to ensure precision (#357). Vulnerable patterns (nested quantifiers, star height > 1) are rejected and left to be handled by the standard LLM-based shield.

`totem shield --deterministic` applies these compiled rules against `git diff` additions with zero LLM calls. This is used for local git hook enforcement (blocking pre-commit/pre-push violations) and CI quality gating, eliminating API key dependency and quota exhaustion.

### 4. Shield GitHub Action & CI Drift Gate

A composite GitHub Action (`action.yml`) runs `totem shield --deterministic` as a pass/fail CI quality gate on pull requests. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to physically block known architectural traps from merging.

The CI pipeline features a structural CI drift gate and an adversarial evaluation harness to perform integrity checks and mitigate model drift. To prevent pipeline lockouts, the local pre-push shield gate is securely guarded against missing CLI installations in CI environments.

Because it operates in `--deterministic` mode, the shield requires **zero LLM API calls**. This eliminates statistical hallucinations in CI and maintains a strict, air-gapped security posture for enterprise environments.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing two tools:

- `search_knowledge(query)`: Semantic retrieval of codebase context and lessons.
- `add_lesson(lesson, tags)`: Appends architectural lessons to `.totem/lessons.md` with descriptive content-derived headings.
- **Security:** XML-delimits all MCP responses and sanitizes persisted content to mitigate prompt and terminal injection attacks.

## Configuration Tiers

Totem supports three configuration tiers, auto-detected from the environment during `totem init`:

| Tier         | Requirements                               | Available Commands                                                                          |
| ------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `bridge`, `eject`, `handoff --lite`                          |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`                                                            |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `shield`, `triage`, `briefing`, `handoff`, `extract`, `wrap`, `docs`) |

The `embedding` field in `totem.config.ts` is optional; when omitted, Totem operates in the Lite tier. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime with clear upgrade instructions.

## Orchestrator Providers

The CLI orchestrator supports multiple provider types via a discriminated union config (`provider` field). SDKs for native API providers are optional peer dependencies, loaded dynamically at runtime with friendly auto-detecting install prompts. Default model IDs are regularly audited, and a dedicated supported models reference document is available.

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

### Generic OpenAI Provider (native API)

Direct SDK calls using the standard OpenAI-compatible format. Ideal for official OpenAI models or compatible custom endpoints (like LM Studio):

```typescript
orchestrator: {
  provider: 'openai',
  defaultModel: 'gpt-5.4',
}
```

### Ollama Provider (native API)

Direct SDK integration for local, offline orchestration via Ollama. This provider supports dynamic context length management (`num_ctx`) to optimize large payloads:

```typescript
orchestrator: {
  provider: 'ollama',
  defaultModel: 'llama3', // or qwen2.5, phi3, etc.
}
```

### Gemini Provider (native API)

Direct SDK calls via `@google/genai`. Requires `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) and adheres to explicitly bound consent and safety rules:

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
  defaultModel: 'claude-sonnet-4-6',
}
```

### Shared Configuration

All orchestrator providers support standardizing complex configurations via centralized logic:

- **Routing & Overrides:** Supports `defaultModel`, `fallbackModel`, and `overrides` (including `provider:model` syntax for cross-provider routing and negated globs).
- **Resolution Engine:** Centralized via the `resolveOrchestrator()` helper, resolving models in order: `--model` flag > `overrides[command]` > `defaultModel`.
- **Customization:** Supports `systemPrompts` for per-command custom instructions and `cacheTtls` for performance tuning.
- **Resilience:** Quota-exhaustion (429 errors) triggers automatic fallback, while legacy configs gracefully auto-migrate to the shell provider.

## The `.totem/` Directory

The `lessons.md` file within `.totem/` acts as an explicit, version-controlled ledger of architectural decisions. Lesson headings are derived directly from content context for highly descriptive, scannable PR diffs. When updated, `totem sync` re-indexes it.

During `totem init`, users are offered an optional **Universal Baseline** — a curated set of foundational AI developer lessons. Appended with a `<!-- totem:baseline -->` marker for idempotency, it solves the cold-start problem where a fresh install has no knowledge to retrieve.

## The `.strategy/` Submodule

For secure collaboration in enterprise environments, proprietary project guidelines, markdown research documents (#350), and sensitive orchestration instructions are isolated in a `.strategy/` directory. By managing `.strategy` as a private git submodule, teams ensure confidential workflows remain strictly access-controlled while the core codebase remains distributable.

## Phase 4 Vision: Federated Memory & Swarm Intelligence

Because Totem treats memory as static files (`.totem/lessons.md`, `session-handoff.md`, `active_work.md`), we can unlock "Swarm Intelligence" across a team without inventing a complex peer-to-peer mesh network.

By configuring `totem.config.ts` to read upstream or aggregated LanceDB indexes, an enterprise team can achieve:

1. **Platform Policy Inheritance:** Local agents query a central platform database to inherit security and architectural rules before writing code.
2. **Zero-Friction Standups:** A central AI aggregates local `handoff.md` and `active_work.md` artifacts from developer branches to synthesize team status without Jira.
3. **Collision Detection:** Developers can query if an uncommitted architectural change exists in a teammate's active work tree.

The core philosophy remains: **Keep the infrastructure dumb (static files and LanceDB), and the queries smart.**
