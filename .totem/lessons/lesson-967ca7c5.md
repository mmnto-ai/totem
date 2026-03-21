## Lesson — Subagents should be limited to mechanical implementation

**Tags:** architecture, agents, mcp

Subagents should be limited to mechanical implementation and testing while architectural decisions and MCP tool calls remain in the main controller. This is necessary because subagents typically lack the session history and tool access required to make high-level design decisions safely.
