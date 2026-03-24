# MCP Setup

The Model Context Protocol (MCP) server provides your AI agent with persistent project memory. It allows tools like Claude Code, Cursor, and Gemini to `search_knowledge` before writing code and `add_lesson` when discovering traps.

## Configuration

Add the following to your AI tool's MCP configuration file.

### macOS / Linux

```json
{
  "mcpServers": {
    "totem": {
      "command": "npx",
      "args": ["-y", "@mmnto/mcp"]
    }
  }
}
```

### Windows

```json
{
  "mcpServers": {
    "totem": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@mmnto/mcp"]
    }
  }
}
```

## Supported Tools

Works with any MCP-compatible agent, including:

- **Desktop Apps:** Claude Desktop.
- **Editors:** Cursor, Windsurf.
- **CLIs:** Claude Code, Gemini CLI.
