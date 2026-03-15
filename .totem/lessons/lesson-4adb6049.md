## Lesson — Avoid inlining tokens or API keys in configuration files

**Tags:** security, configuration, environment

Avoid inlining tokens or API keys in configuration files like `.mcp.json` or `settings.json`. Agents and MCP servers automatically inherit environment variables from the parent shell, making gitignored `.env` files the appropriate location for credentials.
