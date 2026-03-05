# Active Work

## Current Focus: Security Hardening & Stability

**v0.7.0 published** — Phase 2 refactor (unified gh-utils, PrAdapter, 103+ tests) shipped.

Our immediate priority is security hardening (#111 learn command prompt injection), followed by stability fixes and onboarding polish.

### Active Tasks

1. **PR #115** — Confirmation prompt for `learn` command (#111). Mitigates indirect prompt injection from untrusted PR comments.
2. **#106 Fix Stale LanceDB Handles:** Re-initialize store on error instead of brittle regex heuristic.
3. **#104 Stream chunks to LanceDB:** Fix the ingestion pipeline to prevent OOM crashes on large repos.
4. **#105 OpenAI Rate Limit Resilience:** Add exponential backoff to the embedder.

### Open PRs

- **#115** — `feat: add confirmation prompt to learn command` (branch: `feat/learn-confirmation`)
- **#114** — `docs: update README, roadmap, and lessons for v0.7.0` (branch: `chore/docs-update`)

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

After security hardening is complete, we will return to expanding the ecosystem:

1. **Epic #86 Seamless Host Integration** (Gemini/Claude extensions)
2. **#21 CLI UI/UX Polish** (adding `@clack/prompts` and spinners)
3. **#12 Cross-platform onboarding** (Windows/macOS docs)
