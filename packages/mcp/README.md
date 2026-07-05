# @mmnto/mcp

MCP (Model Context Protocol) server for [Totem](https://github.com/mmnto-ai/totem), a persistent memory and context layer for AI coding agents. A stdio-based server that exposes a Totem project's knowledge index to any MCP-compatible agent. Installs the `totem-mcp` binary.

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

## Docs

- Repository: <https://github.com/mmnto-ai/totem>
- Setup guide: [docs/wiki/mcp-setup.md](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/mcp-setup.md)

Apache-2.0.
