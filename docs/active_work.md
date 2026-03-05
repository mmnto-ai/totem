# Active Work

## Current Focus: Phase 1 Onboarding & Polish

We have completed Epic #19 (The Reflex Engine) and are now focused on polishing the "Magic" Onboarding experience (Phase 1) before shifting to core stability and safety.

### Active Tasks

1. **#89 UX Polish for `totem init`:** Fix double-prompting and print clean success summaries so developers trust the onboarding.
2. **Epic #86 Seamless Host Integration:** Expand beyond dogfooding to properly package Totem integration instructions, auto-scaffolding, and skills/custom commands for Gemini CLI, Claude Code, and Cursor.
3. **#21 CLI UI/UX Polish:** Swap generic `console.log` for `@clack/prompts` and `ora` spinners to make the CLI feel premium.

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

After the Phase 1 Onboarding polish is complete, we will move on to **Phase 2: Core Stability & Data Safety**. This includes:

1. #91 Normalize LanceDB paths (Windows backslash fixes)
2. #90 Refactor to `IssueAdapter` (decouple from GitHub)
3. #77 Test audit (backfill CLI unit tests)
4. #78 Shell escaping edge cases
