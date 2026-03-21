# Totem

**Stop repeating yourself to your AI.**

_AI coding agents are brilliant goldfish. Totem gives them a memory._

A zero-config CLI and MCP Server that compiles your project's architectural rules into deterministic CI guardrails. It creates a persistent, model-agnostic context layer that outlasts any single AI session — so Claude, Cursor, Gemini, and Copilot all enforce the same rules without being told twice.

Totem doesn't ship with your app. It lives in your workflow. It also works on non-code repositories — docs, ADRs, infrastructure configs, personal notes — via `totem init --bare`.

## The 10-Second Workflow

```bash
$ npx @mmnto/cli lint
PASS — 239 rules, 0 violations.

$ npx @mmnto/cli stats
Total violations prevented: 47 | security: 12, architecture: 35
```

Write code with your AI. Run `totem lint`. Push with confidence. Run `totem stats` to prove your ROI.

## Why Totem

- **Zero-LLM enforcement.** Compiled rules run in your git hooks with no API keys, no network, no AI in the loop. Works in air-gapped CI and locked-down enterprise environments.
- **Shared memory across repos.** `totem link` connects repos to a shared knowledge index. A lesson learned in your API repo automatically protects your frontend repo. One memory across your whole stack.
- **Works with any AI agent.** Claude, Gemini, Cursor, Copilot, Codex — Totem doesn't care who writes the code. It just gates the push.

## How It Works — The 3-Layer Gate

Your AI doesn't have to be obedient. It just has to push code.

| Layer          | Mechanism                               | Purpose                                                                                                                              |
| -------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Suggestion** | `.cursorrules`, `CLAUDE.md`, `.gemini/` | Ask the AI to follow the rules so it works faster                                                                                    |
| **Fast Path**  | `verify_execution` MCP tool             | Let the AI grade its own homework before pushing                                                                                     |
| **Guarantee**  | `pre-push` git hook → `totem lint`      | Deterministic gate. If the AI ignored Layer 1 and skipped Layer 2, it hits the wall of Layer 3 and cannot proceed until it complies. |

Totem doesn't try to control the agent in real-time. It enforces a strict final output state — like a compiler, not a linter.

## Works Without AI

Totem's enforcement layer is **100% deterministic** — no LLM, no API keys, no network required.

| Feature                          |  Requires AI?  |
| -------------------------------- | :------------: |
| `totem lint` (compiled rules)    |       No       |
| `totem init` (baseline rules)    |       No       |
| Pre-push git hook                |       No       |
| AST classification (Tree-sitter) |       No       |
| `totem sync` (vector index)      | Yes (embedder) |
| `totem compile` (rule authoring) |   Yes (LLM)    |
| `totem shield` (AI review)       |   Yes (LLM)    |
| `totem spec` (planning)          |   Yes (LLM)    |

The AI helps you **write** rules. The rules enforce themselves.

## Totem Mesh — Shared Memory Across Repos

Most governance tools are per-repo. Totem lets you connect repos into a shared knowledge mesh:

```bash
# In your frontend repo
totem link ../api-server
```

Now `totem spec` and `totem shield` in your frontend repo can query lessons from your API repo. An architectural mistake in one codebase becomes a rule protecting all others.

Configure cross-repo queries in `totem.config.ts`:

```typescript
linkedIndexes: ['../api-server', '../shared-design-system'],
```

## Context Isolation — Scoped Search per Architecture Layer

When multiple AI agents (or one agent across packages) share a knowledge index, you can restrict search results to specific boundaries. This prevents a frontend agent from hallucinating based on backend database schemas.

```typescript
// totem.config.ts
partitions: {
  core: ['packages/core/'],
  cli: ['packages/cli/'],
  mcp: ['packages/mcp/'],
},
```

Agents pass the partition name when searching:

```
search_knowledge({ query: "error handling", boundary: "mcp" })
```

Results are restricted to `packages/mcp/` files. Unknown boundary names fall back to raw path prefix matching. Partitions work alongside `linkedIndexes` — a boundary is just a scoped slice of knowledge, whether local or remote.

## Performance

`totem lint` runs **239 compiled rules in under 2 seconds** on a 7,400-line, 105-file PR. Zero LLM inference. Pure AST classification + regex matching.

| Metric         | Value                        |
| -------------- | ---------------------------- |
| Rules          | 239 (regex + AST + ast-grep) |
| Lines scanned  | 7,397                        |
| Files          | 105                          |
| Execution time | **1.75s**                    |
| LLM calls      | **0**                        |

This runs inside a `pre-push` git hook. Your AI agent's push is blocked until every violation is resolved — with the exact file, line, and fix guidance needed to self-correct in one cycle.

## Try It

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/mmnto-ai/totem-playground)

The [Totem Playground](https://github.com/mmnto-ai/totem-playground) is a pre-broken Next.js app with several common architectural violations. Open it in Codespaces, run `totem lint --staged`, and watch Totem catch every one.

Or run locally:

```bash
git clone https://github.com/mmnto-ai/totem-playground.git
cd totem-playground
git reset HEAD~1 && git add -A
npx @mmnto/cli lint --staged
```

## Quickstart

### 1. Initialize

```bash
npx @mmnto/cli init
```

Auto-detects your environment (Cursor, Copilot, Junie) and sets up `totem.config.ts`. You can also use `totem init --bare` to skip defaults and start with a clean slate.

Ships with an expanded baseline of **125 battle-tested lessons** extracted from PR reviews across major ecosystem tools:

- **Frameworks:** Next.js, React.
- **Data Layer:** Prisma, Drizzle.
- **Styling:** Tailwind.

Your project gets immediate protection against the most common architectural traps on Day 1. Existing `.cursorrules` or `.mdc` files are automatically ingested and compiled into deterministic rules during initialization.

### 2. Connect the MCP Server _(optional)_

> **Without MCP:** `totem lint`, `compile`, `extract`, `sync`, `explain`, and `stats` all work standalone. You get full deterministic enforcement and the complete CLI experience.
> **With MCP:** Your AI agent gains live access to the knowledge index mid-session. It can `search_knowledge` before writing code and `add_lesson` when it discovers traps.

Give your AI agent persistent project memory. `search_knowledge` retrieves traps, patterns, and architectural constraints with boundary parameters for scoped queries, while `add_lesson` captures new ones.

**macOS / Linux:**

```json
{
  "mcpServers": {
    "totem": {
      "command": "npx",
      "args": ["-y", "@mmnto/mcp"]
    }
  }
}
```

**Windows:**

```json
{
  "mcpServers": {
    "totem": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@mmnto/mcp"]
    }
  }
}
```

Works with any MCP-compatible agent, including:

- **Desktop Apps:** Claude Desktop.
- **Editors:** Cursor, Windsurf.
- **CLIs:** Claude Code, Gemini CLI.

### 3. Sync & Lint

```bash
npx @mmnto/cli sync    # Build the vector index
npx @mmnto/cli lint    # Run compiled rules (zero LLM)
```

During `init`, Totem prompts to install a `pre-push` git hook that runs `totem lint` automatically before every push. It drops a standard shell script into `.git/hooks/` to work alongside Husky or bare repos. Phase-gate enforcement additionally warns on commits without proper preflight. Run `totem hooks --check` to verify installation at any time.

## The Planning Pipeline

Before your AI writes a single line of code, `totem spec` builds a threat-modeled implementation plan:

```bash
$ npx @mmnto/cli spec 570
[Spec] Linked index: .strategy
[Spec] Querying Totem index...
[Spec] Found: 5 specs, 3 code, 0 lessons
```

`totem spec` fetches your issue, queries the knowledge index, and generates a straitjacket checklist complete with invariants and fix guidance. It tells your AI agent exactly what to build and what mistakes to avoid.

Cross-totem queries via `linkedIndexes` let the planner pull context from multiple projects simultaneously. Strategy docs can inform code decisions, while shared design systems inform component repositories.

## What Totem Actually Is

**A persistent memory that every AI agent shares.**

AI coding agents are brilliant but forgetful, often repeating architectural violations across sessions. Totem fixes this by creating a persistent memory layer that outlasts any single agent, model, or tool.

- **Compile:** Your `.cursorrules` and `.mdc` files are plain English. Totem compiles them into deterministic AST and regex checks via the Tier 2 AST engine.
- **Enforce:** `totem lint` is **100% deterministic** and runs compiled rules against your diff. It runs in ~2 seconds with zero API keys, and your CI passes or fails based purely on logic.
- **Learn:** Run `totem extract` to compile new invariants from PR bugs, ensuring specific mistakes can never be merged again. When a violation happens, use `totem explain` to instantly retrieve the underlying lesson.
- **Plan:** `totem spec` queries the knowledge index before your AI writes code, generating architectural invariants. The AI starts fully informed of past mistakes instead of starting blank.

**Totem doesn't replace your AI. It gives your AI a memory.**

## Switch Models Without Losing Context

Switching from Claude to Gemini or Copilot is seamless, as Totem's persistent memory outlasts any single AI session. It creates a model-agnostic layer that maintains your architectural rules everywhere.

- **Shared memory:** Lessons learned in one session are available to all agents via MCP.
- **Portable rules:** Rules compiled from Cursor are enforced in Claude Code's pre-push hook. The enforcement is entirely model-independent.
- **Cross-project knowledge:** Share local lessons between repositories using `totem link`. Query multiple knowledge bases simultaneously via `linkedIndexes`.
- **Prove ROI:** `totem stats` shows exactly how many violations were prevented. It tracks prevention regardless of which AI introduced the code.

Teach Totem once. It remembers forever.

## Enterprise Grade

Totem is architected for high-compliance sectors (defense, finance, healthcare).

- **Security & Compliance:**
  - **Fully Air-Gappable:** `totem lint` requires zero API keys and zero network access. With Ollama for embeddings, the entire pipeline runs without external API calls.
  - **DLP Secret Masking:** Automatically strips secrets before embedding. Credentials never leak into your vector index.
  - **SARIF 2.1.0 Output:** Integrates into CI security scanners via `--format sarif/json`. Prove SOC 2 / DORA compliance to your auditors.
  - **Execution Hardening:** Safeguards agent operations by enforcing capability caps and preventing injections. Incorporates phase-gate enforcement to actively warn on commits lacking preflight validation.
- **Reliability & Portability:**
  - **Concurrency Safety:** Filesystem concurrency locks ensure stable vector index syncs. They also guarantee safe simultaneous MCP mutations.
  - **Cross-Platform Readiness:** Backed by portability audits, Docker test harnesses, and automated CI reviews. Tested across Ubuntu, Windows, and macOS in every CI run.
  - **Index Stability:** Dimension mismatch detection via `index-meta.json` prevents database corruption. Auto-healing migrations handle embedder changes automatically.
  - **Data Partitioning:** Vector indexes support partition aliases for efficient, isolated data resolution across complex workspaces.
  - **Error Handling:** Typed `TotemError` subclasses unify error domains with actionable recovery hints for resilient operations.
- **Rule Architecture:**
  - **Curated Baselines:** Ships a curated 239-rule set with mandatory verify steps for execution determinism. Includes reverse-compiled lessons with manual patterns for zero-LLM enforcement.
  - **Quality Gates:** Validates authoring consistency with a lesson file linter backed by a pre-compilation gate.
  - **Agent Automation:** Agent skills are modularized with lean root routers for instruction files. Phase-gate hooks enforce validation before push and restore context after compaction.
  - **Severity Validation:** Compiled rules enforce strict severity levels. Errors actively block CI, while warnings inform without blocking.

**What gets committed:** Your knowledge base (text files in `.totem/lessons/`) and the compiled artifact (`.totem/compiled-rules.json`). The `.lancedb/` vector index is a local-only cache, automatically rebuilt by `totem sync`. It is never committed to your repository.

Built on the same architecture as elite AI assistants (Tree-sitter + LanceDB), but pointed at enforcement, not generation.

## Works With Everything

- **Editors:**
  - Cursor
  - Windsurf
  - GitHub Copilot
  - JetBrains Junie
- **Agents:**
  - Claude Code (with native `totem spec` and `totem lint` hooks)
  - Gemini CLI
  - Aider
- **Orchestrators:**
  - Anthropic
  - Google GenAI
  - OpenAI
  - Ollama (Local fallback via graceful degradation)
- **CI Integration:**
  - GitHub Actions (SARIF)
  - Any CI that runs Node

---

## Commands

| Command   | What it does                                               | Speed    |
| --------- | ---------------------------------------------------------- | -------- |
| `lint`    | Compiled rules against diff. Zero LLM.                     | ~2s      |
| `shield`  | AI-powered code review with knowledge retrieval.           | ~18s     |
| `explain` | Look up the lesson behind a violation.                     | instant  |
| `stats`   | The Trap Ledger — violations prevented, by category.       | instant  |
| `link`    | Share local knowledge and lessons between repositories.    | instant  |
| `compile` | Compile lessons + `.cursorrules` into deterministic rules. | ~5s/rule |
| `extract` | Learn from PR reviews.                                     | ~15s     |
| `spec`    | Pre-work briefing from knowledge base.                     | ~20s     |
| `sync`    | Build/update the vector index.                             | ~30s     |

Full reference: [CLI Reference Wiki](./docs/wiki/cli-reference.md)

# Troubleshooting

## Git Hooks

### Hooks not firing on Mac/Linux

If you clone a repository that was initialized on Windows and the git hooks fail to fire, Git may not recognize them as executable. The `chmod` permissions are often lost in translation between Windows and POSIX filesystems.

**Fix:**

```bash
chmod +x .git/hooks/pre-push .git/hooks/post-merge
```

This applies the execute permission that POSIX systems require. Windows users are unaffected — Git Bash executes hooks regardless of the permission bit.

### Hooks not firing with Husky

If your project uses Husky, Totem's `install-hooks.js` detects `.husky/` and skips direct `.git/hooks/` installation. Add Totem's hook commands to your Husky config instead:

```bash
# .husky/pre-push
pnpm exec totem lint
```

## Ollama

### Model not found errors

If `totem sync` or `totem shield` fails with "model not installed" when using Ollama, the required model hasn't been pulled yet.

**Fix:**

```bash
# For embeddings (default model)
ollama pull nomic-embed-text

# For orchestration (use whatever model you configured)
ollama pull gemma2:27b
```

## Embeddings

### Dimension mismatch after switching providers

If you switch embedding providers (e.g., from OpenAI 1536d to Gemini 768d), the existing `.lancedb` index becomes incompatible.

**Fix:**

```bash
rm -rf .lancedb
totem sync
```

This rebuilds the index from scratch with the new dimensions.

## Contributing

We welcome contributions. See `CONTRIBUTING.md` and the [Dev Onboarding Wiki](./docs/wiki/dev-environment-setup.md).

## License

Licensed under the Apache 2.0 License.
