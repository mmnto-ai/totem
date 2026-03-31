# Totem — Governance OS for AI Coding Agents: Comprehensive Architectural Brief

> **Audience:** Frontier AI models onboarding to this codebase. Read this before touching any code.

---

## 1. What Totem Is (and Is Not)

Totem is **not** a web application. It is a **Governance Operating System** — a standard library of deterministic building blocks that converts institutional knowledge (plain-English markdown lessons) into physical enforcement constraints that block bad code from ever reaching a repository, regardless of whether the author is a human developer or an AI agent.

The central thesis: **Documentation is a suggestion. Compiled rules are physical constraints.** A `CLAUDE.md` that says "use lazy imports" will be ignored. A regex rule in `compiled-rules.json` that blocks static imports in CLI files *cannot* be ignored without an audited, logged exemption.

The system self-describes as a **Codebase Immune System**: it watches, learns, and hardens.

---

## 2. Monorepo Architecture

```
packages/
├── core/          (@mmnto/totem)   — The Knowledge Engine
├── cli/           (@mmnto/cli)     — The Command Surface
└── mcp/           (@mmnto/mcp)     — The Agent Interface
```

The dependency graph is **strictly layered and unidirectional**: `cli` and `mcp` both depend on `core`, but `core` depends on neither. This boundary is enforced by compiled rules within the repo itself.

### 2.1 `packages/core` — The Knowledge Engine

This is the **pure domain model**. It has no CLI, no I/O beyond file reads, and no LLM calls. It is the only package consumed by `mcp` or exported to consumers.

**Key modules:**

| Module | Responsibility |
|---|---|
| `compiler.ts` | Hashing (`hashLesson`), regex validation with ReDoS protection (`safeRegex2`), JSON file I/O for compiled rules, LLM response parser (`parseCompilerResponse`) |
| `compiler-schema.ts` | Zod schemas: `CompiledRuleSchema`, `CompiledRulesFileSchema`, `CompilerOutputSchema`, `Violation`, `DiffAddition` |
| `compile-lesson.ts` | Pure business logic for single-lesson compilation. Has two pipelines: **Pipeline 1** (manual pattern, zero LLM) and **Pipeline 2** (LLM synthesis). |
| `rule-engine.ts` | `applyRulesToAdditions()`, `applyAstRulesToAdditions()` — zero LLM, pure regex/AST matching against `DiffAddition[]`. Also owns inline suppression parsing (`totem-ignore`, `totem-context:`, `totem-ignore-next-line`). |
| `drift-detector.ts` | Parses `## Lesson —` headings from lessons.md, extracts file path references, detects orphaned refs when source files no longer exist. |
| `ledger.ts` | Append-only event stream at `.totem/ledger/events.ndjson`. Records `suppress`, `override`, and `exemption` events from lint/review. Used by `totem doctor` for self-healing. |
| `ingest/pipeline.ts` | Full sync pipeline: resolves files → chunks (AST or Markdown heading strategy) → sanitizes → embeds in batches of 100 → stores in LanceDB. Supports incremental sync via git diff. |
| `store/lance-store.ts` | LanceDB wrapper. Exposes `search()` (hybrid FTS + vector), `searchFts()` (FTS-only fallback), `insert()`, `deleteByFile()`, `healthCheck()`, `connect()`, `reconnect()`. |
| `sanitize.ts` | Two distinct sanitization concerns: (1) **terminal sanitization** (strips ANSI/BiDi overrides for CLI display), (2) **adversarial ingestion scrubbing** (strips invisible Unicode, detects `INSTRUCTIONAL_LEAKAGE_RE`, `XML_TAG_LEAKAGE_RE`, `BASE64_BLOB_RE` before embedding). |
| `suspicious-lesson.ts` | `flagSuspiciousLessons()` — heuristic scanner for prompt injection indicators in extracted lessons. Uses `isInstructionalContext()` to suppress false positives (e.g., a lesson *about* prompt injection shouldn't itself be flagged). |
| `secrets.ts` | DLP: loads user-defined secrets from `totem.config.yaml` and `.totem/secrets.json`, validates against `CustomSecretSchema`. `maskSecrets()` applied at every LLM boundary before any external call. |

**Critical constraint:** `core` never calls an LLM. The `compileLesson()` function in `compile-lesson.ts` takes a `runOrchestrator` *callback* injected by the CLI — `core` itself is LLM-agnostic.

### 2.2 `packages/cli` — The Command Surface

This is the **orchestration layer**. It owns all CLI commands, user-facing I/O, hook installation, and agent integration templates. It wires `core` functions together with real I/O and LLM calls.

**Command taxonomy:**

| Category | Commands | Key Notes |
|---|---|---|
| **Setup** | `init`, `hooks`, `eject`, `install-hooks` | Scaffolds `totem.config.ts`, git hooks, AI agent configs. `init` auto-detects ecosystem and embedding tier. |
| **Knowledge Capture** | `extract`, `add-lesson`, `lesson` | `extract <PR>` reads PR review comments → calls LLM → writes `.totem/lessons/`. |
| **Compilation** | `compile` | Reads all lessons → **Pipeline 1** (manual pattern, instant) → **Pipeline 2** (LLM, concurrent batches). Writes `compiled-rules.json` + `compile-manifest.json` (provenance chain). |
| **Enforcement** | `lint` | Zero-LLM. Runs `runCompiledRules()` against `git diff`. Supports SARIF/JSON output. Can post PR comments. |
| **AI Review** | `shield`, `review-learn` | LLM-powered code review using LanceDB context. Distinct from `lint` — uses the AI as a reviewer, not as an enforcement engine. |
| **Indexing** | `sync`, `search` | `sync` triggers the `ingest/pipeline.ts`. `search` queries LanceDB directly for human use. |
| **Self-Healing** | `doctor`, `ledger-analyzer` | Reads `.totem/ledger/events.ndjson`, calculates bypass rates, downgrades noisy rules via PR. |
| **Planning** | `spec`, `triage`, `briefing`, `handoff` | LLM-powered commands for session management. `briefing` is injected into agent startup hooks. |

**`hooks/auto-context.ts`:** Injected into Claude Code / Gemini CLI session start hooks. Parses the current git branch name, derives a semantic query (e.g., `feat/1095-session-start-v2` → `"1095 session start v2"`), and pre-loads the top-N relevant chunks from LanceDB before the agent writes a single line of code.

**Three configuration tiers** (auto-detected by `getConfigTier()`):

| Tier | Requirement | What works |
|---|---|---|
| **Lite** | Zero API keys | `lint`, `compile`, `add-lesson`, basic hooks |
| **Standard** | Embedding key | +`sync`, `search`, `stats`, `doctor` |
| **Full** | Embedding + Orchestrator | All commands |

### 2.3 `packages/mcp` — The Agent Interface

A **stdio-based MCP server** (Model Context Protocol) that exposes the LanceDB index and enforcement engine to AI agents as structured tools.

**Four registered tools:**

| Tool | Description | Key Design Decision |
|---|---|---|
| `search_knowledge(query, boundary?)` | Semantic search over the LanceDB index. Supports `boundary` param to scope to a named partition (`core`, `cli`, `mcp`) or raw path prefix. | First-query health gate: detects dimension mismatches before crashing with a cryptic LanceDB error. Wraps all responses in `<totem_knowledge>` XML tags to prevent prompt injection. |
| `add_lesson(heading, tags, body)` | Appends a new lesson to `.totem/lessons/`. Triggers background re-sync. | Description deliberately includes `"CRITICAL: Call search_knowledge first to check for duplicates."` — protocol-in-description pattern. |
| `verify_execution(staged_only?)` | Spawns `totem lint` as a child process with 30s timeout. Returns PASS/FAIL with violations. | Described as: `"Call this BEFORE declaring a task complete."` This is the AI's equivalent of the human pre-push hook. |
| `describe_project()` | Returns a high-level summary of the project from LanceDB. | Used by agent startup scripts for orientation. |

**`context.ts`:** The singleton server context. Lazily initializes on first tool call: loads `totem.config.ts` via `jiti` (runtime TS execution), resolves the embedder, opens LanceDB. Uses promise memoization to prevent concurrent init races. Exposes `reconnectStore()` for stale-handle recovery after a `totem sync --full`.

---

## 3. The Knowledge Flywheel

This is the core loop that converts a PR mistake into a permanent physical constraint:

```
PR Review (human/bot nit)
        ↓
  totem extract <PR>          ← LLM call #1 (lesson synthesis)
        ↓
 .totem/lessons/lesson-<hash>.md  ← plain English, version controlled
        ↓
  totem compile               ← LLM call #2 (rule synthesis)
        ↓
 .totem/compiled-rules.json   ← deterministic regex/AST, LLM now out of the loop
 .totem/compile-manifest.json ← provenance: input_hash, output_hash, model, timestamp
        ↓
  git push (pre-push hook)
        ↓
  totem lint (ZERO LLM)       ← pure regex/AST against git diff
        ↓
  BLOCK or PASS
```

### 3.1 The Compilation Pipeline in Detail

`compile-lesson.ts` → `compileLesson()` runs two sequential pipelines per lesson:

**Pipeline 1 — Manual Pattern (Zero LLM, instant):**
If the lesson body contains an explicit `Pattern:` field (e.g., `` Pattern: `import \{ execSync \}` ``), the compiler extracts it directly without any LLM call. This is the **preferred, deterministic path**. ADR-065 requires that manually specified `error`-severity rules have a test fixture in `.totem/tests/` or they are downgraded to `warning`.

**Pipeline 2 — LLM Synthesis:**
If no manual pattern exists, the lesson body is sent to the configured orchestrator with `COMPILER_SYSTEM_PROMPT`. The LLM returns a structured JSON blob (`CompilerOutput`), validated via `CompilerOutputSchema`. Three outcomes:
- `compilable: false` → lesson is marked non-compilable and cached (architectural/conceptual lessons that have no syntactic fingerprint)
- `compilable: true, engine: "regex"` → Regex validated by `safe-regex2` for ReDoS risk
- `compilable: true, engine: "ast" | "ast-grep"` → AST query validated for structural integrity

**Idempotency via content hashing:** `hashLesson(heading, body)` produces a 16-char SHA-256 prefix. If the hash already exists in `compiled-rules.json`, the lesson is skipped. If a lesson's content changes, its hash changes, forcing recompilation and pruning the old rule.

**Compile manifest (provenance chain):** After every compile, `compile-manifest.json` stores `input_hash` (hash of all lesson files) and `output_hash` (hash of `compiled-rules.json`). `totem lint` checks this manifest at startup and warns if it's stale. The CI pipeline has a dedicated manifest attestation gate.

### 3.2 How `totem lint` Enforces (Zero LLM)

`runCompiledRules()` (shared by both `lint` and `review`) operates as follows:

1. Calls `getDiffForReview()` to obtain the unified diff string (staged changes or branch diff)
2. Passes the diff to `extractAddedLines()` → produces `DiffAddition[]` (file, line text, line number, preceding line, optional AST context)
3. **Regex engine** (`applyRulesToAdditions()`): For each `regex` rule, compiles the pattern and tests each addition line. Skips lines with non-code AST context (strings, comments) to prevent false positives.
4. **AST engine** (`applyAstRulesToAdditions()`): For `ast` (Tree-sitter S-expression) and `ast-grep` rules, groups additions by file, parses once, and runs all applicable queries in a batch.
5. **Inline suppression**: Before flagging any match, checks `isSuppressed()` — if the line or preceding line contains `totem-ignore`, `totem-ignore-next-line`, or `totem-context: <reason>`, the violation is logged to the Trap Ledger as a `suppress` event instead of a `Violation`.
6. Output is formatted as text/SARIF/JSON. Exit code 1 = violations found.

---

## 4. Core Design Philosophy

Reconstructed from `README.md`, `COVENANT.md`, `docs/architecture.md`, and the embedded `AI_PROMPT_BLOCK`.

### 4.1 Platform of Primitives, Not Opinionated Workflows

> *"We do not force you into a rigid, 7-step AI methodology. We provide the Sensors (the knowledge index, the deterministic compiler). You are the Flight Controller. You decide where to put the Actuators (Git hooks, IDE plugins)."*

Every CLI command supports `--json` output for piping into custom automation. `totem lint` is a pass/fail binary that you wire wherever you want (pre-push, CI, IDE save). Nothing in Totem requires you to use the full workflow.

### 4.2 Sensors vs. Actuators

| Sensors (Totem provides) | Actuators (you wire them) |
|---|---|
| LanceDB index (`search_knowledge`) | `pre-push` git hook |
| `compiled-rules.json` (the rules) | GitHub Actions CI gate |
| Compile manifest (provenance) | Claude `PreToolUse` hook |
| Trap Ledger (bypass telemetry) | `verify_execution` MCP call |

Totem ships the LEGO bricks. You decide the architecture.

### 4.3 Local-First / Zero-API-Keys for Enforcement

`totem lint` runs with **zero network calls, zero API keys, zero LLM**. The enforcement binary works completely offline. This is a hard invariant — `totem lint` must never call an external API.

The LLM is only involved at **compile time** (a developer-controlled, infrequent event), never at **lint time** (a high-frequency, automated event on every push).

### 4.4 Determinism at the Gate

Every enforcement decision is **mathematically reproducible**. Given the same `compiled-rules.json` and the same `git diff`, `totem lint` always produces the same output. This eliminates the hallucination risk that makes AI-based linters unreliable in CI.

### 4.5 Fail Fast, Fail Loudly

A partial context assembly (e.g., some lessons compiled, some not) is treated as a failure to be escalated, not silently skipped. The CLI uses typed `TotemError` subclasses for every error class with both a message and a remediation hint.

### 4.6 Mistake → Physical Law (60-second loop)

The primary value proposition is the extraction-to-enforcement velocity. A PR review nit that takes 60 seconds to extract, compile, and enforce is **permanently gone from the project's future**. The system is designed so a single developer can govern an AI agent fleet by converting past mistakes into rules rather than writing more documentation.

### 4.7 Open Core Covenant (Trust through Openness)

Single-repo enforcement is Apache 2.0, free forever. Enterprise federation (cross-repo RBAC, centralized manifest signing, immutable audit) is commercial. This trust gradient is by design: the enforcement engine must be inspectable by users because it reads their code.

---

## 5. Actor-Aware Enforcement

Totem differentiates sharply between its two actor types. Both hit the same `compiled-rules.json`, but through different channels with different latency and security profiles.

### 5.1 Human Developers — Fast, Stateless, Hook-Based

The human path is optimized for speed and minimal friction:

**Pre-push hook (installed by `totem install-hooks`):**
```sh
# Resolve totem command — prefer local workspace build
if command -v totem >/dev/null 2>&1; then
  TOTEM_CMD="totem"
# ...
fi
$TOTEM_CMD lint
```

Characteristics:
- **Stateless**: Each invocation reads `compiled-rules.json` fresh, no daemon, no server.
- **<2 seconds**: Pure regex/AST against the current `git diff`. No network.
- **Escapable but audited**: `// totem-ignore` or `// totem-context: <reason>` suppresses a rule but logs an event to the Trap Ledger. Every bypass is recorded.
- **Self-healing feedback loop**: Trap Ledger accumulates bypass events → `totem doctor --pr` aggregates them → opens a PR automatically downgrading rules with >30% bypass rate. The system learns which rules are too strict without human intervention.

### 5.2 AI Agents — Strict Execution Boundaries with Multiple Enforcement Layers

AI agents face a **defence-in-depth** model with 4 distinct enforcement layers:

#### Layer 1: Turn-1 Context Injection (Proactive Prevention)

Via `hooks/auto-context.ts` wired into agent startup hooks:
- **Gemini CLI**: `.gemini/hooks/SessionStart.js` runs `totem briefing` and writes output to `stderr` before the agent's first action.
- **Claude Code**: Auto-context is injected via the `PreToolUse` hook at session start.

The briefing includes live state: current branch, uncommitted files, manifest staleness, recent lessons as "Tactical Reflexes." The agent is forced to process this before writing code.

#### Layer 2: Behavioral Constraints via `AI_PROMPT_BLOCK` (Soft Protocol)

`totem init` injects an `AI_PROMPT_BLOCK` (versioned, idempotent, upgradeable via `REFLEX_VERSION`) into `CLAUDE.md`/`GEMINI.md`. This block defines **mandatory reflexes**:

```
BLOCKING — Pull Before Coding: Before writing or modifying code that touches
more than one file, you MUST call `search_knowledge` with a query describing
what you're about to change. This is not optional.
```

Three hard triggers for `add_lesson` (Trap, Pivot, Handoff Triggers) ensure agents self-annotate their discoveries into the shared memory.

Classification rules tell the agent where to store different types of information (LanceDB for domain traps, CLAUDE.md for global safety rules, styleguide for syntax conventions).

#### Layer 3: PreToolUse Hook (Interception at Tool Call)

**Claude Code** (`CLAUDE_PRETOOLUSE_ENTRY`):
```json
{
  "matcher": "Bash",
  "hooks": [{ "type": "command", "command": "node .totem/hooks/shield-gate.cjs" }]
}
```
The hook fires on every `Bash` tool call. If the bash command includes `git push` or `git commit`, it runs `totem lint` synchronously. Exit code 1 from lint causes `process.exit(1)`, which Claude Code interprets as the tool failing, blocking the push.

**Gemini CLI** (`GEMINI_BEFORE_TOOL`):
```js
module.exports = function beforeTool(toolName, toolInput) {
  if (toolName !== 'run_shell_command') return;
  // Dual-grep: catch both plain text and JSON-encoded arguments
  if (!/git\s+(push|commit)/.test(cmd) && !/["']git["'].*["'](push|commit)["']/.test(cmd)) return;
  execSync('totem lint', { stdio: 'inherit' }); // throws on failure
};
```

#### Layer 4: `verify_execution` MCP Tool (Post-Task Gate)

The MCP tool `verify_execution` is described to the agent as:
> *"Run deterministic lint checks against your current changes to mathematically verify no project rules were violated. Call this BEFORE declaring a task complete."*

Unlike the human's pre-push hook (which is hard to bypass without `--no-verify`), this tool is **voluntary but described as mandatory**. The `AI_PROMPT_BLOCK` reflexes and the tool description both reinforce calling it. An agent that declares "task complete" without calling `verify_execution` is violating its explicit protocol.

The tool spawns `totem lint` as a child process with a 30s timeout, captures stdout/stderr, and returns `isError: true` when lint fails. The agent receives a `FAIL` result with specific violations and is expected to fix them.

#### Agent-Specific Content Hashing (Compile Manifest)

When cloud compilation is used (`totem compile --cloud`), secrets are masked via `maskSecrets()` before any lesson content leaves the machine. The resulting `compile-manifest.json` records `input_hash` (deterministic hash of all lesson files), `output_hash` (hash of `compiled-rules.json`), model used, and timestamp. This creates a cryptographic provenance chain that CI can verify independently.

---

## 6. Data Flow Summary

```
┌────────────────────────────────────────────────────────────┐
│  LESSON SOURCES                                             │
│  .totem/lessons/*.md  ←  totem extract <PR>               │
│                       ←  MCP add_lesson()                  │
│                       ←  manual edit                       │
└────────────────────┬───────────────────────────────────────┘
                     │ totem compile (LLM synthesizes rules once)
                     ▼
┌────────────────────────────────────────────────────────────┐
│  COMPILED ARTIFACTS                                         │
│  .totem/compiled-rules.json  (regex/AST rules)            │
│  .totem/compile-manifest.json (input_hash → output_hash)  │
└─────────┬──────────────────────────────────────────────────┘
          │                    │
          │ totem lint         │ totem sync → .lancedb/
          │ (ZERO LLM)        │ (vector embeddings)
          ▼                    ▼
┌────────────────┐   ┌────────────────────────────────────┐
│  ENFORCEMENT   │   │  AGENT MEMORY                      │
│  pre-push hook │   │  MCP search_knowledge()           │
│  CI gate       │   │  hooks/auto-context.ts            │
│  PreToolUse    │   │  totem briefing                   │
│  verify_exec   │   │                                   │
└────────┬───────┘   └────────────────────────────────────┘
         │
         │ bypasses logged
         ▼
┌────────────────────────────────────────────────────────────┐
│  TRAP LEDGER                                                │
│  .totem/ledger/events.ndjson (bypass telemetry)           │
│         ↓ totem doctor --pr                               │
│  Autonomous rule downgrade PRs (>30% bypass rate)         │
└────────────────────────────────────────────────────────────┘
```

---

## 7. Key Files for Orientation

| File | Why It Matters |
|---|---|
| `totem.config.ts` | The root configuration. Defines targets, partitions, embedding tier, orchestrator, export paths. |
| `packages/core/src/compiler-schema.ts` | The canonical data model. `CompiledRule`, `Violation`, `DiffAddition` — everything flows through these Zod schemas. |
| `packages/core/src/rule-engine.ts` | The enforcement kernel. `applyRulesToAdditions()` is the innermost loop of `totem lint`. |
| `packages/core/src/compile-lesson.ts` | The compilation decision tree. Pipeline 1 (no LLM) vs Pipeline 2 (LLM). |
| `packages/cli/src/commands/init-templates.ts` | The `AI_PROMPT_BLOCK` — the behavioral constitution injected into every AI agent's memory. |
| `packages/mcp/src/tools/verify-execution.ts` | The AI agent's equivalent of the human pre-push hook. |
| `packages/mcp/src/tools/search-knowledge.ts` | The primary retrieval tool. Note the health gate and XML-wrapping for injection prevention. |
| `.totem/lessons.md` | Live example of the lesson corpus. Read this to understand the format and tone. |
| `docs/wiki/governing-ai-agents.md` | Product-level explanation of the entire agent governance model. |
| `docs/wiki/trap-ledger.md` | Explains the self-healing loop and `totem doctor` algorithm. |

---

## 8. Critical Traps for New Contributors

1. **Never call an LLM inside `packages/core`**. The `compileLesson()` function takes `runOrchestrator` as a *dependency injection parameter*. Core is LLM-agnostic.

2. **`totem lint` must never block on a network call**. If you add a check to `runCompiledRules()`, it must be purely computational.

3. **LanceDB DataFusion uses backticks for case-sensitive column quoting**, not SQL double-quotes. `` `filePath` `` not `"filePath"`. Double-quotes produce silent zero-match results.

4. **The `ledger/events.ndjson` is append-only**. Never rewrite it. `appendFileSync` is intentional — prevents interleaving in single-threaded CLI.

5. **Lesson hashes are the identity of rules**. If you change a lesson's heading or body, its hash changes, the old rule is pruned from `compiled-rules.json`, and the new lesson must be recompiled. This is intentional (content-addressed).

6. **`AI_PROMPT_BLOCK` has a version number (`REFLEX_VERSION`)**. When changing agent behavioral instructions, bump this version so `totem init` can detect and offer upgrades to existing installations.

7. **All MCP tool responses must be wrapped in XML tags** (`formatXmlResponse('knowledge', ...)`) to prevent the AI from treating retrieved content as continuation of its system instructions (indirect prompt injection).
