---
"@mmnto/cli": minor
"@mmnto/mcp": patch
---

feat: seamless host integration — Gemini CLI & Claude Code hooks

- hookInstaller infrastructure in `totem init` with idempotent scaffoldFile/scaffoldClaudeHooks utilities
- Gemini CLI: SessionStart briefing hook, BeforeTool shield gate, Totem Architect skill
- Claude Code: PreToolUse hook for shield-gating git push/commit
- Cloud bot prompt refinement in AI_PROMPT_BLOCK for GCA integration
- Enhanced `search_knowledge` tool description
