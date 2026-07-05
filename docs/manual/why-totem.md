# Why Totem

AI coding agents lose context between sessions and repeat architectural mistakes. Most checks that would catch those mistakes put an LLM in the review path: slow, networked, non-deterministic. Totem splits the problem — LLMs help author rules and lessons, and enforcement runs as compiled rules with no LLM in the loop.

- **Zero-LLM enforcement.** Compiled rules run in your git hooks with no API keys, no network, no AI in the loop. Works in air-gapped CI and locked-down enterprise environments.
- **Shared memory across repos.** `totem link` connects repos to a shared knowledge index. A lesson recorded in your API repo is queryable from your frontend repo.
- **Agent-agnostic.** Claude, Gemini, Cursor, Copilot, Codex — Totem doesn't care who writes the code. It gates the push.

## Sensors, Not Actuators

Totem provides the **sensors**. You wire the **actuators**.

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

LLMs are used at rule-authoring time; enforcement runs without them.

## Totem Mesh — Shared Memory Across Repos

Repos can be linked into a shared knowledge index:

```bash
# In your frontend repo
totem link ../api-server
```

Now `totem spec` and `totem review` in your frontend repo can query lessons from your API repo.

Configure cross-repo queries in `totem.config.ts`:

```typescript
linkedIndexes: ['../api-server', '../shared-design-system'],
```

## Context Isolation — Scoped Search per Architecture Layer

When multiple AI agents (or one agent across packages) share a knowledge index, you can restrict search results to specific boundaries. This keeps backend context out of a frontend agent's search results.

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

Benchmark, measured when the compiled set held 147 rules: `totem lint` ran all of them in under 2 seconds on a 7,400-line, 105-file PR. Zero LLM inference. Pure AST classification + regex matching.

| Metric         | Value                        |
| -------------- | ---------------------------- |
| Rules          | 147 (regex + AST + ast-grep) |
| Lines scanned  | 7,397                        |
| Files          | 105                          |
| Execution time | **1.75s**                    |
| LLM calls      | **0**                        |

The rule set grows as lessons are compiled; as of 1.89.0 this repo carries 485 compiled rules, 394 of them non-archived.

This runs inside a `pre-push` git hook. The push is blocked until every violation is resolved; each finding reports the file, line, and fix guidance.

## Try It

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/mmnto-ai/totem-playground)

The [Totem Playground](https://github.com/mmnto-ai/totem-playground) is a pre-broken Next.js app with several common architectural violations. Open it in Codespaces, run `totem lint --staged`, and read what it reports.

Or run locally:

```bash
git clone https://github.com/mmnto-ai/totem-playground.git
cd totem-playground
git reset HEAD~1 && git add -A
npx @mmnto/cli lint --staged
```
