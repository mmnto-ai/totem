# Architecture

## The Vision

Totem is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. Licensed under Apache 2.0, it operates completely locally within the consuming project.

## Core Components

### 1. Vector Database (`@mmnto/totem`)

- **Storage & Engine:**
  - **Database:** LanceDB (embedded, in-process Node.js).
  - **Artifacts:** Creates a gitignored `.lancedb/` folder in the consumer's root, treated as a replaceable build artifact.
- **Data Processing:**
  - **Embeddings:** Supports OpenAI (`text-embedding-3-small`) by default, with Ollama (`nomic-embed-text`) as an offline fallback.
  - **Context Parsing:** Uses syntax-aware chunking via Tree-sitter AST parsing. It seamlessly indexes both standard files and git submodules (#363).
  - **Integrity:** Avoids blind character splitting by leveraging Markdown hierarchy and session breadcrumbs. A web-tree-sitter WASM investigation ensures robust handling of files exceeding 32KB (#354).
- **Security & Maintenance:**
  - **Filtering:** Includes adversarial content scrubbing and a dedicated `lesson` ContentType for highly precise vector retrieval (#315, #386).
  - **Drift Detection:** Self-cleaning sync engine purges orphaned vectors when source files are deleted. It is reinforced by strict path containment checks to prevent directory traversal (#284).

### 2. The CLI (`@mmnto/cli`)

All commands feature proper `--help` output documentation (#358).

- **Setup & Infrastructure:**
  - `totem init` / `totem eject`: Scaffolds or safely removes config, hooks, and memory. It features a versioned reflex upgrade path and hardened vector DB prompts (#372, #376).
  - `totem hooks`: Installs git hooks and supports npm `prepare` auto-install (#332). It automatically walks up to the git root from monorepo sub-packages (#333).
  - **Environment Support:** Package manager auto-detection fully supports Bun (#316). It gracefully detects and handles non-bash hook environments (#317).
- **Data & Context Management:**
  - **Indexing:** `totem sync` crawls target directories, chunks, embeds, and updates the LanceDB index. `totem search` provides a direct debug query interface.
  - **Session Management:** `totem briefing` and `totem handoff` capture session state snapshots. The `handoff --lite` flag enables zero-LLM capture with robust ANSI sanitization (#292).
  - **Workflow Resets:** `totem bridge` and `totem wrap` automate mid-session context resets and end-of-task workflows.
- **Workflow & Evaluation:**
  - **Planning & Orchestration:** `totem spec`, `totem triage`, and `totem audit` orchestrate workflows and backlog strategies with human approval gates (#362). Relevant vector DB lessons are dynamically injected into all command outputs (#369, #391).
  - **Review & Quality:** `totem shield` enforces context-blind architectural reviews and inline lesson extraction (#303).
  - **Documentation:** `totem docs` automates transactional document syncs with strict sub-bullet thresholds and line-length limits (#341). It employs a Saga validator to definitively prevent partial or corrupted updates (#351, #356).
- **Lesson Extraction & Compilation:**
  - **Capture & Extraction:** `totem add-lesson` enables inline capture, while `totem extract` handles batch PR reviews with interactive multi-select curation (#265). It deduplicates identical lessons and uses concise, content-derived headings without mid-sentence truncation (#347, #348).
  - **Security:** Context-aware heuristics minimize false positives and actively block bad rules (#326). Strict XML tagging guards against prompt injection from untrusted PR comments (#279).
  - **Compilation:** `totem compile` translates lessons into deterministic regex rules at compile-time. It supports cross-model exports for targets like GitHub Copilot and JetBrains Junie (#294, #371).

### 3. Deterministic Compiler & Zero-LLM Shield

`totem compile` reads `.totem/lessons.md` and translates each lesson into a regex rule (or marks it as non-compilable). Rules are stored in `.totem/compiled-rules.json` and validated at compile-time with syntax checking and ReDoS static analysis (`safe-regex2`). The compilation process is context-aware, leveraging Tree-sitter AST gating to prevent false positives within string literals (#251).

Developers can bypass false positives using inline suppression directives (`totem-ignore` / `totem-ignore-next-line`) or negated patterns in `fileGlobs` (e.g., `!*.test.ts`). Rules are strictly scoped using anchored glob matching to ensure precision (#357). Vulnerable patterns (nested quantifiers, star height > 1) are rejected and left to be handled by the standard LLM-based shield.

`totem shield --deterministic` applies these compiled rules against `git diff` additions with zero LLM calls. This is used for local git hook enforcement, physically blocking main branch commits and pre-push violations (#310). It acts as a CI quality gate while eliminating API key dependency and quota exhaustion.

### 4. Shield GitHub Action & CI Drift Gate

A composite GitHub Action (`action.yml`) runs `totem shield --deterministic` as a pass/fail CI quality gate on pull requests. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to physically block known architectural traps from merging. Deterministic CI enforcement is further strengthened by evaluating sentinels like SonarQube Community Edition (#355), GitHub CodeQL (#268), and Dependabot (#267).

The CI pipeline features a structural CI drift gate and an adversarial evaluation harness to perform integrity checks and mitigate model drift. To prevent pipeline lockouts, the local pre-push shield gate is securely guarded against missing CLI installations in CI environments.

Because it operates in `--deterministic` mode, the shield requires **zero LLM API calls**. This eliminates statistical hallucinations in CI and maintains a strict, air-gapped security posture for enterprise environments.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing primary tools and strict access boundaries:

- **Core Tools:**
  - `search_knowledge(query)`: Semantic retrieval of codebase context and lessons.
  - `add_lesson(lesson, tags)`: Appends architectural lessons to `.totem/lessons.md` with descriptive content-derived headings.
- **Security & Permissions:**
  - **Sanitization:** XML-delimits all MCP responses and sanitizes persisted content to mitigate prompt injection attacks.
  - **Access Control:** Implements multi-agent permissions and role-based access control (RBAC) to safely restrict execution boundaries (#312).
- **Session Management:**
  - **Lifecycle Rules:** Utilizes dedicated MCP lifecycle lessons for improved session consistency and lifecycle boundary management (#384).

## Configuration Tiers

Totem supports three configuration tiers, auto-detected from the environment during `totem init`:

| Tier         | Requirements                               | Available Commands                                                                                   |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `bridge`, `eject`, `handoff --lite`                                   |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`                                                                     |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `shield`, `triage`, `audit`, `briefing`, `handoff`, `extract`, `wrap`, `docs`) |

The `embedding` field in `totem.config.ts` is optional; when omitted, Totem operates in the Lite tier. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime with clear upgrade instructions.

## Orchestrator Providers

The CLI orchestrator supports multiple provider types via a discriminated union config (`provider` field). SDKs for native API providers are optional peer dependencies, loaded dynamically at runtime with friendly auto-detecting install prompts. Default model IDs are routinely audited across all providers (#324), and a dedicated supported models reference document is actively maintained (#325).

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

Direct SDK calls using the standard OpenAI-compatible format. Ideal for official OpenAI models or compatible custom local endpoints (#285):

```typescript
orchestrator: {
  provider: 'openai',
  defaultModel: 'gpt-5.4',
}
```

### Ollama Provider (native API)

Direct SDK integration for local, offline orchestration via Ollama. This provider natively supports dynamic context length management (`num_ctx`) to optimize handling for exceptionally large payload requirements (#298):

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

- **Routing & Resolution:**
  - Centralized via `resolveOrchestrator()`, prioritizing `--model` over `overrides` and `defaultModel`.
  - Supports `fallbackModel` and cross-provider `overrides` using `provider:model` syntax.
- **Customization:** Supports `systemPrompts` for per-command custom instructions and `cacheTtls` for performance tuning.
- **Resilience:** Quota-exhaustion (429 errors) triggers automatic fallback. Legacy configs gracefully auto-migrate to the shell provider.

## The `.totem/` Directory

The `lessons.md` file within `.totem/` acts as an explicit, version-controlled ledger of architectural decisions. Lesson headings are derived directly from content context for highly descriptive, scannable PR diffs. When updated, `totem sync` re-indexes it.

During `totem init`, users are offered an optional **Universal Baseline** — a curated set of foundational AI developer lessons. Appended with a `<!-- totem:baseline -->` marker for idempotency, it solves the cold-start problem where a fresh install has no knowledge to retrieve.

## The `.strategy/` Submodule

For secure collaboration in enterprise environments, proprietary project guidelines and sensitive orchestration instructions are isolated in a `.strategy/` directory. By securely initializing and managing `.strategy` as a private git submodule (#300, #321), teams ensure confidential workflows remain strictly access-controlled. It actively houses the deep research, north star, and architecture analysis documents without encumbering the distributable core codebase (#349).

## Phase 4 Vision: Federated Memory & Swarm Intelligence

Because Totem treats memory as static files (`.totem/lessons.md`, `session-handoff.md`, `active_work.md`), we can unlock "Swarm Intelligence" across a team without inventing a complex peer-to-peer mesh network.

By configuring `totem.config.ts` to read upstream or aggregated LanceDB indexes, an enterprise team can achieve:

1. **Platform Policy Inheritance:** Local agents query a central platform database to inherit security and architectural rules before writing code.
2. **Zero-Friction Standups:** A central AI aggregates local `handoff.md` and `active_work.md` artifacts from developer branches to synthesize team status without Jira.
3. **Collision Detection:** Developers can query if an uncommitted architectural change exists in a teammate's active work tree.

The core philosophy remains: **Keep the infrastructure dumb (static files and LanceDB), and the queries smart.** To further support extreme enterprise scaling capabilities, Rust Core Extraction (`totem-core-rs`) is actively being evaluated as part of future foundational shifts (#286).
