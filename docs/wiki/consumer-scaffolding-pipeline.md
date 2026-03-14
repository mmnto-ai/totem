# Consumer Scaffolding Pipeline (`totem init`)

The `totem init` command is the entry point for integrating a repository with Totem. It automatically detects installed AI agents, scaffolds necessary MCP configurations, and injects the "Pull Before Coding" reflexes into agent instruction files.

This document explains the internals of that pipeline.

## 1. The `AI_TOOLS` Array

The core of the scaffolding logic is driven by the `AI_TOOLS` array. Each entry defines how Totem integrates with a specific AI tool.

Key fields:

- `mcpPath`: The expected location of the tool's MCP configuration file (e.g., `.mcp.json`).
- `reflexFile`: The path where the `AI_PROMPT_BLOCK` should be injected (e.g., `CLAUDE.md`, `GEMINI.md`).
- `serverEntry`: The command/args object to inject into the config (e.g., `{ command: "npx", args: ["-y", "@mmnto/mcp"] }`).
- `hookInstaller`: Optional logic to install tool-specific hooks (like `SessionStart.js` for Gemini CLI).

_(Note: GitHub Copilot and JetBrains Junie are being added to this array, though their integration mechanisms differ slightly)._

## 2. Detection (`detectAiTools()`)

The `detectAiTools()` function scans the workspace to determine which agents the developer uses. It looks for existence of:

- Tool-specific directories (`.claude/`, `.gemini/`, `.junie/`)
- Tool-specific instruction files (`CLAUDE.md`, `GEMINI.md`)
- Existing MCP configs

## 3. Scaffolding MCP Configs (`scaffoldMcpConfig()`)

When setting up MCP, `scaffoldMcpConfig()` employs a **merge vs create** strategy.

- If an MCP config file (like `.mcp.json`) already exists, it reads the JSON, merges the Totem server entry into the `mcpServers` object, and writes it back safely without destroying other server configs.
- If it doesn't exist, it creates a new file with the Totem server pre-configured.

## 4. The Reflex Block (`AI_PROMPT_BLOCK`)

The `AI_PROMPT_BLOCK` contains the critical "Pull Before Coding" instructions and memory reflexes.

- It is injected into files like `CLAUDE.md` and `GEMINI.md`.
- It uses a `REFLEX_VERSION` sentinel (e.g., `<!-- totem:reflexes:version:1 -->`).
- **Upgrade Path:** When the core prompt strategy improves, we bump `REFLEX_VERSION`. The CLI can detect outdated blocks and safely overwrite them between the `REFLEX_START` and `REFLEX_END` markers without touching user-added instructions below it.

## 5. Cross-Platform Executables (`buildNpxCommand()`)

Because MCP servers are executed as child processes, `buildNpxCommand()` ensures cross-platform compatibility:

- On Windows: Uses `cmd /c npx`
- On Unix: Uses `npx`
  This prevents spawn `ENOENT` errors when AI agents attempt to spin up the Totem MCP server on Windows machines.

## 6. Hook Installation

`totem init` handles git hook installation:

- **Interactive:** Prompts the user to install hooks during `totem init`.
- **Non-interactive:** Can be bypassed or run directly via `totem hooks` in CI/CD pipelines.

## 7. Guarding Against Drift (`config-drift.test.ts`)

To ensure that internal Totem developers adhere to the same rules we ship to consumers, we run `config-drift.test.ts` in CI.

- It asserts that `CLAUDE.md` and `GEMINI.md` in our repo contain the `search_knowledge` instruction and shared foundational project rules, rather than enforcing an exact block match (allowing our internal `CLAUDE.md` to remain exceptionally lean).
- If an engineer tweaks the prompt in their local `CLAUDE.md` but forgets to update `init.ts`, the test fails, preventing divergence.
