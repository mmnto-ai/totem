# Architecture

## The Vision

Totem — **Git for AI. Rule your context.** (#606) — is designed as a **Shared Brain** and **Orchestrator** for a team of autonomous AI agents. Licensed under Apache 2.0, it operates completely locally within the consuming project, strictly adhering to an **Air-Gapped Doctrine** (Zero Telemetry) to ensure total data privacy (#474).

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
  - **Database:** LanceDB (embedded Node.js) is upgraded to 0.26.x, supporting multi-type knowledge retrieval to separate invariants from context (#494). It features auto-healing migrations to gracefully recover from version bumps and FTS panics (#500, #491). Cross-totem linked index queries are rigorously tested to ensure reliable semantic retrieval across repositories (#744).
  - **Health:** Incorporates `healthCheck()` to detect broken indexes at startup. It utilizes `index-meta.json` for explicit dimension mismatch detection, recommending `--rebuild` when necessary (#660, #562).
  - **Artifacts:** Creates a gitignored `.lancedb/` folder in the consumer's root. This is safely treated as a replaceable build artifact.
- **Data Processing:**
  - **Extraction & Chunking:**
    - _Context Parsing:_ Uses syntax-aware chunking via Tree-sitter AST parsing. It seamlessly indexes standard files and git submodules (#363).
    - _Integrity:_ Avoids blind character splitting by leveraging Markdown hierarchy, session breadcrumbs, and secure heading truncation (#714). A WASM implementation ensures robust handling of large files (#354).
  - **Embedding & Retrieval:**
    - _Embeddings:_ Utilizes Gemini (`gemini-embedding-2-preview`) as the primary dogfood embedder (#523). It features hybrid search combining Full-Text Search and vector similarity (#378).
    - _Resilience:_ Implements graceful degradation, falling back to Ollama if the primary provider fails (#517). Automatic `--full` syncs trigger when embedder configuration changes are detected, utilizing filesystem concurrency locks to prevent race conditions during sync operations (#548, #635).
- **Security & Maintenance:**
  - **Filtering:** Includes adversarial content scrubbing, DLP secret masking middleware to safely strip credentials before embedding (#609, #534). Includes a dedicated `lesson` ContentType for highly precise vector retrieval (#315).
  - **Drift Detection:** Self-cleaning sync engine purges orphaned vectors when source files are deleted. It is reinforced by strict path containment checks to prevent directory traversal (#284).

### 2. The CLI (`@mmnto/cli`)

All commands feature proper `--help` output documentation (#358).

- **Setup & Infrastructure:**
  - **Initialization:** Scaffolds configs, hooks, and AI tools with a polished onboarding dare, supporting a `--bare` flag and hiding legacy configurations (#717, #659). It relies on an ordered provider detection schema and automatically ingests `.cursorrules` (#608, #596).
  - **Environment Support:** Package manager auto-detection fully supports Bun and safely detects non-bash environments (#421, #316). Command modules leverage top-level dynamic imports to significantly boost CLI startup performance (#594, #605). The system is hardened by a cross-platform portability audit for the 1.0 release (#638).
  - **Error Handling:** Implements a unified error domain with typed `TotemError` subclasses, providing actionable `recoveryHint`s and standardized logging (#711, #620). The system relies on improved test assertions, such as spying directly on `log.warn`, to ensure output integrity (#746). It is hardened against command injection and taskkill exploitation, establishing secure boundaries for shell execution (#714).
- **Data & Context Management:**
  - **Indexing & Sharing:** `totem sync` crawls, chunks, and embeds targets into LanceDB, seamlessly supporting cross-totem queries via the `linkedIndexes` config (#665, #463). `totem link` seamlessly shares lessons and local knowledge between multiple local repositories (#614).
  - **Session Management:** `totem briefing` and `totem handoff` capture state snapshots, featuring brief output formatting for improved readability (#717). The `--lite` flag enables zero-LLM capture with ANSI sanitization (#292).
  - **Workflow Resets:** Automates mid-session resets and end-of-task workflows. `totem wrap` cleanly aborts if compilation requirements are missing (#409).
- **Workflow & Evaluation:**
  - **Planning & Orchestration:**
    - _Workflows:_ Orchestrates workflows with human approval gates, supporting configurable issue sources across repositories (#514). Integrates mandatory verify steps and `verify_execution` pipelines to validate spec invariants during generation (#708, #688).
    - _Automation:_ Structures capabilities using directory-based skills (`SKILL.md` per directory) to cleanly scope execution context (#757). Workflow automation improvements have deprecated and removed stale commands for a leaner toolset (#755).
    - _Hooks:_ Enforces lifecycle events like `/prepush` via `PreToolUse` hooks to guarantee compliance (#758). Pipeline reliability is bolstered by robust `PostCompact` formatting (#756).
  - **Review & Quality:**
    - **`totem lint`**: Runs compiled rules against diffs. Strictly zero LLM, fast, explicitly recommended for pre-push hooks and CI, and natively supports SARIF/JSON outputs (#610, #561).
    - **`totem shield`**: Conducts AI-powered code review using LanceDB context before PRs (#521). Enforces explicit severity levels, cleanly demotes false positives to warnings, and formats output via standard Totem Errors (#616, #576).
    - **`totem explain`**: Looks up the specific lesson behind a rule violation to provide immediate developer context (#668).
  - **Documentation:** Automates transactional document syncs using a Saga validator to prevent partial updates (#351). It safely strips known-not-shipped issue references from generated docs to prevent AI hallucinations (#598, #581).
  - **Telemetry & Stats:** Surfaces local metrics powered by the Phase 1 Trap Ledger and records launch metrics for performance visibility (#715, #544). Displays basic CIS metric percentages alongside violation histories (#425).
- **Rule Testing & Extraction:**
  - **Capture & Extraction:** Enables inline capture and batch PR lesson extraction. Lessons are strictly Zod-validated before disk writes to ensure structural integrity (#565).
  - **Harness Verification:** Serves as a compiled rule testing harness to empirically measure regex false positives, utilizing an integrated Docker test harness for isolated environment validation (#715, #422). The system actively verifies for "Complete or Broken" guardrail rules to ensure enforcement integrity (#663).
  - **Security:** Context-aware heuristics minimize false positives and block bad rules (#326). XML tagging guards against prompt injection from untrusted PR comments (#279).

### 3. Deterministic Compiler & Zero-LLM Lint

`totem compile` reads architectural constraints and translates each lesson into a rule or marks it as non-compilable (#688). It utilizes a facade pattern in `compiler.ts`—now optimized with an extracted `engineFields` helper—to cleanly orchestrate rule translation (#754, #710). The compiler introduces Pipeline 1 support, allowing manual patterns in lessons and reverse-compiling curated rules to ensure high-fidelity enforcement (#759, #752). It integrates a Tier 2 AST engine alongside its regex capabilities for advanced structural pattern matching (#659). It seamlessly ingests existing `.cursorrules` and `.mdc` files into the Totem compiled rule matrix (#558). To significantly boost performance, the compiler caches non-compilable lessons to skip redundant recompilation loops (#590) and converts core rule-loading imports to dynamic execution (#594). Rules are stored in `.totem/compiled-rules.json`—now extended with advanced telemetry fields and Phase 1 Semantic Rule Observability (#542).

The compilation process is context-aware, reading files directly from disk instead of parsing staged diffs to prevent AST gating false positives (#399). It actively filters ignored patterns before checking for an empty diff to ensure branch-diff fallbacks trigger correctly, preventing silent passes when only ignored files have changed (#709). Developers can bypass false positives using audited inline suppression directives or negated patterns (#458). Rules are strictly scoped using anchored glob matching, preventing `fileGlobs` from leaking outside specified directories (#584, #546). The compiler is constrained against generating unsupported nested globs or brace expansions (#603, #602). During execution, the loading engine applies an `onWarn` callback to filter valid structural warnings and suppress false positives (#595, #575). Duplicate, vulnerable, or overly broad match/exec patterns are actively refined, audited, and rejected to heavily reduce false positives. The system relies on a strictly curated 147-rule set for robust baseline enforcement (#708, #649).

`totem lint` applies these compiled rules against `git diff` additions with zero LLM calls. It shares a core `runCompiledRules` engine with `totem shield` for execution consistency across the pipeline (#566). This physically blocks main branch commits and pre-push violations locally. It generates standard SARIF 2.1.0 or JSON formatted outputs (`Violation[]`) to enable seamless enterprise security integration (#561).

### 4. Lint GitHub Action & CI Drift Gate

A composite GitHub Action (`action.yml`) runs `totem lint` as a pass/fail CI quality gate on pull requests. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to physically block known architectural traps from merging. The SARIF 2.1.0 output natively integrates with the GitHub Advanced Security tab, directly surfacing CISO-facing architectural violations (#387, #561).

Deterministic CI enforcement is further strengthened by evaluating sentinels like SonarQube Community Edition (#355), GitHub CodeQL v4 (#579, #268), and Dependabot (#267). The CI pipeline features a structural CI drift gate and an adversarial evaluation harness to perform integrity checks and mitigate model drift. To prevent pipeline lockouts, the local pre-push gate is securely guarded against missing CLI installations in CI environments and relies strictly on `totem lint` (#610).

Because `totem lint` operates purely on deterministic rules, it requires **zero LLM API calls**. This eliminates statistical hallucinations in CI and maintains a strict, air-gapped security posture for enterprise environments.

### 5. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing primary tools and strict access boundaries:

- **Core Tools:**
  - `search_knowledge(query)`: Semantic retrieval of codebase context and lessons. Search telemetry actively measures agent retrieval behaviors (#440).
  - `add_lesson(lesson, tags)`: Appends architectural lessons with descriptive headings. Employs a sync-pending debounce mechanism and filesystem concurrency locks to prevent write race conditions and mutation conflicts (#564, #635).
  - `enforcement`: Direct check tools empower agents to self-validate deterministic rules. This includes `verify_execution` capabilities to proactively test generated code against spec invariants before finalizing tasks (#688, #417).
- **Security & Permissions:**
  - **Sanitization:** XML-delimits all MCP responses and sanitizes persisted content. It cleanly strips quotes from loaded environment variables (#560).
  - **Access Control:** Implements multi-agent permissions and role-based access control (RBAC) to safely restrict execution boundaries (#312). Enforces explicit MCP payload capacity caps to prevent unbounded memory consumption (#714).
  - **Context Limits:** Agent instruction files are structurally governed using a recency sandwich pattern and strict length limits (#466, #511).
- **Integrations & Lifecycle:**
  - **IDE & Agent Hooks:** Agent hooks for Claude Code, Gemini CLI, and Junie (#464). Integrates robust lifecycle workflow automation, ensuring consistent enforcement at hook stages (#758).
  - **Session Management:** Utilizes a health check first-query gate to prevent silent search failures at startup. It accurately advises users to run `--rebuild` when indexes are broken (#442, #562).
  - **Stability:** Reaps zombie MCP processes via heartbeat timeouts to reliably resolve connection failures (#503). Handles dimension mismatches dynamically during retrieval queries (#444).

## Configuration Tiers

Totem supports three configuration tiers, auto-detected from the environment during `totem init`. The available command list is routinely audited to prune stale tasks and preserve a streamlined interface (#755):

| Tier         | Requirements                               | Available Commands                                                                                               |
| ------------ | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `link`, `bridge`, `eject`, `lint`, `compile`, `test`, `explain`, `handoff --lite` |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`                                                                                 |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `shield`, `triage`, `audit`, `briefing`, `handoff`, `extract`, `wrap`, `docs`)             |

The `embedding` field in `totem.config.ts` is optional; when omitted, Totem operates in the Lite tier. The `getConfigTier()` helper and `requireEmbedding()` guard enforce these boundaries at runtime with clear upgrade instructions.

## Orchestrator Providers

The CLI orchestrator supports multiple provider types via a discriminated union config (`provider` field). SDKs for native API providers are optional peer dependencies, loaded dynamically at runtime with friendly auto-detecting install prompts. Default model IDs are routinely audited across all providers (#324), and a dedicated supported models reference document is actively maintained (#325).

### Shell Provider (default)

Pipes prompts to any CLI tool via `{file}` and `{model}` placeholders. Handled timeouts and strict taskkill injection mitigations ensure stray orchestration processes do not cause memory leaks or execute malicious payloads (#714, #395):

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

The `.totem/lessons/` directory acts as an explicit, version-controlled ledger of architectural decisions. Local AI memory is actively audited, and extracted lessons are safely Zod-validated and auto-committed to promote contributor knowledge to version-controlled surfaces (#565, #441). It uses a dual-read/single-write migration strategy to robustly transition away from legacy single-file storage patterns (#428). When updated, `totem sync` automatically re-indexes them into multi-domain structures.

During `totem init`, users are offered an optional **Universal Baseline** — a curated dataset of 60 battle-tested foundational AI developer lessons (#622, #419). Appended with a `<!-- totem:baseline -->` marker for idempotency, these lessons include specific audience tags (contributor vs. consumer) to properly scope knowledge (#404). Baseline rules now feature integrated fix guidance to help agents rapidly resolve violations and accurately follow architectural expectations (#688). This solves the cold-start problem where a fresh install has no knowledge to retrieve.

## The `.strategy/` Submodule

For secure collaboration in enterprise environments, proprietary project guidelines and sensitive orchestration instructions are isolated in a `.strategy/` directory. By securely initializing and managing `.strategy` as a private git submodule (#300, #321), teams ensure confidential workflows remain strictly access-controlled. It actively houses the deep research, north star, and architecture analysis documents without encumbering the distributable core codebase (#349).

## Scope & Limitations

Totem enforces **architectural invariants** — structural rules about what code patterns must or must not exist. It is important to understand what Totem does and does not do (#607):

**What Totem does:**

- Blocks known-bad code patterns at the AST level (pre-commit, pre-push, CI)
- Enforces structural boundaries ("never import from legacy auth module")
- Detects violations of compiled `.cursorrules` and lesson-derived invariants
- Generates SARIF telemetry for compliance dashboards

**What Totem does NOT do:**

- **Runtime analysis:** Totem cannot detect race conditions, memory leaks, or runtime state bugs. It operates on static source code, not execution traces.
- **Cross-file taint analysis:** SQL injection or XSS that spans multiple files and requires data flow tracking is outside Totem's scope. Use DAST or SAST tools (Semgrep, Snyk) for these.
- **Symbolic execution or formal verification:** `totem lint` is deterministic (regex/AST matching), not a formal prover. It does not "mathematically prove" code correctness.
- **Probabilistic guarantees:** The vector search layer (LanceDB) uses fuzzy embeddings for _discovery_ (finding relevant rules). The _enforcement_ layer (Tree-sitter AST matching) is strictly deterministic. These are separate concerns — do not conflate them.

Totem is a fast, deterministic pre-commit check that catches structural violations. It complements, not replaces, comprehensive security tooling.
