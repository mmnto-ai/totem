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
  - **Database:** LanceDB 0.26.x supports index partitions with alias resolution to separate invariants from context. It features auto-healing migrations and supports cross-totem queries.
  - **Health:** Startup routines detect broken indexes and recommend rebuilds when encountering dimension mismatches. Creates a gitignored `.lancedb/` folder treated as a replaceable artifact.
- **Data Processing:**
  - **Extraction & Chunking:**
    - _Context Parsing:_ Uses syntax-aware chunking via Tree-sitter AST parsing. It indexes standard files and git submodules.
    - _Integrity:_ Avoids blind character splitting by leveraging Markdown hierarchy and secure heading truncation. A lazy-initialized WASM implementation handles large files.
  - **Embedding & Retrieval:**
    - _Embeddings:_ Utilizes Gemini as the primary embedder. It features hybrid search combining Full-Text Search and vector similarity.
    - _Resilience:_ Auto-detects and falls back to Ollama if the primary provider fails. Automatic syncs trigger on configuration changes, while filesystem locks prevent race conditions.
- **Security & Maintenance:**
  - **Filtering:** Includes adversarial content scrubbing and DLP secret masking at every LLM boundary. A dedicated lesson ContentType ensures precise vector retrieval.
  - **Drift Detection:** A self-cleaning sync engine purges orphaned vectors when source files are deleted. Path containment checks and ingestion hardening establish firm trust boundaries.

### 2. The CLI (`@mmnto/cli`)

All commands feature proper `--help` output documentation.

- **Setup & Infrastructure:**
  - **Initialization:** Scaffolds configs, hooks, and tools with an onboarding workflow. It supports a bare flag, ordered provider detection, and local configuration ingestion.
  - **Environment Support:** Package manager auto-detection natively supports Bun and non-bash terminals. Dynamic imports reduce startup time while strict process management prevents execution hangs.
  - **Error Handling & Wiring:** Implements typed error domains with standard cause chains. Dependency injection standardizes logging, and a system library enforces safe execution boundaries.
- **Data & Context Management:**
  - **Indexing & Sharing:** Commands crawl, chunk, and embed targets into LanceDB. It supports cross-totem queries via linked configs and local lesson sharing between repositories.
  - **Project Discovery:** Dedicated describe commands and tools provide full repository understanding for orchestration. State capture commands emit snapshots using structured validation formats alongside Markdown.
  - **Workflow Resets:** Automates mid-session resets and end-of-task workflows. Execution aborts cleanly and manages exit codes if compilation requirements are missing.
- **Workflow & Evaluation:**
  - **Planning & Orchestration:**
    - _Workflows:_ Orchestrates tasks with human approval gates. It supports configurable issue sources and mandatory execution verification.
    - _Automation:_ Structures capabilities using directory-based skill files to scope execution context. Automation removes stale commands for a leaner toolset.
    - _Hooks:_ Enforces lifecycle events via verification hooks. Phase-gate enforcement actively blocks commits lacking proper preflight checks.
  - **Review & Quality:**
    - **`totem lint`**: Runs compiled rules against diffs. Zero LLM, fast, and recommended for pre-push hooks and CI organically supporting SARIF outputs.
    - **`totem review`**: Conducts AI-powered code review using LanceDB context before PRs. It enriches context with full file contents for small files and supports audited bypass flags.
    - **`totem explain`**: Looks up the specific lesson behind a rule violation to provide immediate developer context.
  - **Documentation:** Automates transactional document syncs using a validator to prevent partial updates. It actively strips known-not-shipped references from generated content.
  - **Telemetry & Triage:** A categorized triage inbox maps finding severities directly. The trap ledger maintains append-only telemetry locally, allowing the system to automatically downgrade noisy rules and archive stale data.
- **Rule Testing & Extraction:**
  - **Capture & Extraction:** Enables inline capture and batch lesson extraction strictly validated before disk writes. A retirement ledger tracks intentionally removed lessons to prevent re-extraction.
  - **Harness Verification:** Serves as a compiled rule testing harness to measure regex false positives. It includes inline hit/miss verification examples for rule unit testing.
  - **Security:** Context-aware heuristics minimize false positives and block bad rules. XML tagging guards against prompt injection from untrusted PR comments.

### 3. Deterministic Compiler & Zero-LLM Lint

`totem lesson compile` translates structural constraints into rules. It incorporates a strict lesson file linter acting as a pre-compilation gate to ensure structural integrity. A self-suppression guard actively rejects patterns that match engine suppression directives. The compilation process integrates manifest signing to establish a secure provenance chain.

**Compound ast-grep rules.** Beyond flat single-pattern matchers, compiled rules can carry full `NapiConfig`-shape structural rules in an `astGrepYamlRule` field. Compound rules express containment relationships using `inside`, `has`, and `not` combinators, eliminating the structural false positives that flat patterns produce when they cannot encode "inside a loop", "empty catch", or "outside an import statement". The schema enforces mutual exclusion between flat (`astGrepPattern`) and compound (`astGrepYamlRule`) shapes, and the manifest hash uses a canonical key-sorted serialisation so semantically-identical compound rules produce byte-identical hashes regardless of LLM key order.

**Compile-time smoke gate.** Every Pipeline 2 (LLM-from-prose) and Pipeline 3 (example-based) rule MUST emit a `badExample` snippet alongside the rule. The compile gate runs the freshly-built rule against this snippet using the same engine entry points the runtime uses (`matchAstGrepPattern` for ast-grep, `new RegExp` for regex). Rules that fail to match their own bad example are rejected before they land in `compiled-rules.json`. This is Defense-in-Depth Layer 2: the schema rejects malformed structures at parse time, and the smoke gate rejects semantically-broken rules at compile time, so a rule cannot reach lint enforcement unless it both parses correctly AND demonstrably matches the pattern its prompt promised.

The compiler supports manual pattern definitions and reverse-compiles curated rules. It includes a backfill of body text for 938 core architectural lessons to enrich rule context. An integrated WASM ast-grep engine targets complex imports and restricted properties alongside regex capabilities. These AST query engines implement graceful degradation and strictly manage process exits. Rules are stored in `.totem/compiled-rules.json`, extended with advanced telemetry fields.

The compilation process reads files directly from disk instead of parsing staged diffs to prevent false positives. It also supports an `--upgrade <hash>` flow path that targets a specific rule, evicts it from the cache, and recompiles it through Sonnet using telemetry-driven directives. Developers can bypass false positives using audited inline suppression directives. Rules are scoped using anchored glob matching to prevent leaks outside specified directories. The system relies on a curated 455-rule set for baseline enforcement.

`totem lint` applies these compiled rules against additions with zero LLM calls. It shares a core execution engine with review commands for execution consistency. This process supports importing external configurations natively, translating flat configuration structures into deterministic rules without LLM usage. It also permits direct cross-repository rule sharing.

**Unified Findings Model:** All violations are normalized into a canonical model. This ensures consistent severity mapping across engines and supports finding deduplication:

- **Lint:** `error` → `error`, `warning` → `warning`
- **Shield:** `CRITICAL` → `error`, `WARN` → `warning`, `INFO` → `info`

It generates standard SARIF 2.1.0 or JSON formatted outputs to enable security integration.

### 4. Lint GitHub Action & CI Drift Gate

A composite GitHub Action runs `totem lint` as a pass/fail CI quality gate. It is validated across a cross-platform CI matrix covering Ubuntu, Windows, and macOS. It uses compiled AST/regex rules from `.totem/compiled-rules.json` to block architectural traps. The SARIF 2.1.0 output natively integrates with the GitHub Advanced Security tab.

Deterministic CI enforcement is further strengthened by evaluating continuous automated codebase review sentinels:

- **Quality & Security:** SonarQube Community Edition and GitHub CodeQL v4.
- **Dependencies:** Dependabot.
- **Code Review:** CodeRabbit.

The CI pipeline features a structural drift gate, a manifest attestation gate, and an adversarial evaluation harness. It utilizes CI wind tunnel SHA locks to maintain fixture integrity during evaluation.

To prevent pipeline lockouts, the local pre-push gate requires CLI installation and relies strictly on `totem lint`. Because `totem lint` operates purely on deterministic rules, it requires zero LLM API calls. This eliminates statistical hallucinations in CI.

### 5. Pack Ecosystem (`@mmnto/pack-*`)

Packs distribute compiled rules and extension surfaces across the Totem ecosystem under the `@mmnto` npm scope. The architecture follows ADR-085 (Pack Ecosystem), ADR-091 (Ingestion Pipeline Refinements), and ADR-097 (Pack Language Archetype).

- **Distribution Model:**
  - **Namespace:** All canonical packs live under the `@mmnto` npm scope. Packs install via `pnpm add @mmnto/pack-<name>` plus `extends: ['@mmnto/pack-<name>']` in `totem.config.ts`.
  - **Rule Substrate:** Each pack ships a sealed `compiled-rules.json`. Rules can be marked `immutable` (severity locked at distribution time, declined by `pack-merge` if a downstream tries to downgrade) or `pending-verification` (status awaits empirical Stage 4 validation in the consuming repo).
  - **Pack Discovery:** `loadInstalledPacks()` (exported from `@mmnto/totem` since 1.22.0) reads `installed-packs.json` and synchronously registers each pack's contributions per ADR-097 § 5 Q5. The `bootstrapEngine(config, projectRoot)` helper (`packages/cli/src/utils/bootstrap-engine.ts`, 1.25.0+) wires this into the CLI lint, shield, compile, and test-rules paths and seals the engine after registration via `isEngineSealed()`.

- **Pack Categories:**
  - **Security packs:** `@mmnto/pack-agent-security` ships immutable rules covering unauthorized process spawning, dynamic code evaluation, network exfiltration, and obfuscated string assembly. Severity is locked.
  - **Language architecture packs:** Per ADR-097 the canonical archetype is `@mmnto/pack-<lang>-architecture`. `@mmnto/pack-rust-architecture` is the first non-trivial third-party consumer; it bundles `tree-sitter-rust.wasm` from `@vscode/tree-sitter-wasm` and registers via the dual-channel pattern (`api.registerLanguage` for the WASM substrate plus `napi.registerDynamicLanguage` for the napi-side runtime).
  - **Bot operations packs:** Per Proposal 248 the per-bot interpretive layer ships as packs (`@mmnto/pack-bot-coderabbit`, `@mmnto/pack-bot-gemini-code-assist`). Vendor-drift isolation is the load-bearing reason. v0.1 stubs sit in `pack-staging/` pending the Pack Ecosystem Graduation arc.

- **Bootstrap Semantics (ADR-091 § Bootstrap):**
  - **`pending-verification` install→lint promotion:** Pack rules ship with `status: 'pending-verification'`. The first `totem lint` run after installation runs them through the Stage 4 verifier and persists outcomes to a committable `.totem/verification-outcomes.json` (canonical-key-order via shared `canonicalStringify`).
  - **Public Bootstrap API (1.24.0+):** `promotePendingRules`, `applyOutcomeToRule`, `readVerificationOutcomes`, `writeVerificationOutcomes`, schemas in `verification-outcomes.ts`. CLI exports `stampPackRulesAsPending` plus `PACK_INSTALL_ACTIVATION_MESSAGE`.
  - **Status enum:** `CompiledRule.status` is one of `'active' | 'archived' | 'untested-against-codebase' | 'pending-verification'`.

- **Fixed-Group Cohort Invariant:** Packs released under the same fixed-group cohort (currently `@mmnto/cli`, `@mmnto/totem`, `@mmnto/mcp`, `@mmnto/pack-agent-security`, `@mmnto/pack-rust-architecture`) MUST NOT declare a fixed-group sibling as a peerDependency. Doing so produces a major-version wiggle on Version Packages auto-PRs. Test invariant locked at `packages/pack-rust-architecture/test/structure.test.ts`.

### 6. The MCP Server (`@mmnto/mcp`)

A stdio-based server for LLM integration providing primary tools and strict access boundaries:

- **Core Tools:**
  - **Search:** Semantic retrieval of codebase context scoped via boundary parameters. Telemetry actively measures agent retrieval behaviors.
  - **Knowledge:** Appends lessons with descriptive headings. Employs a sync-pending debounce mechanism and filesystem locks to prevent write race conditions.
  - **Enforcement:** Direct check tools empower agents to self-validate deterministic rules. This includes execution verification capabilities to test generated code against invariants.
- **Security & Permissions:**
  - **Sanitization:** XML-delimits all MCP responses and sanitizes persisted content. It strips quotes from loaded environment variables.
  - **Access Control:** Implements an authentication model with strict trust boundaries and explicit payload capacity caps. This prevents unbounded memory consumption.
  - **Context Limits:** Agent instruction files are structurally governed using a recency sandwich pattern. Strict length limits and a lean root router pattern maintain context focus.
- **Integrations & Lifecycle:**
  - **IDE Hooks:** Agent hooks exist for Claude Code, Gemini CLI, and Junie. Integrates deep workflow automation.
  - **Session Management:** Utilizes a health check first-query gate to prevent silent search failures at startup. It advises users to rebuild when indexes are broken.
  - **Stability:** Reaps zombie MCP processes via heartbeat timeouts to resolve connection failures. Handles dimension mismatches dynamically during retrieval queries.

## Configuration Tiers

Totem supports three explicit capability tiers, auto-detected from the environment during `totem init`. The available command list is audited to prune stale tasks and preserve a streamlined interface:

| Tier         | Requirements                               | Available Commands                                                                                                                |
| ------------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| **Lite**     | Zero API keys                              | `init`, `hooks`, `add-lesson`, `link`, `install`, `rule promote`, `eject`, `lint`, `compile`, `test`, `explain`, `handoff --lite` |
| **Standard** | Embedding key (`OPENAI_API_KEY` or Ollama) | Lite + `sync`, `search`, `stats`, `doctor`                                                                                        |
| **Full**     | Embedding + Orchestrator                   | All commands (`spec`, `review`, `triage`, `handoff`, `extract`, `docs`, `proposal new`, `adr new`)                                |

A lite-tier standalone WASM binary provides core CLI functions with zero native dependencies. The embedding field in configuration files is optional; when omitted, operations default to the Lite tier boundary constraints.

## Orchestrator Providers

The CLI orchestrator supports multiple provider types via a discriminated union config. SDKs for native API providers load dynamically at runtime with auto-detecting install prompts.

### Shell Provider (default)

Pipes prompts to any CLI tool via placeholders. Handled timeouts and strict taskkill mitigations ensure processes do not cause memory leaks:

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

Direct SDK calls using the standard OpenAI-compatible format. Defaults to `gpt-5.4-mini` for execution capabilities:

```typescript
orchestrator: {
  provider: 'openai',
  defaultModel: 'gpt-5.4-mini',
}
```

### Ollama Provider (native API)

Direct SDK integration for local, offline orchestration via Ollama. Auto-detects instances natively supporting dynamic context length management with a `gemma4` default:

```typescript
orchestrator: {
  provider: 'ollama',
  defaultModel: 'gemma4',
}
```

### Gemini Provider (native API)

Direct SDK calls via Google GenAI. Requires API keys and adheres to bound consent safety rules:

```typescript
orchestrator: {
  provider: 'gemini',
  defaultModel: 'gemini-2.5-flash',
  fallbackModel: 'gemini-2.5-pro',
}
```

### Anthropic Provider (native API)

Direct SDK calls via Anthropic. Token limits are managed dynamically to optimize usage for smaller models:

```typescript
orchestrator: {
  provider: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
}
```

### Shared Configuration

All orchestrator providers support standardizing complex configurations via centralized logic:

- **Routing & Resolution:** Centralized provider routing prioritizes explicit model flags over overrides and defaults. Supports cross-provider fallback configurations.
- **Customization:** Supports system prompts for per-command instructions and cache TTLs for performance tuning.
- **Resilience:** Implements graceful degradation by falling back from native SDKs to the CLI provider if primary execution fails. Legacy configs auto-migrate to the shell provider.

## The `.totem/` Directory

The `.totem/lessons/` directory acts as an explicit version-controlled ledger of architectural decisions. Extracted lessons are safely strictly validated, auto-committed, and automatically re-indexed during syncs.

Users are offered an optional Universal Baseline during initialization. These foundational lessons feature audience tags and include fix guidance to resolve architectural violations. Language packs proactively provide baseline lessons tailored for specific programming environments. This solves the cold-start problem where a fresh install has no initial knowledge to retrieve.

## The Strategy Repo (Configurable Root)

For secure collaboration, proprietary guidelines and sensitive orchestration instructions are isolated in a sibling `totem-strategy` repository. It houses deep research, ADRs, proposals, and journal entries without encumbering the distributable core codebase. The strategy repo runs its own Totem instance to enforce rules specifically within its domain.

Totem surfaces consult the strategy repo via `resolveStrategyRoot` (`packages/core/src/strategy-resolver.ts`) which walks four precedence layers: `TOTEM_STRATEGY_ROOT` env var (`STRATEGY_ROOT` accepted as a legacy alias) → `totem.config.ts:strategyRoot` field → sibling clone at `../totem-strategy/` → legacy `.strategy/` submodule. The first layer that resolves to a real directory wins. Each consumer surface (MCP `describe_project`, governance scaffolding, federated search, bench scripts, `totem doctor`) handles unresolvable state with actionable graceful degradation rather than silent failure. See `CONTRIBUTING.md` for the recommended sibling-clone setup.

## Scope & Limitations

Totem enforces **architectural invariants** — structural rules about what code patterns must or must not exist. It is important to understand what Totem does and does not do:

**What Totem does:**

- Blocks known-bad code patterns at the AST level (pre-commit, pre-push, CI)
- Enforces structural boundaries ("never import from legacy auth module")
- Detects violations of compiled configurations and lesson-derived invariants
- Generates SARIF telemetry for compliance dashboards

**What Totem does NOT do:**

- **Runtime analysis:** Cannot detect race conditions, memory leaks, or runtime state bugs. It operates purely on static source code.
- **Cross-file taint analysis:** Data flow tracking for SQL injection or XSS is outside Totem's scope. Use dedicated DAST or SAST tools for these vulnerabilities.
- **Symbolic execution:** The lint command is deterministic and not a formal prover. It does not mathematically prove code correctness.
- **Probabilistic assurances:** The vector search layer uses fuzzy embeddings for discovery, while enforcement uses strict deterministic matching. These are separate concerns.

Totem is a fast, deterministic pre-commit check that catches structural violations. It complements, not replaces, broad security tooling.
