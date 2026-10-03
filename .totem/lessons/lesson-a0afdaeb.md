## Lesson — One registration function serves the server entry and the annotations test

**Tags:** mcp, testing
**Scope:** packages/mcp/**/*.ts, !**/*.test.*, !**/*.spec.*

The MCP server entry and the annotations test both call the same `registerTools()`, so the test walks the tools the server really registers. It replaced a textual drift guard that compared the source against a hand-kept list, which a review found a new tool could slip past (mmnto-ai/totem#3013).
