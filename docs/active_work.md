# Active Work

## Current Focus: v0.6.0 Release & Architectural Hardening

We have successfully completed the core objectives for **Phase 1 Onboarding** (`totem init` UX polish) and **Phase 2 Stability** (Adapter pattern decoupling, path normalization, and a massive 103+ unit test audit).

Our immediate priority is to merge the Phase 2 refactor PR (#103) and **Publish Release v0.6.0**.

Following the release, we will pivot to hardening the architecture based on the findings from the Staff-Level Code Review, before moving on to Epic #86 (Seamless Host Integration).

### Active Tasks

1. **Merge PR #103** (Phase 2 Refactor & Test Audit) and publish `v0.6.0` to npm.
2. **#104 Stream chunks to LanceDB:** Fix the ingestion pipeline to prevent OOM crashes on large enterprise repos.
3. **#105 OpenAI Rate Limit Resilience:** Add exponential backoff to the embedder.
4. **#106 Fix Stale LanceDB Handles:** Update the MCP server to aggressively reconnect on any LanceDB search error, replacing the brittle regex heuristic.
5. **#107 MCP Sync Visibility:** Pipe the background `totem sync` child process logs to the LLM via MCP progress events.

## Dogfooding: Session Start Hooks

We dogfood Totem inside this monorepo but **do not** run `totem init` here (it would overwrite development configs with production templates). Native execution hooks must be configured manually and kept in sync with the scaffolding logic in `packages/cli/src/commands/init.ts`.

### Claude Code (`.claude/settings.local.json`)

Add a `hooks` section alongside existing permissions:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "node packages/cli/dist/index.js briefing",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

- `matcher: "startup"` fires only on new sessions (not resume/clear/compact)
- Stdout is injected as context visible to Claude
- Timeout is in seconds

### Gemini CLI (`.gemini/settings.json`)

Add a `hooks` section alongside existing MCP server config:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "name": "totem-briefing",
        "type": "command",
        "command": "node packages/cli/dist/index.js briefing",
        "timeout": 30000,
        "description": "Load Totem session briefing on startup"
      }
    ]
  }
}
```

- Timeout is in milliseconds
- Uses `GEMINI_PROJECT_DIR` env var for path resolution

### Important Notes

- Both configs are **gitignored** — they must be applied manually after a fresh clone.
- The hooks point to compiled `dist/index.js` — run `pnpm build` in the CLI package before starting an agent session.
- If the briefing command hangs (e.g., LLM API timeout), the agent startup may be delayed up to the configured timeout.

## Next Up

After the release and architectural hardening are complete, we will return to expanding the ecosystem:

1. **Epic #86 Seamless Host Integration** (Gemini/Claude extensions)
2. **#21 CLI UI/UX Polish** (adding `@clack/prompts` and spinners)
