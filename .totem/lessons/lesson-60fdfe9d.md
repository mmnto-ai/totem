## Lesson — CLAUDE.md compliance experiment (2026-03-14) proved

**Tags:** compliance, claude-md, mcp, agent-config, trap, experiment

CLAUDE.md compliance experiment (2026-03-14) proved that verbose project memory files suppress MCP tool usage. A 325-line CLAUDE.md with architecture docs, naming tables, and feature descriptions caused Claude Code to never call search_knowledge despite a BLOCKING instruction at line 288. An empty CLAUDE.md also failed — the MCP tool description alone is insufficient. A lean CLAUDE.md (~40 lines) with a concise instruction using the full MCP tool name (mcp**totem-dev**search_knowledge) works reliably. Key rules: keep agent config files lean, use full MCP tool names, don't describe tools as features (it makes the agent think it's reading documentation instead of instructions). This applies to all agent config files, not just CLAUDE.md.
