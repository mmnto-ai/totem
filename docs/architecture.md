# Architecture

## The Vision

Totem is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. Licensed under Apache 2.0, it operates completely locally within the consuming project.

## Core Components

<!-- totem-preserve-start -->

```mermaid
flowchart TD
    %% Define Styles
    classDef agent fill:#1e1e1e,stroke:#4a4a4a,color:#fff
    classDef memory fill:#2d3748,stroke:#63b3ed,color:#fff
    classDef totem fill:#1a365d,stroke:#4299e1,color:#fff,stroke-width:2px
    classDef core fill:#4a5568,stroke:#a0aec0,color:#fff

    %% The Multi-Agent Layer
    subgraph Agents [The Multi-Agent Execution Layer]
        A1[Claude Code]:::agent
        A2[Gemini CLI]:::agent
        A3[Cursor / IDE]:::agent
    end

    %% The Workflow & Core Rules Layer
    subgraph CoreMemory [Core Operational Memory]
        M1(<b>MEMORY.md</b><br/><br/><i>Type: Global Safety</i><br/>- "Never amend commits"<br/>- "Only use pnpm"):::memory
        M2(<b>CLAUDE.md</b><br/><br/><i>Type: Workflow Defaults</i><br/>- "Run totem shield before pushing"<br/>- List of MCP servers):::memory
        M3(<b>.gemini/styleguide.md</b><br/><br/><i>Type: Syntax & Style</i><br/>- "Always use Drizzle eq()"<br/>- "Zod for boundaries"):::memory
    end

    %% The Totem Control Plane
    subgraph TotemPlane [Totem: The Codebase Immune System]
        direction TB
        T1((<b>.totem/lessons/</b><br/><i>Domain Knowledge & Traps</i><br/>- "DraftKings prop IDs changed"<br/>- "RSC Context caching bugs")):::totem
        T2[<b>totem compile</b><br/><i>Natural Language to Regex/AST</i>]:::core
        T3((<b>compiled-rules.json</b><br/><i>Deterministic Hard Gates</i>)):::totem
        T4((<b>.lancedb/</b><br/><i>Semantic Vector Index</i>)):::totem

        T1 --> T2
        T2 --> T3
        T1 --> |"totem sync"| T4
    end

    %% CI/CD & Enforcement
    subgraph CI [Enforcement Gates]
        C1[<b>totem lint</b><br/><i>Zero-LLM Pre-commit Hook</i>]:::core
        C2[GitHub Actions / CI]:::core
    end

    %% Connections
    Agents --> |Reads on Startup| CoreMemory

    A1 & A2 & A3 <--> |"MCP search_knowledge"<br/>(Proactive Prevention)| T4
    A1 & A2 & A3 --> |"MCP add_lesson"<br/>(Learning Loop)| T1

    A1 --> |"git commit"| C1
    C1 --> |Evaluates Diff Against| T3
    C1 --> |"Blocks Bad Code"| A1

    T3 -.-> |Runs in| C2
```

<!-- totem-preserve-end -->

### 1. Vector Database (`@mmnto/totem`)

- **Storage & Engine:**
  - **Database:** LanceDB (embedded, in-process Node.js). Upgraded to 0.26.x, it supports multi-type knowledge retrieval to cleanly separate invariants from general context (#364, #494).
  - **Health:** Incorporates `healthCheck()` to detect and handle broken indexes at startup (#439).
  - **Artifacts:** Creates a gitignored `.lancedb/` folder in the consumer's root, treated as a replaceable build artifact.
- **Data Processing:**
  - **Extraction & Chunking:**
    - _Context Parsing:_ Uses syntax-aware chunking via Tree-sitter AST parsing, seamlessly indexing both standard files and git submodules (#363).
    - _Integrity:_ Avoids blind character splitting by leveraging Markdown hierarchy and session breadcrumbs. A web-tree-sitter WASM implementation ensures robust handling of files exceeding 32KB (#354).
  - **Embedding & Retrieval:**
    - _Embeddings:_ Utilizes Gemini (`gemini-embedding-2-preview`) as the primary dogfood embedder, with robust alternatives available (#539). Features hybrid search combining Full-Text Search and vector similarity with RRF reranking (#378).
    - _Resilience:_ Implements graceful degradation for embedders, automatically falling back to Ollama if the primary configured provider fails (#517).
- **Security & Maintenance:**
  - **Filtering:** Includes adversarial content scrubbing and a dedicated `lesson` ContentType for highly precise vector retrieval (#315, #379).
  - **Drift Detection:** Self-cleaning sync engine purges orphaned vectors when source files are deleted. It is reinforced by strict path containment checks to prevent directory traversal (#284).

### 2. The CLI (`@mmnto/cli`)

All commands feature proper `--help` output documentation (#358).

- **Setup & Infrastructure:**
  - `totem init` / `totem eject`: Scaffolds or safely removes config, hooks, and memory. It scaffolds AI tools like Copilot and Junie (#448) while emitting sensible default `ignorePatterns` (#421).
  - `totem hooks`: Installs git hooks and supports npm `prepare` auto-install (#332). It automatically walks up to the git root from monorepo sub-packages (#333).
  - **Environment Support:** Package manager auto-detection fully supports Bun (#316). It gracefully detects and handles non-bash hook environments (#317).
- **Data & Context Management:**
  - **Indexing:** `totem sync` crawls target directories, chunks, embeds, and updates the LanceDB index. It supports multi-totem knowledge domains to seamlessly index `.strategy` repos (#463).
  - **Session Management:** `totem briefing` and `totem handoff` capture session state snapshots. The `handoff --lite` flag enables zero-LLM capture with robust ANSI sanitization (#292).
  - **Workflow Resets:** `totem bridge` and `totem wrap` automate mid-session context resets and end-of-task workflows. Wrap cleanly aborts via `NoLessonsError` if compilation requirements are missing (#409).
- **Workflow & Evaluation:**
  - **Planning & Orchestration:** Orchestrates workflows via `totem spec`, `totem triage`, and `totem audit` with human approval gates. Triage and extract commands now support configurable issue sources across multiple repositories (#532).
  - **Review & Quality:**
    - **`totem lint`**: Runs compiled rules against diffs — zero LLM, fast, used in CI and pre-push hooks (#549).
    - **`totem shield`**: AI-powered code review with knowledge retrieval, used before opening PRs.
  - **Documentation:** `totem docs` automates transactional document syncs with strict sub-bullet thresholds and line-length limits (#341). It employs a Saga validator to prevent partial or corrupted updates (#351).
- **Rule Testing & Extraction:**
  - **Capture & Extraction:** `totem add-lesson` enables inline capture, while `totem extract` handles batch PR reviews. It deduplicates identical lessons and uses concise, content-derived headings (#347).
  - **Harness Verification:** `totem test` serves as a compiled rule testing harness to empirically measure regex false positives (#422). This local evaluation matrix actively shapes requirements for future AST rules.
  - **Security:** Context-aware heuristics minimize false positives and actively block bad rules (#326). Strict XML tagging guards against prompt injection from untrusted PR comments (#279).

### 3. Deterministic Compiler & Zero-LLM Shield

`totem compile` reads architectural constraints and translates each lesson into a regex rule (or marks it as non-compilable). Rules are stored in `.totem/compiled-rules.json`—now extended with advanced telemetry fields and Phase 1 semantic rule observability (#415, #545)—and validated at compile-time with syntax checking and ReDoS static analysis. The compilation process is context-aware, directly reading files from disk instead of parsing staged diffs to prevent AST gating false positives (#399).

Developers can bypass false positives using audited inline suppression directives (`totem-ignore` / `totem-ignore-next-line`) or negated patterns in `fileGlobs` (#458). Rules are strictly scoped to correct file boundaries using anchored glob matching (#546). This resolves literal file path false positives and enables targeted enforcement, such as restricting dynamic-import rules to command files only (#457, #533). Vulnerable or overly aggressive patterns (e.g., single-match `exec` rules, nested quantifiers) are actively refined or rejected (#538).

`totem lint` applies these compiled rules against `git diff` additions with zero LLM calls. This physically blocks main branch commits and pre-push violations locally. It generates standard SARIF 2.1.0 formatted outputs (`Violation[]`) to enable seamless enterprise security integration (#418, #437).

### 4. Shield GitHub Action & CI Drift Gate

A composite GitHub Action (`action.yml`) runs `totem lint` as a pass/fail CI quality gate on pull requests. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to physically block known architectural traps from merging. The SARIF 2.1.0 output natively integrates with the GitHub Advanced Security tab, directly surfacing CISO-facing architectural violations (#387).

Deterministic CI enforcement is further strengthened by evaluating sentinels like SonarQube Community Edition (#355), GitHub CodeQL (#268), and Dependabot (#267). The CI pipeline features a structural CI drift gate and an adversarial evaluation harness to perform integrity checks and mitigate model drift. To prevent pipeline lockouts, the local pre-push shield gate is securely guarded against missing CLI installations in CI environments.

Because it operates in `--deterministic` mode, the shield requires **zero LLM API calls**. This eliminates statistical hallucinations in CI and maintains a strict, air-gapped security posture for enterprise environments.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing primary tools and strict access boundaries:

- **Core Tools:**
  - `search_knowledge(query)`: Semantic retrieval of codebase context and lessons. Search telemetry logs actively measure agent retrieval behaviors (#440).
  - `add_lesson(lesson, tags)`: Appends architectural lessons with descriptive content-derived headings.
  - `get_rules_for_file` / `check_compliance`: Direct enforcement tools empowering agents to self-validate deterministic rules (#417).
- **Security & Permissions:**
  - **Sanitization:** XML-delimits all MCP responses and sanitizes persisted content to mitigate prompt injection attacks. Handles dimension mismatches dynamically for task-aware embedders like Gemini (#444).
  - **Access Control:** Implements multi-agent permissions and role-based access control (RBAC) to safely restrict execution boundaries (#312).
  - **Context Limits:** Agent instruction files are structurally governed using a recency sandwich pattern and strict length limits (#466, #511).
- **Integrations & Lifecycle:**
  - **IDE Support:** Agent hooks for Claude Code, Gemini, and Junie (#464). Involuntary enforcement under research (#520).
  - **Session Management:** Utilizes a health check first-query gate and briefing warnings to prevent silent search failures at startup (#442).
  - **Stability:** Reaps zombie MCP processes via heartbeat timeouts to reliably resolve connection failures (#503, #512).

## Configuration Tiers

Totem supports three configuration tiers, auto-detected from the environment during `totem init`:

| Tier         | Requirements                               | Available Commands                                                                                   |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `bridge`, `eject`, `lint`, `compile`, `test`, `handoff --lite`        |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`                                                                     |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `shield`, `triage`, `audit`, `briefing`, `handoff`, `extract`, `wrap`, `docs`) |

The `embedding` field in `totem.config.ts` is optional; when omitted, Totem operates in the Lite tier. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime with clear upgrade instructions.

## Orchestrator Providers

The CLI orchestrator supports multiple provider types via a discriminated union config (`provider` field). SDKs for native API providers are optional peer dependencies, loaded dynamically at runtime with friendly auto-detecting install prompts. Default model IDs are routinely audited across all providers (#324), and a dedicated supported models reference document is actively maintained (#325).

### Shell Provider (default)

Pipes prompts to any CLI tool via `{file}` and `{model}` placeholders. Handled timeouts ensure stray orchestration processes do not cause memory leaks (#395):

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

Direct SDK calls via `@anthropic-ai/sdk`. Token limits are managed dynamically to optimize usage for smaller models like Claude Haiku (#396):

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
- **Resilience:** Implements graceful degradation, automatically falling back from native SDKs to the CLI provider if primary execution fails (#516). Legacy configs elegantly auto-migrate to the shell provider.

## The `.totem/` Directory

The `.totem/lessons/` directory acts as an explicit, version-controlled ledger of architectural decisions. Local AI memory is actively audited, and extracted lessons are safely auto-committed to promote contributor knowledge to version-controlled surfaces (#402, #441). It uses a dual-read/single-write migration strategy to robustly transition away from legacy single-file storage patterns (#428). When updated, `totem sync` automatically re-indexes them into multi-domain structures.

During `totem init`, users are offered an optional **Universal Baseline** — a curated dataset of foundational AI developer lessons (#419). Appended with a `<!-- totem:baseline -->` marker for idempotency, these lessons include specific audience tags (contributor vs. consumer) to properly scope knowledge (#404). This solves the cold-start problem where a fresh install has no knowledge to retrieve.

## The `.strategy/` Submodule

For secure collaboration in enterprise environments, proprietary project guidelines and sensitive orchestration instructions are isolated in a `.strategy/` directory. By securely initializing and managing `.strategy` as a private git submodule (#300, #321), teams ensure confidential workflows remain strictly access-controlled. It actively houses the deep research, north star, and architecture analysis documents without encumbering the distributable core codebase (#349).

## Phase 4 Vision: Federated Memory & Swarm Intelligence

Because Totem treats memory as static files (`.totem/lessons.md`, `session-handoff.md`, `active_work.md`), we can unlock "Swarm Intelligence" across a team without inventing a complex peer-to-peer mesh network.

By configuring `totem.config.ts` to read upstream or aggregated LanceDB indexes, an enterprise team can achieve:

1. **Platform Policy Inheritance:** Local agents query a central platform database to inherit security and architectural rules before writing code.
2. **Zero-Friction Standups:** A central AI aggregates local `handoff.md` and `active_work.md` artifacts from developer branches to synthesize team status without Jira.
3. **Collision Detection:** Developers can query if an uncommitted architectural change exists in a teammate's active work tree.

The core philosophy remains: **Keep the infrastructure dumb (static files and LanceDB), and the queries smart.** To further support extreme enterprise scaling capabilities, Rust Core Extraction (`totem-core-rs`) is actively being evaluated as part of future foundational shifts (#286).
