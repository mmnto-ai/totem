# JetBrains Junie

Junie is JetBrains' integrated AI assistant, operating directly inside IDEs like IntelliJ or WebStorm.

## 1. Config Surfaces

- **Project Context:** `.junie/guidelines.md` — Instructions and rules specifically for the Junie assistant.
- **MCP Servers:** `.mcp.json` — JetBrains IDEs are adding support for MCP, allowing Junie to interface with local tools.

## 2. Keeping Configs Lean

As with all agents, `.junie/guidelines.md` should be strictly focused and concise to ensure Junie complies with core directives without being overwhelmed by boilerplate.

## 3. Totem Integration

Once MCP is fully configured via `.mcp.json`, Junie can leverage the `search_knowledge` tool similarly to Claude and Gemini CLI. The instructions in `.junie/guidelines.md` should instruct Junie to query the Totem DB before significant refactors.

## 4. Common Pitfalls

- **Path Conflicts:** Forgetting to register Totem's MCP server in the correct `.mcp.json` format expected by JetBrains.
- **Hardcoded Secrets:** Storing API keys in `.mcp.json` instead of relying on the environment.
