# Architecture

## The Vision

Totem is a local-first CLI and MCP server that compiles project knowledge into deterministic enforcement rules. By default it operates entirely within the consuming project with no outbound network calls or telemetry. Cloud embedding and orchestrator providers make outbound API calls only when explicitly configured. Licensed under Apache 2.0.

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
  - **Database:** LanceDB (embedded Node.js) 0.26.x supports index partitions with alias resolution and multi-type knowledge retrieval. This separates invariants from context. It includes auto-healing migrations and supports cross-totem queries.
  - **Health:** Uses `healthCheck()` to detect broken indexes at startup. It reads `index-meta.json` for dimension mismatch detection and recommends `--rebuild` when necessary.
  - **Artifacts:** Creates a gitignored `.lancedb/` folder in the consumer root directory. This is treated as a replaceable build artifact.
- **Data Processing:**
  - **Extraction & Chunking:**
    - _Context Parsing:_ Uses syntax-aware chunking via Tree-sitter AST parsing. It indexes standard files and git submodules.
    - _Integrity:_ Avoids blind character splitting by leveraging Markdown hierarchy and secure heading truncation. A WASM implementation handles large files.
  - **Embedding & Retrieval:**
    - _Embeddings:_ Utilizes Gemini (`gemini-embedding-2-preview`) as the primary embedder. It features hybrid search combining Full-Text Search and vector similarity.
    - _Resilience:_ Falls back to Ollama if the primary provider fails. Automatic `--full` syncs trigger when embedder configuration changes are detected. Filesystem concurrency locks prevent race conditions.
- **Security & Maintenance:**
  - **Filtering:** Includes adversarial content scrubbing and DLP secret masking. This handles user-defined secrets at every LLM boundary. A dedicated `lesson` ContentType ensures precise vector retrieval.
  - **Drift Detection:** A self-cleaning sync engine purges orphaned vectors when source files are deleted. Path containment checks and ingestion hardening establish firm trust boundaries.

### 2. The CLI (`@mmnto/cli`)

All commands feature proper `--help` output documentation.

- **Setup & Infrastructure:**
  - **Initialization:** Scaffolds configs, hooks, and AI tools with an onboarding workflow. It supports a `--bare` flag and hides legacy configurations. It relies on an ordered provider detection schema and ingests `.cursorrules`.
  - **Environment Support:** Package manager auto-detection supports Bun and detects non-bash environments. Dynamic imports reduce CLI startup time. Process exits are explicitly managed to prevent execution hangs.
  - **Error Handling & Wiring:** Implements an error domain with typed `TotemError` subclasses and ES2022 error cause chains. Dependency Injection via `CoreLogger` standardizes logging. A standard system library manages safe execution and git adapter usage to enforce native module restrictions.
- **Data & Context Management:**
  - **Indexing & Sharing:** `totem sync` crawls, chunks, and embeds targets into LanceDB. It supports cross-totem queries via the `linkedIndexes` config. `totem link` shares lessons between multiple local repositories.
  - **Session Management:** `totem briefing` and `totem handoff` capture state snapshots using brief output formatting. The `--lite` flag enables zero-LLM capture with ANSI sanitization.
  - **Workflow Resets:** Automates mid-session resets and end-of-task workflows. The `totem wrap` command aborts cleanly and manages exit codes if compilation requirements are missing.
- **Workflow & Evaluation:**
  - **Planning & Orchestration:**
    - _Workflows:_ Orchestrates workflows with human approval gates. It supports configurable issue sources across repositories. Integrates mandatory verify steps and `verify_execution` pipelines.
    - _Automation:_ Structures capabilities using directory-based skills (`SKILL.md` per directory) to scope execution context. Workflow automation removes stale commands for a leaner toolset.
    - _Hooks:_ Enforces lifecycle events via `PreToolUse` hooks. Phase-gate enforcement actively blocks commits lacking proper preflight. Hooks resolve paths from the git root and use `jq` for JSON parsing with fallbacks.
  - **Review & Quality:**
    - **`totem lint`**: Runs compiled rules against diffs. Zero LLM, fast, and recommended for pre-push hooks and CI. It natively supports SARIF/JSON outputs.
    - **`totem shield`**: Conducts AI-powered code review using LanceDB context before PRs. It enriches context with full file contents for small changed files. Supports an audited `--override` flag to bypass LLM false positives, logging the event to the trap ledger.
    - **`totem explain`**: Looks up the specific lesson behind a rule violation to provide immediate developer context.
  - **Documentation:** Automates transactional document syncs using a Saga validator to prevent partial updates. It strips known-not-shipped references and marketing terminology from generated content.
  - **Telemetry & Triage:** The Trap Ledger maintains append-only telemetry locally via `.totem/ledger/events.ndjson`. The `totem doctor` command autonomously downgrades noisy rules based on this data. A categorized triage inbox maps finding severities (Phase 1), with planned support for agent dispatch integration (Phase 2), interactive prompts (Phase 3), and lesson extraction (Phase 4). Planned roadmap additions include a unified exemption engine and consolidated check commands.
- **Rule Testing & Extraction:**
  - **Capture & Extraction:** Enables inline capture and batch PR lesson extraction. Lessons are strictly Zod-validated before disk writes to ensure structural integrity.
  - **Harness Verification:** Serves as a compiled rule testing harness to measure regex false positives. It includes inline hit/miss verification examples for rule unit testing during compile time.
  - **Security:** Context-aware heuristics minimize false positives and block bad rules. XML tagging guards against prompt injection from untrusted PR comments.

### 3. Deterministic Compiler & Zero-LLM Lint

`totem compile` reads architectural constraints and translates each lesson into a rule. It incorporates a strict lesson file linter acting as a pre-compilation gate to ensure structural integrity. Planned updates include semantic validation for scope, severity, and exclusions. The compilation process integrates manifest signing to establish a secure provenance chain and supports parallel execution via a `--concurrency` flag. It utilizes a facade pattern in `compiler.ts` to orchestrate rule translation.

The compiler supports manual pattern definitions in lessons and reverse-compiles curated rules. The system incorporates a backfill of body text for 938 core architectural lessons to enrich rule context. It integrates a Tier 2 AST engine alongside its regex capabilities for advanced structural pattern matching. These AST query engines implement graceful degradation and strictly manage process exits. Rules are stored in `.totem/compiled-rules.json`, extended with advanced telemetry fields.

The compilation process is context-aware, reading files directly from disk instead of parsing staged diffs. This prevents AST gating false positives. Developers can bypass false positives using audited inline suppression directives. Rules are scoped using anchored glob matching, preventing `fileGlobs` from leaking outside specified directories. Duplicate or overly broad match patterns are actively consolidated and rejected. The system relies on a curated 379-rule set for baseline enforcement.

`totem lint` applies these compiled rules against `git diff` additions with zero LLM calls. It shares a core `runCompiledRules` engine with `totem shield` for execution consistency. This blocks main branch commits and pre-push violations locally.

**Unified Findings Model:** All violations are normalized into a canonical `TotemFinding` interface. This ensures consistent severity mapping across engines and supports finding deduplication:

- **Lint:** `error` → `error`, `warning` → `warning`
- **Shield:** `CRITICAL` → `error`, `WARN` → `warning`, `INFO` → `info`

It generates standard SARIF 2.1.0 or JSON formatted outputs to enable enterprise security integration.

### 4. Lint GitHub Action & CI Drift Gate

A composite GitHub Action (`action.yml`) runs `totem lint` as a pass/fail CI quality gate on pull requests. It is validated across a cross-platform CI matrix covering Ubuntu, Windows, and macOS. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to block known architectural traps from merging. The SARIF 2.1.0 output natively integrates with the GitHub Advanced Security tab.

Deterministic CI enforcement is further strengthened by evaluating continuous automated codebase review sentinels:

- **Quality & Security:** SonarQube Community Edition and GitHub CodeQL v4.
- **Dependencies:** Dependabot.
- **Code Review:** CodeRabbit. Planned updates include skipping out-of-diff CodeRabbit findings during triage.

The CI pipeline features a structural CI drift gate, a manifest attestation gate utilizing isolated workflows, and an adversarial evaluation harness. It utilizes CI wind tunnel SHA locks to maintain fixture integrity during evaluation. Release workflows incorporate tag push resilience to prevent deployment failures. To prevent pipeline lockouts, the local pre-push gate requires CLI installation and relies strictly on `totem lint`. Because `totem lint` operates purely on deterministic rules, it requires **zero LLM API calls**. This eliminates statistical hallucinations in CI.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing primary tools and strict access boundaries:

- **Core Tools:**
  - `search_knowledge(query, boundary)`: Semantic retrieval of codebase context and lessons. Includes a boundary parameter to scope search domains. Telemetry actively measures agent retrieval behaviors.
  - `add_lesson(lesson, tags)`: Appends architectural lessons with descriptive headings. Employs a sync-pending debounce mechanism and filesystem concurrency locks to prevent write race conditions.
  - `enforcement`: Direct check tools empower agents to self-validate deterministic rules. This includes `verify_execution` capabilities to test generated code against spec invariants.
- **Security & Permissions:**
  - **Sanitization:** XML-delimits all MCP responses and sanitizes persisted content. It strips quotes from loaded environment variables.
  - **Access Control:** Implements an MCP authentication model, strict trust boundaries, and role-based access control (RBAC). Enforces explicit MCP payload capacity caps to prevent unbounded memory consumption.
  - **Context Limits:** Agent instruction files are structurally governed using a recency sandwich pattern, strict length limits, and a lean root router pattern.
- **Integrations & Lifecycle:**
  - **IDE & Agent Hooks:** Agent hooks for Claude Code, Gemini CLI, and Junie. Integrates workflow automation.
  - **Session Management:** Utilizes a health check first-query gate to prevent silent search failures at startup. It advises users to run `--rebuild` when indexes are broken.
  - **Stability:** Reaps zombie MCP processes via heartbeat timeouts to resolve connection failures. Handles dimension mismatches dynamically during retrieval queries.

## Configuration Tiers

Totem supports three explicit capability tiers, auto-detected from the environment during `totem init`. The available command list is audited to prune stale tasks and preserve a streamlined interface:

| Tier         | Requirements                               | Available Commands                                                                                               |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `link`, `bridge`, `eject`, `lint`, `compile`, `test`, `explain`, `handoff --lite` |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`, `doctor`                                                                       |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `shield`, `triage`, `audit`, `briefing`, `handoff`, `extract`, `wrap`, `docs`)             |

The `embedding` field in `totem.config.ts` is optional; when omitted, Totem operates in the Lite tier. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime.

## Orchestrator Providers

The CLI orchestrator supports multiple provider types via a discriminated union config (`provider` field). SDKs for native API providers are optional peer dependencies, loaded dynamically at runtime with auto-detecting install prompts. Default model IDs are audited across all providers, and a dedicated supported models reference document is actively maintained.

### Shell Provider (default)

Pipes prompts to any CLI tool via `{file}` and `{model}` placeholders. Handled timeouts and strict taskkill injection mitigations ensure stray orchestration processes do not cause memory leaks:

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

Direct SDK calls using the standard OpenAI-compatible format. Used for official OpenAI models or compatible custom local endpoints:

```typescript
orchestrator: {
  provider: 'openai',
  defaultModel: 'gpt-5.4',
}
```

### Ollama Provider (native API)

Direct SDK integration for local, offline orchestration via Ollama. This provider natively supports dynamic context length management (`num_ctx`) to handle large payload requirements:

```typescript
orchestrator: {
  provider: 'ollama',
  defaultModel: 'llama3', // or qwen2.5, phi3, etc.
}
```

### Gemini Provider (native API)

Direct SDK calls via `@google/genai`. Requires `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) and adheres to bound consent and safety rules:

```typescript
orchestrator: {
  provider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  fallbackModel: 'gemini-2.5-pro',
}
```

### Anthropic Provider (native API)

Direct SDK calls via `@anthropic-ai/sdk`. Token limits are managed dynamically to optimize usage for smaller models like Claude Haiku:

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
- **Resilience:** Implements graceful degradation, automatically falling back from native SDKs to the CLI provider if primary execution fails. Legacy configs auto-migrate to the shell provider.

## The `.totem/` Directory

The `.totem/lessons/` directory acts as an explicit, version-controlled ledger of architectural decisions. Local AI memory is audited, and extracted lessons are safely Zod-validated and auto-committed. It uses a dual-read/single-write migration strategy to transition away from legacy single-file storage patterns. When updated, `totem sync` automatically re-indexes them into multi-domain structures.

During `totem init`, users are offered an optional **Universal Baseline** — a curated dataset of battle-tested foundational AI developer lessons. Appended with a `<!-- totem:baseline -->` marker for idempotency, these lessons include specific audience tags (contributor vs. consumer) to scope knowledge. Language packs provide baseline lessons tailored for Python, Rust, and Go environments. Baseline rules feature integrated fix guidance to help agents resolve violations and follow architectural expectations. This solves the cold-start problem where a fresh install has no knowledge to retrieve.

## The `.strategy/` Submodule

For secure collaboration in enterprise environments, proprietary project guidelines and sensitive orchestration instructions are isolated in a `.strategy/` directory. By initializing and managing `.strategy` as a private git submodule, teams ensure confidential workflows remain access-controlled. It houses deep research, north star, and architecture analysis documents without encumbering the distributable core codebase. The strategy submodule now operates its own Totem instance to enforce rules specifically within its domain.

## Scope & Limitations

Totem enforces **architectural invariants** — structural rules about what code patterns must or must not exist. It is important to understand what Totem does and does not do:

**What Totem does:**

- Blocks known-bad code patterns at the AST level (pre-commit, pre-push, CI)
- Enforces structural boundaries ("never import from legacy auth module")
- Detects violations of compiled `.cursorrules` and lesson-derived invariants
- Generates SARIF telemetry for compliance dashboards

**What Totem does NOT do:**

- **Runtime analysis:** Totem cannot detect race conditions, memory leaks, or runtime state bugs. It operates on static source code, not execution traces.
- **Cross-file taint analysis:** SQL injection or XSS that spans multiple files and requires data flow tracking is outside Totem's scope. Use DAST or SAST tools (Semgrep, Snyk) for these.
- **Symbolic execution or formal verification:** `totem lint` is deterministic (regex/AST matching), not a formal prover. It does not mathematically prove code correctness.
- **Probabilistic assurances:** The vector search layer (LanceDB) uses fuzzy embeddings for _discovery_ (finding relevant rules). The _enforcement_ layer (Tree-sitter AST matching) is strictly deterministic. These are separate concerns — do not conflate them.

Totem is a fast, deterministic pre-commit check that catches structural violations. It complements, not replaces, broad security tooling.
