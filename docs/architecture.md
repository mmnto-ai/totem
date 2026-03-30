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
        M2(<b>CLAUDE.md</b><br/><br/><i>Type: Workflow Defaults</i><br/>- "Run totem review before pushing"<br/>- List of MCP servers):::memory
        M3(<b>.gemini/styleguide.md</b><br/><br/><i>Type: Syntax & Style</i><br/>- "Always use Drizzle eq()"<br/>- "Zod for boundaries"):::memory
    end

    %% The Totem Control Plane
    subgraph TotemPlane [Totem: The Codebase Immune System]
        direction TB
        T1((<b>.totem/lessons/</b><br/><i>Domain Knowledge & Traps</i><br/>- "DraftKings prop IDs changed"<br/>- "RSC Context caching bugs")):::totem
        T2[<b>totem lesson compile</b><br/><i>Natural Language to Regex/AST</i>]:::core
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
  - **Database:** LanceDB (embedded Node.js) 0.26.x supports index partitions with alias resolution and multi-type knowledge retrieval. This separates invariants from context. Auto-healing migrations and cross-totem queries are supported natively.
  - **Health:** Startup processes use `healthCheck()` to detect broken indexes. It reads `index-meta.json` for dimension mismatch detection and requires users to run `--rebuild` when necessary.
  - **Artifacts:** A gitignored `.lancedb/` folder is generated in the consumer root directory. This database is treated as a safely replaceable build artifact.
- **Data Processing:**
  - **Extraction & Chunking:**
    - _Context Parsing:_ Syntax-aware chunking relies on Tree-sitter AST parsing. It supports standard files and git submodules.
    - _Integrity:_ Markdown hierarchy and secure heading truncation prevent blind character splitting. A WASM implementation handles large file processing.
  - **Embedding & Retrieval:**
    - _Embeddings:_ Gemini (`gemini-embedding-2-preview`) acts as the primary embedder. A hybrid search combines Full-Text Search and vector similarity.
    - _Resilience:_ Fallbacks point to Ollama if the primary provider fails. Filesystem concurrency locks prevent write race conditions.
- **Security & Maintenance:**
  - **Filtering:** Adversarial content scrubbing and DLP secret masking are applied at every LLM boundary. A dedicated `lesson` ContentType scopes vector retrieval.
  - **Drift Detection:** A self-cleaning sync engine purges orphaned vectors. It strictly validates that database paths remain relative to prevent traversal vulnerabilities.

### 2. The CLI (`@mmnto/cli`)

All commands feature `--help` documentation utilizing logical capability groupings and LLM badges.

- **Setup & Infrastructure:**
  - **Architecture & UX:** The CLI utilizes a noun-verb hierarchical command structure (e.g., `totem rule list`). Global `--json` output support enables programmatic scriptability.
  - **Initialization:** Scaffolds configs, hooks, and AI tools via an onboarding workflow. It supports a `--bare` flag and hides legacy configurations.
  - **Environment Support:** Package manager auto-detection natively supports Bun and non-bash environments. Dynamic imports strictly limit scope to reduce CLI startup time.
  - **Error Handling:** An error domain utilizes typed `TotemError` subclasses and ES2022 error cause chains. Injectable loggers replace raw console outputs. A standard library provides safe execution and isolated git adapter functions.
- **Data & Context Management:**
  - **Indexing & Sharing:** `totem sync` crawls, chunks, and embeds targets into LanceDB. `totem link` shares lessons between local repositories.
  - **Discovery:** `totem describe` provides automated project discovery for agents. Vector search via Node injects auto-context at session start.
  - **Session Management:** `totem briefing` captures snapshot states. `totem handoff` creates structured session checkpoints to persist context across context windows.
  - **Workflow Resets:** Mid-session resets and end-of-task workflows are automated. The `totem wrap` command aborts cleanly and strictly manages exit codes.
- **Workflow & Evaluation:**
  - **Planning & Orchestration:**
    - _Workflows:_ Human approval gates control orchestration workflows. Directory-based skills (`SKILL.md`) scope execution context.
    - _Hooks:_ Phase-gate enforcement actively blocks git operations lacking proper preflight. Hook regex strictly matches git subcommands.
  - **Review & Quality:**
    - **`totem lint`**: Evaluates diffs against compiled rules. This zero-LLM process is fast and recommended for pre-push hooks and CI.
    - **`totem review`**: Conducts AI-powered codebase review. It serves as an optional reference implementation driven by a Content Hash lock at the MCP boundary. It parses full file contents for small diffs.
    - **`totem explain`**: Looks up the specific lesson driving a rule violation to deliver immediate developer context.
  - **Documentation:** Transactional document syncs employ a Saga validator to prevent partial state updates. Known-not-shipped references are automatically stripped.
  - **Telemetry & Triage:**
    - _Ledger:_ The Trap Ledger maintains append-only telemetry locally via `.totem/ledger/events.ndjson`.
    - _Self-Healing:_ `totem doctor` autonomously downgrades noisy rules using historical telemetry. A review-learn pipeline extracts lessons directly from resolved bot findings.
    - _Triage:_ A categorized triage inbox maps severities (Phase 1). Roadmap items include agent dispatch integration (Phase 2), interactive command-line interface prompts (Phase 3), and lesson extraction pipelines (Phase 4). Future pipelines plan to add an exemption engine and unified enforcement commands.
- **Rule Testing & Extraction:**
  - **Capture & Validation:** Inline capture and batch PR extraction workflows feed the system. Lessons are strictly Zod-validated before write operations. Forbidden native module rules enforce execution boundaries.
  - **Harness Verification:** The compiled rule testing harness measures false positives natively. It runs inline hit and miss verification examples during rule compile time.
  - **Security:** Audited bypass flags provide overrides for false positives. Worktrees are explicitly excluded from formatting rules to maintain environment isolation.

### 3. Deterministic Compiler & Zero-LLM Lint

`totem lesson compile` translates natural language architectural constraints into deterministic rules. It enforces structural integrity via a pre-compilation linter. Planned roadmap features include a lesson logic linter for semantic scope, severity, and exclusion validation. Compilation utilizes a facade pattern in `compiler.ts` and supports parallel execution via the `--concurrency` flag.

The system incorporates a backfill of body text across 1,032 core architectural lessons to enrich rule context. It combines regular expressions with a Tier 2 AST engine for advanced structural pattern matching. These queries use graceful degradation and strictly manage process exits. Compiled output is stored in `.totem/compiled-rules.json` and extended with telemetry fields.

The compiler prevents AST gating false positives by reading files directly from disk instead of parsing staged diffs. Rules are scoped using anchored glob matching, preventing `fileGlobs` from leaking. Duplicate match patterns are actively consolidated and rejected. The default enforcement pipeline relies on a curated 379-rule set.

`totem lint` applies these compiled rules against `git diff` additions with zero LLM API calls. It shares a core `runCompiledRules` engine with `totem review` for consistency. Stateful flag files have been completely removed; local git `pre-push` hooks now run strictly deterministic validations combining `lint` and manifest verification.

**Unified Findings Model:** All engine violations are normalized into a canonical `TotemFinding` interface. This supports deduplication and consistent severity mapping:

- **Lint:** `error` → `error`, `warning` → `warning`
- **Review:** `CRITICAL` → `error`, `WARN` → `warning`, `INFO` → `info`

It outputs standard SARIF 2.1.0 or JSON formatted results for enterprise security integration.

### 4. Lint GitHub Action & CI Drift Gate

A composite GitHub Action (`action.yml`) runs `totem lint` as a strict pass/fail quality gate on pull requests. It operates across a cross-platform CI matrix covering Ubuntu, Windows, and macOS. It uses pre-compiled AST/regex rules to block known architectural traps. The SARIF 2.1.0 output natively integrates into the GitHub Advanced Security tab.

Deterministic CI enforcement is further strengthened by evaluating continuous automated codebase review sentinels:

- **Quality & Security:** SonarQube Community Edition and GitHub CodeQL v4.
- **Dependencies:** Dependabot.
- **Code Review:** CodeRabbit. Planned roadmap features will configure incremental shield validations to run diff-only re-checks, skipping out-of-diff CodeRabbit findings during triage.

The CI pipeline relies on a structural drift gate, manifest attestation, and adversarial evaluation harnesses. It utilizes CI wind tunnel SHA locks to maintain fixture integrity. Tag push resilience workflows prevent isolated deployment failures. Because `totem lint` operates purely on deterministic rules, it requires **zero LLM API calls**, eliminating statistical hallucinations in the critical path.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing explicit tools and strict access boundaries:

- **Core Tools:**
  - `search_knowledge(query, boundary)`: Semantic retrieval of codebase context. It includes a boundary parameter to isolate search domains and telemetry to measure agent behaviors.
  - `add_lesson(lesson, tags)`: Appends architectural lessons. It employs a sync-pending debounce mechanism and filesystem concurrency locks to prevent write collision.
  - `enforcement`: Direct check tools allow agents to test code before finalizing output. It features `verify_execution` capabilities to validate code against spec invariants.
- **Security & Permissions:**
  - **Sanitization:** XML-delimits MCP responses and sanitizes persisted content. It actively strips quotes from loaded environment variables.
  - **Access Control:** Enforces strict trust boundaries, an MCP authentication model, and explicit payload capacity caps to prevent unbounded memory consumption.
  - **Context Limits:** Agent instructions use a recency sandwich pattern, length limits, and a lean root router pattern for structural governance.
- **Integrations & Lifecycle:**
  - **Hooks:** Integrates agent hooks for Claude Code, Gemini CLI, and Cursor.
  - **Session Management:** Runs a health check first-query gate to prevent silent search failures. Users are prompted to `--rebuild` broken indexes on startup.
  - **Stability:** Reaps zombie MCP processes via heartbeat timeouts. Dynamic handling resolves dimension mismatches during retrieval queries.

## Configuration Tiers

Totem categorizes access into three capability tiers auto-detected during `totem init`. The available commands are continually audited to preserve a streamlined interface:

| Tier         | Requirements                               | Available Commands                                                                                        |
| ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `link`, `describe`, `lint`, `compile`, `test`, `explain`, `handoff --lite` |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`, `doctor`                                                                |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `review`, `triage`, `audit`, `briefing`, `handoff`, `extract`, `wrap`, `docs`)      |

The `embedding` field in `totem.config.ts` is optional. When omitted, Totem operates entirely in the Lite tier. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime.

## Orchestrator Providers

The CLI orchestrator routes LLM tasks across multiple provider types via a discriminated union config (`provider` field). SDKs for native API providers are optional peer dependencies. Default model IDs are actively audited across all providers.

### Shell Provider (default)

Pipes prompts to any CLI tool via `{file}` and `{model}` placeholders. Handled timeouts and strict taskkill injection mitigations ensure orchestration processes do not cause memory leaks:

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

Direct SDK calls using the standard OpenAI-compatible format. Used for official OpenAI models or compatible local endpoints:

```typescript
orchestrator: {
  provider: 'openai',
  defaultModel: 'gpt-5.4',
}
```

### Ollama Provider (native API)

Direct SDK integration for local orchestration via Ollama. It natively supports dynamic context length management (`num_ctx`) to process large payloads:

```typescript
orchestrator: {
  provider: 'ollama',
  defaultModel: 'llama3', // or qwen2.5, phi3, etc.
}
```

### Gemini Provider (native API)

Direct SDK calls via `@google/genai`. Requires `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) and implements strict bound consent and safety constraints:

```typescript
orchestrator: {
  provider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  fallbackModel: 'gemini-2.5-pro',
}
```

### Anthropic Provider (native API)

Direct SDK calls via `@anthropic-ai/sdk`. Token limits are managed dynamically to optimize rate limits for smaller models like Claude Haiku:

```typescript
orchestrator: {
  provider: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
}
```

### Shared Configuration

All orchestrator providers route configurations through centralized logic:

- **Routing & Resolution:**
  - `resolveOrchestrator()` centralizes priority logic, preferring `--model` over `overrides` and `defaultModel`.
  - Supports `fallbackModel` and cross-provider `overrides` using `provider:model` syntax.
- **Customization:** Configures `systemPrompts` for per-command instructions and limits payload processing via `cacheTtls`.
- **Resilience:** Implements graceful degradation to automatically fall back from native SDKs to the CLI provider if primary execution fails. Legacy configurations migrate automatically.

## The `.totem/` Directory

The `.totem/lessons/` directory serves as the version-controlled ledger for architectural decisions. Local memory is structurally governed, ensuring extracted lessons are Zod-validated and automatically committed to the repository. The folder utilizes a dual-read/single-write migration strategy. Running `totem sync` re-indexes all modified files.

During `totem init`, users are offered a Universal Baseline. This curated set of foundational developer lessons solves the cold-start problem. Appended with a `<!-- totem:baseline -->` marker, the rules utilize specific audience tags to isolate context. Baseline features establish language packs natively configured for Python, Rust, and Go environments. These baseline rules supply agents with integrated fix guidance to help resolve structural violations autonomously.

## The `.strategy/` Submodule

Enterprise and sensitive workflows utilize a `.strategy/` directory to isolate proprietary project guidelines. Managed as a private git submodule, it provides deep research and architectural analysis documents while keeping the core distributable repository unencumbered. The strategy submodule executes its own isolated Totem instance to enforce rules specifically within its independent domain.

## Scope & Limitations

Totem enforces **architectural invariants** — structural rules defining what code patterns must or must not exist. It is critical to understand what the system evaluates:

**What Totem does:**

- Blocks known-bad code patterns at the AST level (pre-commit, pre-push, CI)
- Enforces structural boundaries ("never import from legacy auth module")
- Detects violations of compiled `.cursorrules` and lesson-derived invariants
- Generates SARIF telemetry for compliance dashboards

**What Totem does NOT do:**

- **Runtime analysis:** Totem cannot detect race conditions, memory leaks, or runtime state bugs. It operates strictly on static source code.
- **Cross-file taint analysis:** Tracking data flow injections across files is outside its scope. Use SAST or DAST solutions for this requirement.
- **Symbolic execution or formal verification:** `totem lint` operates via deterministic AST matching. It does not mathematically prove code execution paths.
- **Probabilistic assurances:** LanceDB relies on fuzzy embeddings for discovery. The enforcement layer utilizes deterministic AST parsers. These two systems handle completely separate concerns.

Totem provides fast, deterministic enforcement for structural invariants. It is designed to complement existing broad-spectrum security analyzers, not replace them.
