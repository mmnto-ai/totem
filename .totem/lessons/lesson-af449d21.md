## Lesson — Model Context Protocol (MCP) tools should prioritize

**Tags:** mcp, architecture, error-handling

Model Context Protocol (MCP) tools should prioritize plain-text error signals over XML-wrapped structures when client compatibility requires it. Forcing consistent XML structures on error paths can break downstream MCP consumers that expect specific boolean flags or raw text.
