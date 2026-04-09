## Lesson — Prefer non-blocking warnings over startup crashes

**Tags:** mcp, dx, architecture
**Scope:** packages/mcp/**/*.ts, !**/*.test.*

Crashing an MCP server on boot due to external dependency failures prevents access to all local tools. Surfacing errors as warnings during the first search call maintains server availability while alerting the agent to the failure.
