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

The hints are judged over the project's git-tracked content: a tool is read-only if it changes no git-tracked file, and additive-only if every tracked-file change is a new file. Writes to Totem's own local state under `.totem/` — the ledger directory, the logs (`.totem/*.jsonl`), the telemetry sink and the metrics cache (`temp/`, `cache/`), the sync lock, the index manifest and the pack files — and to the vector index store at the configured `lanceDir` (`.lancedb/` by default, and a linked repository's store when one is configured) do not count: that state is regenerable, never meant to be committed, and `totem init` ignores it, in bare mode too and, beside the default `.totem/`, for a configured `totemDir` that is a plain directory name (the repository root or another name is skipped with a summary row) (a project initialised by an earlier version has it untracked until it re-runs `totem init` or adds the lines; a project that already tracks one of those files keeps tracking it until it runs `git rm --cached` on it; an exact `!` line for one of these entries is the project's choice and that entry is not written over it). Git's own cache (the index a `git status` or `git diff` may refresh) does not count either. A tool that writes anywhere else is not read-only. A reader never rebuilds that store: on a store the engine cannot open, the store's connect throws a typed error that carries the cure (`totem sync --full` in that repository) and leaves the directory as it is; only a sync asks it to heal (mmnto-ai/totem#3009).

| Tool               | `readOnlyHint` | `destructiveHint` | `openWorldHint` |
| ------------------ | -------------- | ----------------- | --------------- |
| `search_knowledge` | `true`         | `false`           | `true`          |
| `describe_project` | `true`         | `false`           | `false`         |
| `add_lesson`       | `false`        | `false`           | `true`          |
| `verify_execution` | `false`        | `true`            | `false`         |

The two spawning tools (`add_lesson` and `verify_execution`) resolve Totem's CLI explicitly and start it with `node`, never through a shell, a package manager or `npx` (mmnto-ai/totem#3008). They look, in order, for the workspace build (`packages/cli/dist/index.js`, guarded on `packages/cli/package.json` naming `@mmnto/cli`), then the pinned install (`node_modules/@mmnto/cli/dist/index.js`), both walking up from the project root, then a global installed by npm in one of its two layouts on `PATH`, identity-checked against its own `package.json`. When none resolves, nothing is spawned: `verify_execution` returns `Verification: NOT RUN`, and `add_lesson`, which has already saved the lesson, reports its sync as failed, each with the places looked and the cure (add `@mmnto/cli` to the project, or `npm i -g @mmnto/cli`). A project whose CLI is reachable only through its package manager (Yarn Plug'n'Play, pnpm `node-linker=pnp`) and a global installed outside npm's two layouts (`pnpm add -g`, Volta) get that refusal; a `totem` found on `PATH` that cannot be verified as an npm-layout install of `@mmnto/cli` is named in it and not run. `verify_execution`'s result starts with a `CLI:` line naming the version and tier that ran, and `add_lesson`'s reply ends its sync sentence with the same label; when an unverified `totem` earlier on `PATH` was skipped in favour of an npm-layout global, the label says so.

- `search_knowledge` changes no tracked file. It reads the project's index and its linked indexes and may start local `git` subprocesses. It is open-world because the query goes to the configured embedding provider, which may be remote. Once the project context loads, every call writes a ledger `mcp_call` event; every call but a dimension-mismatch return appends to the search log `.totem/.search-log.jsonl` (error results included); a successful call also writes the selection manifest, and the corpus-query ledger event and its correlation pointer (all under `.totem/ledger/`). A search error reconnects the store; the reconnect never rebuilds it.
- `describe_project` changes no tracked file. It reads config, local state and local `git` (local subprocesses, no network, so closed-world); the rich-state `git status` read runs with `--no-optional-locks`, so it takes no index lock. Loading the project context connects the store and never rebuilds it.
- `add_lesson` adds a lesson file under `.totem/lessons/` (a tracked path; an 8-character content hash names it, and a collision would overwrite an existing lesson in place, since the write takes no exclusive flag), then spawns `totem sync --incremental`. The sync takes `.totem/sync.lock`, rewrites ignored index artifacts (`index-manifest.json`, `installed-packs.json`, `review-extensions.txt`), deletes index rows for changed files in the LanceDB store at the configured `lanceDir` (a store the engine cannot open is deleted and re-indexed in full by that sync, the one caller that asks the store to heal), writes `~/.totem/registry.json` outside the project, and embeds changed files through the configured embedding provider, which may be remote, so the tool is open-world.
- `verify_execution` is destructive: on a pending pack promotion the lint it spawns rewrites the tracked `compiled-rules.json` in place (not additive) and writes `verification-outcomes.json` (committable). On every run that evaluates rules it writes `.totem/cache/rule-metrics.json`, the telemetry sink `.totem/temp/telemetry.jsonl` and, on a suppression, a Trap Ledger event, all ignored. Its `git diff --name-only` may refresh git's own index cache. It is closed-world: the lint is local, and the tool spawns a resolved local or npm-global CLI entry with `node` and reaches no registry (mmnto-ai/totem#3008). Disclosed, not counted: the lint's `git` reads are local commands, and in a partial clone `git` itself may fetch missing objects from the checkout's own remote while diffing.

## Docs

- Repository: <https://github.com/mmnto-ai/totem>
- Setup guide: [docs/wiki/mcp-setup.md](https://github.com/mmnto-ai/totem/blob/main/docs/wiki/mcp-setup.md)

Apache-2.0.
