---
'@mmnto/cli': patch
'@mmnto/mcp': patch
---

Bug fixes: Gemini embedder dimension mismatch detection, shell orchestrator process leak on Windows.

- **MCP:** Detect embedding dimension mismatch on first query and return clear error message with fix instructions (rebuild index + restart MCP server)
- **CLI:** Fix shell orchestrator process leak on Windows — use `taskkill /T` to kill entire process tree on timeout instead of just the shell wrapper
- **CLI:** `totem demo` command for previewing spinner animations
