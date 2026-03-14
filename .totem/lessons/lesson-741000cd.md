<!-- totem-ignore-file — config paths are the subject matter -->

## Lesson — NEVER inline secrets, tokens, or API keys into agent config

**Tags:** security, secrets, agent-config, mcp, init, trap

NEVER inline secrets, tokens, or API keys into agent config files (.mcp.json, .gemini/settings.json, MCP server configs, etc.). AI agents pattern-match against MCP server documentation examples that show inline tokens — this is how PATs end up hardcoded in config files. Secrets must live ONLY in gitignored `.env` files. Agents and MCP servers inherit environment variables from the shell automatically via process.env — no explicit `env` blocks needed in config files.
