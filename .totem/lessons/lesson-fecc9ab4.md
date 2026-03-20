## Lesson — MCP session lifecycle limitation

**Tags:** architecture, curated
**Pattern:** session\.(start|end)|beforeDisconnect
**Engine:** regex
**Scope:** packages/mcp/**/*.ts
**Severity:** error

The MCP spec lacks session lifecycle hooks (session.start, session.end, or beforeDisconnect). Do not attempt to build auto-handoff via MCP code; use agent system prompts as a workaround (see #383).
