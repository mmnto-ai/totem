# JetBrains Junie

Junie is JetBrains' AI coding agent, available as an IDE plugin and a standalone CLI.

## 1. Config Surfaces

- **Project Context:** `.junie/guidelines.md` (or `.junie/AGENTS.md`). Instructions loaded into every prompt. Keep the file within the instruction-file length limits (FR-C01) to reduce quota burn.
- **MCP Servers:** `.junie/mcp/mcp.json`. Project-level MCP config. **Not** `.mcp.json` at project root.
- **Global MCP:** `~/.junie/mcp/mcp.json`. User-level MCP servers.
- **Skills:** `.junie/skills/<name>/SKILL.md`. Task-specific knowledge loaded on demand (progressive disclosure, not injected into every prompt).
- **No global guidelines.** Unlike Claude/Gemini, Junie has no `~/.junie/guidelines.md`. Only project-level.

## 2. Keeping Configs Lean

Guidelines are injected into every prompt, so length directly impacts quota usage. JetBrains recommends keeping them short: "50 lines vs 100 lines won't make much difference, 100 vs 1000 will." This matches our lean CLAUDE.md approach.

For compiled rules (which can be large), use a Junie **skill** instead of stuffing them into guidelines. Skills use progressive disclosure. Junie only loads them when the task matches the skill description.

## 3. Totem Integration

- **Guidelines:** `.junie/guidelines.md` contains the `search_knowledge` instruction (same content as CLAUDE.md/GEMINI.md)
- **MCP:** `.junie/mcp/mcp.json` wires the Totem MCP server for `search_knowledge` and `add_lesson`
- **Compiled Rules Export:** `totem compile --export` writes to `.junie/skills/totem-rules/rules.md` (configured in `totem.config.ts` exports)

## 4. Common Pitfalls

- **Wrong MCP path:** Junie uses `.junie/mcp/mcp.json`, NOT `.mcp.json`. The project root `.mcp.json` is for Claude Code.
- **Guidelines bloat:** Don't dump compiled rules into `guidelines.md`. Use a skill instead. 100KB of rules in guidelines burns massive quota on every prompt.
- **Hardcoded secrets:** Never put tokens in `.junie/mcp/mcp.json`. Junie inherits env vars from the shell.
