# Lesson

**Context:** Working locally within the Totem monorepo requires strict config hygiene to prevent drift and secrets leaks.
**Symptom:** Contributors might use the wrong package manager, accidentally bypass git hooks, or commit local API keys to tracked config files.
**Fix:**
### Development Environment Setup & Config Hygiene
We use `pnpm` exclusively (via `corepack`). Running `pnpm install` automatically triggers `prepare`, which installs git hooks via `tools/install-hooks.js`. Bypassing hooks risks breaking drift detection or background syncs.

Secrets: NEVER put secrets, tokens, or API keys in tracked config files. All secrets live ONLY in gitignored `.env` files at the root (e.g., `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`).

Config File Hygiene:
- Gitignored (DO NOT COMMIT): `.env`, `.mcp.json`, `.gemini/settings.json`, `.claude/settings.local.json`.
- Tracked (SAFE TO COMMIT): `CLAUDE.md`, `GEMINI.md`, `.gemini/config.yaml`, `.gemini/styleguide.md`.