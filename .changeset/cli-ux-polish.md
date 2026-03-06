---
"@mmnto/cli": minor
"@mmnto/totem": minor
"@mmnto/mcp": minor
---

### CLI UX Polish

- **Branded CLI output** — All commands now display colored, tagged output via `picocolors` (cyan brand, green success, yellow warnings, red errors, dim metadata)
- **Ora spinners** — `totem sync` shows a TTY-aware spinner that gracefully falls back to static lines in CI/piped environments
- **ASCII banner** — `totem init` displays a branded Totem banner on startup
- **Colored Shield verdict** — `totem shield` now shows PASS in green and FAIL in red

### Custom Prompt Overrides

- **`.totem/prompts/<command>.md`** — Override the built-in system prompt for any orchestrator command (spec, shield, triage, briefing, handoff, learn) by placing a markdown file in your project
- **Path traversal protection** — Command names are validated against a strict regex pattern

### Multi-Argument Commands

- **`totem spec <inputs...>`** — Pass multiple issue numbers, URLs, or topics in a single invocation (max 5, deduplicated)
- **`totem learn <pr-numbers...>`** — Extract lessons from multiple PRs in one command with a single confirmation gate
