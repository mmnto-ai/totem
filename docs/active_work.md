# Active Work

## Current Focus: UX Polish & Ecosystem Expansion

**v0.7.0 published** — Phase 2 refactor + security hardening complete (118 tests passing).

Security hardening is done: terminal sanitization (#116), learn confirmation (#115), stale LanceDB handles (#106), embedder backoff (#105), streaming sync (#104).

### Active Tasks

1. **PR #118** — Stability hardening batch (#116, #106, #105, #104).

### Open PRs

- **#118** — `feat: stability hardening — sanitize, retry, backoff, streaming` (branch: `feat/stability-hardening`)

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

1. **#107 MCP progress events** for background sync visibility
2. **#108 Clean up orphaned temp files**
3. **#109 Condense context payloads** for fast-boot commands
4. **Epic #86 Seamless Host Integration** (Gemini/Claude extensions)
5. **#21 CLI UI/UX Polish** (adding `@clack/prompts` and spinners)
6. **#12 Cross-platform onboarding** (Windows/macOS docs)
