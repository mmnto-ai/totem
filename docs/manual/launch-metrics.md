## Why Totem

- **Zero-LLM enforcement.** Compiled rules run in your git hooks with no API keys, no network, no AI in the loop. Works in air-gapped CI and locked-down enterprise environments.
- **Shared memory across repos.** `totem link` connects repos to a shared knowledge index. A lesson learned in your API repo automatically protects your frontend repo. One memory across your whole stack.
- **Works with any AI agent.** Claude, Gemini, Cursor, Copilot, Codex — Totem doesn't care who writes the code. It just gates the push.

## How It Works — Sensors, Not Actuators

Totem provides the **sensors** — your codebase's immune system. You wire the **actuators**.

| What Totem Provides (Sensor)      | What You Wire (Actuator)     |
| --------------------------------- | ---------------------------- |
| `totem lint` — compiled rules     | Git pre-push hook            |
| `search_knowledge` — vector index | SessionStart hook, MCP tools |
| `totem review` — LLM analysis     | PreToolUse hook (optional)   |

Totem doesn't try to control the agent in real-time. It enforces a strict final output state — like a compiler, not a linter. The git hook runs `totem verify-manifest` and `totem lint` — stateless, deterministic, no LLM.

## Works Without AI

Totem's enforcement layer is **100% deterministic** — no LLM, no API keys, no network required.

| Feature                                 |  Requires AI?  |
| --------------------------------------- | :------------: |
| `totem lint` (compiled rules)           |       No       |
| `totem init` (baseline rules)           |       No       |
| Pre-push git hook                       |       No       |
| AST classification (Tree-sitter)        |       No       |
| `totem sync` (vector index)             | Yes (embedder) |
| `totem lesson compile` (rule authoring) |   Yes (LLM)    |
| `totem review` (AI review)              |   Yes (LLM)    |
| `totem spec` (planning)                 |   Yes (LLM)    |

The AI helps you **write** rules. The rules enforce themselves.

## Totem Mesh — Shared Memory Across Repos

Most governance tools are per-repo. Totem lets you connect repos into a shared knowledge mesh:

```bash
# In your frontend repo
totem link ../api-server
```

Now `totem spec` and `totem review` in your frontend repo can query lessons from your API repo. An architectural mistake in one codebase becomes a rule protecting all others.

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

`totem lint` runs **147 compiled rules in under 2 seconds** on a 7,400-line, 105-file PR. Zero LLM inference. Pure AST classification + regex matching.

| Metric         | Value                        |
| -------------- | ---------------------------- |
| Rules          | 147 (regex + AST + ast-grep) |
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
