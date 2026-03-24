# Totem

**Stop repeating yourself to your AI.**

_AI coding agents are brilliant goldfish. Totem gives them a memory._

A zero-config CLI and MCP Server that compiles your project's architectural rules into deterministic CI guardrails. It creates a persistent, model-agnostic context layer that outlasts any single AI session — so Claude, Cursor, Gemini, and Copilot all enforce the same rules without being told twice.

Totem doesn't ship with your app. It lives in your workflow. It also works on non-code repositories — docs, ADRs, infrastructure configs, personal notes — via `totem init --bare`.

## Capabilities

Totem is a two-part governance system: a probabilistic **Memory Layer** for AI agents, and a deterministic **Enforcement Compiler** for Git pipelines.

- **Zero-LLM Enforcement:** Rules compile into Tree-sitter AST and regular expressions. `totem lint` executes in <2 seconds without API keys, network access, or an LLM.
- **Air-Gapped Operation:** Supports fully offline embedding via Ollama and local LLM execution.
- **Cross-Repository Mesh:** Use `totem link` to share compiled invariants across multiple codebases.
- **Editor Agnostic:** Enforces boundaries at the Git layer (`pre-push`), neutralizing agent divergence regardless of whether code was written by Cursor, Copilot, or Claude Code.
- **Compliance Ready:** Outputs standard SARIF 2.1.0 for native integration into GitHub Advanced Security and enterprise DORA dashboards.

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

This scaffolds `totem.config.ts` and ingests existing `.cursorrules` or `.mdc` files into the compilation pipeline.

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
npx @mmnto/cli sync    # Build the local vector index
npx @mmnto/cli lint    # Run compiled rules against staged/uncommitted files
```

During `init`, Totem installs standard bash hooks into `.git/hooks/` (or integrates with Husky) to block `git push` if AST rule violations are detected.

## Try It

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/mmnto-ai/totem-playground)

Pre-broken Next.js app with architectural violations. Open in Codespaces, run `totem lint --staged`, watch it catch every one.

## Works Without AI

The AI helps you **write** rules. The rules enforce themselves.

| Feature                          | Requires AI? |
| -------------------------------- | :----------: |
| `totem lint` (compiled rules)    |      No      |
| `totem init` (baseline rules)    |      No      |
| Pre-push git hook                |      No      |
| AST classification (Tree-sitter) |      No      |
| `totem sync` (vector index)      |   Embedder   |
| `totem compile` (rule authoring) |     LLM      |
| `totem shield` (AI review)       |     LLM      |
| `totem spec` (planning)          |     LLM      |

---

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
| `triage`          | Prioritize open issues into an active work roadmap                               |
| `handoff`         | Generate an end-of-session handoff snapshot for the next session                 |
| `add-lesson`      | Interactively add a lesson to project memory (or pass string as argument)        |
| `compile`         | Compile lessons into deterministic regex rules for zero-LLM shield checks        |
| `verify-manifest` | Verify compiled-rules.json matches the compile manifest (CI gate)                |
| `test`            | Run test fixtures against compiled rules (TDD for governance rules)              |
| `extract`         | Extract lessons from PR review(s) into .totem/lessons/ (interactive cherry-pick) |
| `link`            | Link a neighboring repo into this project                                        |
| `eject`           | Remove all Totem hooks, config, and data from this project                       |
| `wrap`            | Post-merge workflow: learn from PR(s), sync index, then triage                   |
| `docs`            | Auto-update registered project docs using LLM synthesis                          |
| `lint-lessons`    | Validate lesson metadata (patterns, scopes, severity)                            |
| `drift`           | Check lessons for stale file references (CI gate)                                |
| `hooks`           | Install git hooks (pre-commit, pre-push, post-merge) non-interactively           |

<!-- /docs -->

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
