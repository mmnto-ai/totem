## Lesson — MCP tools should return plain-text for error paths

**Tags:** mcp, architecture

MCP tools should return plain-text for error paths to ensure compatibility with current clients, even when success paths are XML-wrapped. This deferred standardization avoids breaking existing client parsers.
