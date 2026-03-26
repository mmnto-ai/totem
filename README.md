# Totem

**Stop repeating yourself to your AI.**

_AI coding agents are brilliant goldfish. Totem gives them a memory._

A zero-config CLI and MCP Server that compiles your project's architectural rules into deterministic CI guardrails. It creates a persistent, model-agnostic context layer that outlasts any single AI session — so Claude, Cursor, Gemini, and Copilot all enforce the same rules without being told twice.

Totem doesn't ship with your app. It lives in your workflow. It also works on non-code repositories — docs, ADRs, infrastructure configs, personal notes — via `totem init --bare`.

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
| **Ensure**     | `pre-push` git hook → `totem lint`      | Deterministic gate. If the AI ignored Layer 1 and skipped Layer 2, it hits the wall of Layer 3 and cannot proceed until it complies. |

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

`totem lint` runs **305 compiled rules in under 2 seconds** on a 7,400-line, 105-file PR. Zero LLM inference. Pure AST classification + regex matching.

| Metric         | Value                        |
| -------------- | ---------------------------- |
| Rules          | 305 (regex + AST + ast-grep) |
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

## Capabilities

Totem is a two-part governance system: a probabilistic **Memory Layer** for AI agents, and a deterministic **Enforcement Compiler** for Git pipelines.

- **Execution & Enforcement:**
- Zero-LLM Enforcement: Rules compile into Tree-sitter AST and regular expressions for fast, offline execution without API keys or models.
- Editor Agnostic: Enforces boundaries at the Git layer (`pre-push`) to neutralize agent divergence across Cursor, Copilot, and Claude Code.
- Phase-Gate Warnings: Provides preflight commit warnings and blocks pushes if AST rule violations are detected.
- Graceful Degradation: AST query engines fail-closed to prevent swallowed exceptions and maintain CI stability.
- **Security & Compliance:**
- Air-Gapped Operation: Supports fully offline embedding via Ollama and local LLM execution.
- Secure Secret Redaction: Employs `safe-regex2` validation and Data Loss Prevention (DLP) masking to secure outbound LLM calls.
- Compliance Ready: Outputs standard SARIF 2.1.0 for native integration into GitHub Advanced Security and enterprise DORA dashboards.
- Provenance Verification: Utilizes compile manifest signing to establish a secure chain of custody.
- **Architecture & Extensibility:**
- Unified Findings Model: Outputs a standardized `TotemFinding` schema across both fast deterministic rules and AI shield reviews.
- Semantic Overrides: Uses `// totem-context: <reason>` to suppress rules deterministically while passing architectural intent to the AI layer.
- Live Metadata Sync: Employs invisible sync hooks for accurate orchestration context updates during active development.

## Capability Tiers

Totem's features fall into three tiers based on when — and whether — AI is involved:

| Tier        | Requires AI    | What you get                                                                                                                                 |
| ----------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| **Enforce** | No             | `totem lint` runs compiled regex/AST rules. Pre-push hook gates CI. Deterministic, offline, fast.                                            |
| **Learn**   | Yes (one-time) | `totem extract` + `totem compile` use an LLM to author rules. AI at authoring time only — compiled output is static JSON.                    |
| **Review**  | Yes (per-push) | `totem shield` sends diffs through the LLM pipeline (file classifier, hybrid diff filter, Zod-validated findings). Real-time, context-aware. |

The Enforce tier provides a deterministic boundary: **once rules compile, the AI is gone.** Projects that require strictly zero-LLM workflows can run the Enforce tier alone — no API keys, no network, no model.

## Example: Rule Compilation

Totem translates natural language constraints into explicit AST execution arrays.

**Input:** (`.totem/lessons/no-console.md`)

```markdown
## Lesson — Never use console.log

Tags: architecture
Always use the structured Pino logger instead of raw console.log.
```

**Output:** (`.totem/compiled-rules.json`)

```json
{
  "lessonHash": "a1b2c3d4",
  "lessonHeading": "Never use console.log",
  "pattern": "console\\.log",
  "message": "Use the structured Pino logger instead of console.log",
  "engine": "regex",
  "severity": "error",
  "compiledAt": "2026-03-24T00:00:00.000Z"
}
```

## Quickstart

### 1. Initialize Project

```bash
npx @mmnto/cli init
```

This scaffolds `totem.config.ts`, installs 23 foundational baseline rules, and ingests existing `.cursorrules` or `.mdc` files into the compilation pipeline.

### 2. Connect MCP (Optional)

The MCP server provides live read/write access to the vector index during active AI sessions.

**macOS / Linux (`mcp.json`):**

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

### 3. Compile and Enforce

```bash
npx @mmnto/cli sync # Build the local vector index
npx @mmnto/cli lint # Run compiled rules against staged/uncommitted files
```

During `init`, Totem installs standard bash hooks into `.git/hooks/` (or integrates with Husky) to block `git push` if AST rule violations are detected.

## Commands

<!-- docs COMMAND_TABLE -->

| Command           | Description                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `init`            | Initialize Totem in the current project                                          |
| `sync`            | Re-index project files into the local vector store                               |
| `search`          | Search the knowledge index                                                       |
| `stats`           | Show index statistics                                                            |
| `explain`         | Look up the lesson behind a compiled rule violation                              |
| `spec`            | Generate a pre-work spec briefing for GitHub issue(s) or topic(s)                |
| `lint`            | Run compiled rules against your diff (zero LLM, fast)                            |
| `shield`          | AI-powered code review: analyze your diff against Totem knowledge                |
| `triage-pr`       | Categorized triage view of bot review comments on a PR                           |
| `triage`          | Prioritize open issues into an active work roadmap                               |
| `handoff`         | Generate an end-of-session handoff snapshot for the next session                 |
| `add-lesson`      | Interactively add a lesson to project memory (or pass string as argument)        |
| `add-secret`      | Add a custom secret pattern to .totem/secrets.json (local, gitignored)           |
| `list-secrets`    | List all configured custom secrets (shared + local) with source labels           |
| `remove-secret`   | Remove a custom secret from .totem/secrets.json by index (from list-secrets)     |
| `compile`         | Compile lessons into deterministic regex rules for zero-LLM shield checks        |
| `verify-manifest` | Verify compiled-rules.json matches the compile manifest (CI gate)                |
| `test`            | Run test fixtures against compiled rules (TDD for governance rules)              |
| `extract`         | Extract lessons from PR review(s) into .totem/lessons/ (interactive cherry-pick) |
| `review-learn`    | Extract lessons from resolved bot review comments on a merged PR                 |
| `link`            | Link a neighboring repo into this project                                        |
| `eject`           | Remove all Totem hooks, config, and data from this project                       |
| `wrap`            | Post-merge workflow: learn from PR(s), sync index, then triage                   |
| `docs`            | Auto-update registered project docs using LLM synthesis                          |
| `lint-lessons`    | Validate lesson metadata (patterns, scopes, severity)                            |
| `drift`           | Check lessons for stale file references (CI gate)                                |
| `hooks`           | Install git hooks (pre-commit, pre-push, post-merge) non-interactively           |
| `doctor`          | Run workspace health diagnostics                                                 |

<!-- /docs -->

# Troubleshooting

Manually maintained content that `totem docs` must include in the wiki.
This file is the source of truth for troubleshooting notes — edit here, not in the generated wiki.

## Git Hooks

### Hooks not firing on Mac/Linux

If you clone a repository that was initialized on Windows and the git hooks fail to fire, Git may not recognize them as executable. The `chmod` permissions are often lost in translation between Windows and POSIX filesystems.

**Fix:**

<!-- docs CHMOD_HOOKS -->

```bash
chmod +x .git/hooks/pre-commit .git/hooks/pre-push .git/hooks/post-merge .git/hooks/post-checkout
```

<!-- /docs -->

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

## Documentation

- [Enforcement Model](./docs/wiki/enforcement-model.md) — 3-layer gate, what needs AI vs what doesn't
- [MCP Setup](./docs/wiki/mcp-setup.md) — all platforms
- [Cross-Repo Mesh](./docs/wiki/cross-repo-mesh.md) — linkedIndexes and partitions
- [CLI Reference](./docs/wiki/cli-reference.md)
- [Troubleshooting](./docs/wiki/troubleshooting.md)
- [Architecture](./docs/architecture.md)
- [Contributing](./CONTRIBUTING.md)

## License

Apache 2.0 License.
