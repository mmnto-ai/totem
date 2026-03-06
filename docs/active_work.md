# Active Work

## Current Focus: v0.8.0 Release

**v0.7.0 published** — Phase 2 refactor + security hardening complete (132 tests passing).

### Recently Merged

- **PR #142** — Gemini CLI & Claude Code seamless host integration hooks (#138, #139, #140)
- **PR #133** — Custom prompt overrides (#120) + multi-arg spec/learn (#117)
- **PR #134** — Recovered roadmap/strategy docs

### In Progress

- **#21 CLI UI/UX Polish** — Branded colors (picocolors), ora spinners, ASCII banner (branch: `feat/cli-ux-polish`)

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

1. **Publish v0.8.0** after #21 merges
2. **#12 Cross-platform onboarding** (Windows/macOS docs)
3. **#107 MCP progress events** for background sync visibility
4. **#126 Epic: Gamification** (streak tracking, achievement badges)
5. **#143 `totem wrap` command** to chain post-merge workflow
