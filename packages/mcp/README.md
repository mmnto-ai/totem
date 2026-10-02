# @mmnto/mcp

MCP (Model Context Protocol) server for [Totem](https://github.com/mmnto-ai/totem), the local-first toolkit that keeps AI-agent work queryable, enforceable, and derivable as plain files in your codebase. A stdio-based server that exposes a Totem project's knowledge index to MCP-compatible agents. Installs the `totem-mcp` binary.

## Setup

Add it to your agent's MCP configuration (`npx` fetches it on demand):

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

On Windows, wrap the command: `"command": "cmd", "args": ["/c", "npx", "-y", "@mmnto/mcp"]`.

Requires Node >= 24 and a Totem-initialized project (`totem init` from [`@mmnto/cli`](https://www.npmjs.com/package/@mmnto/cli)).

## Tools

| Tool               | What it does                                                                                              |
| ------------------ | --------------------------------------------------------------------------------------------------------- |
| `search_knowledge` | Semantic search over the project's knowledge index (code, lessons, specs, session logs)                   |
| `add_lesson`       | Persist a lesson to `.totem/lessons/`; an incremental re-index runs automatically                         |
| `describe_project` | Structured JSON summary of project governance scope (rules, lessons, config tier, targets, hooks); no LLM |
| `verify_execution` | Run deterministic lint checks against current changes; returns PASS or FAIL with violations; zero LLM     |

### Tool annotations

Each tool declares three MCP hints explicitly, so a client never falls back to the schema's defaults (an absent `destructiveHint` or `openWorldHint` reads as `true`).

| Tool               | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
| ------------------ | -------------- | ----------------- | --------------- |
| `search_knowledge` | `true`         | `false`           | `false`         |
| `describe_project` | `true`         | `false`           | `false`         |
| `add_lesson`       | `false`        | `false`           | `false`         |
| `verify_execution` | `false`        | `false`           | `false`         |

- `search_knowledge` reads the project's index and its linked indexes and may start local `git` subprocesses; it reaches no network except that the query goes to the configured embedding provider, which may be a cloud API.
- `describe_project` reads config, local state and local `git` (local subprocesses, no network); `git status` may refresh git's own index cache.
- `add_lesson` writes a new lesson file under `.totem/lessons/` and then runs an incremental sync; it overwrites nothing.
- `verify_execution` is not read-only because the lint it spawns writes local state under `.totem/`: the rule metrics file on every run, the telemetry sink, a Trap Ledger event on a suppression, and `compiled-rules.json` on a pending pack promotion.

## Docs

- Repository: <https://github.com/mmnto-ai/totem>
- Setup guide: [docs/wiki/mcp-setup.md](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/mcp-setup.md)

Apache-2.0.
