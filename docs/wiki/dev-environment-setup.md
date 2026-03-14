# Dev Environment Setup

Welcome to the Totem project! This guide will walk you through setting up your local development environment.

## 1. Prerequisites & Package Manager

Totem uses `pnpm` exclusively (never `npm` or `yarn`). To ensure you're using the correct version of `pnpm` across the monorepo, we utilize `corepack`.

1. Enable corepack: `corepack enable`
2. Install dependencies: `pnpm install`

_Note: Running `pnpm install` will automatically trigger the `prepare` script, which installs git hooks._

## 2. Git Hooks

The project relies on git hooks to enforce rules and sync memory.

- The `tools/install-hooks.js` script runs during `pnpm prepare` and copies hooks from `tools/` into `.git/hooks/`.
- If you bypass hooks, you risk breaking drift detection or missing background syncs.

## 3. Managing Secrets (`.env`)

**NEVER put secrets, tokens, or API keys in tracked config files** (like `.mcp.json.example`, `.gemini/config.yaml`, etc.).

All secrets live ONLY in gitignored `.env` files. Agents and MCP servers inherit environment variables from the shell automatically.

Create a `.env` file at the root of the project:

```env
# Required for testing MCP and LLM orchestrators
OPENAI_API_KEY=your_key
ANTHROPIC_API_KEY=your_key
GITHUB_TOKEN=your_token
```

## 4. Config File Hygiene (Tracked vs Gitignored)

It's critical to know which agent configurations are checked into source control and which are local.

**Gitignored (DO NOT COMMIT):**

- `.env`
- `.mcp.json` (Local MCP server config)
- `.gemini/settings.json` (Local Gemini CLI UI/model preferences)
- `.claude/settings.local.json` (Local Claude Code preferences)

**Tracked (SAFE TO COMMIT):**

- `CLAUDE.md` (Project rules for Claude)
- `GEMINI.md` (Project rules for Gemini CLI)
- `.gemini/config.yaml` (GCA PR review settings)
- `.gemini/styleguide.md` (GCA review rules)

_Note: Always run `pnpm run format` before committing new files or modifications._

## 5. Building the Project

Totem is a monorepo managed by Turborepo.

To build all packages:

```bash
pnpm run build
```

Turborepo caches outputs, so subsequent builds will be fast if nothing changed.

## 6. Running Tests

Tests are co-located with their source files (`*.test.ts`) and run via Vitest.

- Run all tests across the monorepo: `pnpm run test`
- Run tests for a specific package (e.g., CLI): `pnpm -F @mmnto/cli test`
- Run tests in watch mode: `pnpm -F @mmnto/cli test --watch`
