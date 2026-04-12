# Claude Code

Claude Code is the primary agent for depth execution and product management. It relies on a blend of project-level files and system directories.

## 1. Config Surfaces

- **Project Context:** `CLAUDE.md`. The primary source of instructions and project rules.
- **Project Settings:** `.claude/`. Contains workspace-specific configurations (e.g., `settings.local.json`).
- **Global Settings:** `~/.claude/`. Contains global user preferences.
- **Hooks:** Git hooks or tool-specific hooks.
- **MCP Servers:** `.mcp.json`. Defines MCP server commands and environment pass-through.

## 2. Keeping Configs Lean

Due to the compliance lesson (length kills compliance), `CLAUDE.md` must only contain critical development rules and the Totem AI Integration block. Avoid turning `CLAUDE.md` into a massive styleguide. Keep it under 32 lines if possible. Focus on the most important architectural constraints.

## 3. Totem Integration

Totem injects the `search_knowledge` instruction (the "Pull Before Coding" reflex) directly into `CLAUDE.md`. Because Claude uses `.mcp.json` to discover tools, ensure Totem's MCP server is properly registered there.

## 4. Common Pitfalls

- **Bloat:** Expanding `CLAUDE.md` beyond 32 lines drastically reduces adherence.
- **Secrets in `.mcp.json`:** Passing hardcoded API keys in `.mcp.json`. Always use `env` variables or shell inheritance instead.
