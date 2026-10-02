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

The hints are judged over the project's git-tracked content: a tool is read-only if it changes no git-tracked file of the project, and additive-only if every tracked-file change is a new file. Writes to ignored Totem artifacts (ledger, logs, telemetry, metrics cache, the index manifest) and to git's own cache are disclosed per tool below, not encoded in the hints.

| Tool               | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
| ------------------ | -------------- | ----------------- | --------------- |
| `search_knowledge` | `true`         | `false`           | `false`         |
| `describe_project` | `true`         | `false`           | `false`         |
| `add_lesson`       | `false`        | `false`           | `false`         |
| `verify_execution` | `false`        | `true`            | `false`         |

Both spawning tools (`add_lesson` and `verify_execution`) fall back to `npx totem …` when no local CLI resolves, which may fetch the CLI from the npm registry.

- `search_knowledge` changes no tracked file. It reads the project's index and its linked indexes and may start local `git` subprocesses; the query goes to the configured embedding provider, which may be a cloud API. Every call writes under ignored paths: a ledger `mcp_call` event, the search log `.totem/.search-log.jsonl`, the selection manifest and the corpus-query correlation pointer (both under `.totem/ledger/`).
- `describe_project` changes no tracked file. It reads config, local state and local `git` (local subprocesses, no network); the rich-state `git status` read runs with `--no-optional-locks`, so it takes no index lock.
- `add_lesson` adds a lesson file under `.totem/lessons/` (a tracked path; the file name is a content hash), then spawns `totem sync --incremental`, which rewrites ignored index artifacts (`index-manifest.json`, `installed-packs.json`, `review-extensions.txt`), deletes index rows for changed files, and embeds changed files through the configured embedding provider, which may be a cloud API.
- `verify_execution` is destructive: on a pending pack promotion the lint it spawns rewrites the tracked `compiled-rules.json` in place (not additive) and writes `verification-outcomes.json`. On every run that evaluates rules it writes `.totem/cache/rule-metrics.json`, the telemetry sink `.totem/temp/telemetry.jsonl` and, on a suppression, a Trap Ledger event, all ignored.

## Docs

- Repository: <https://github.com/mmnto-ai/totem>
- Setup guide: [docs/wiki/mcp-setup.md](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/mcp-setup.md)

Apache-2.0.
