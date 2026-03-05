# Active Work

## Current Focus: The Reflex Engine

We are currently focusing on the **Reflex Engine** (Epic #19).

Our goal is to ensure that a user who installs Totem does not have to spend 20 minutes coaxing their AI to use the tools.

### Active Tasks

1. Upgrading `totem init` to auto-inject System Prompts into `CLAUDE.md`, `.gemini/gemini.md`, etc.
2. Automating git hooks so `totem sync` runs in the background.

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

After the Reflex Engine is robust, we will begin porting the workflow commands (`totem spec`, `totem shield`) for Epic #20 (The Workflow Orchestrator).
