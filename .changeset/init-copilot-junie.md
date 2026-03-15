---
'@mmnto/cli': minor
---

Add Copilot and Junie to totem init agent detection.

- **Init:** Auto-detect JetBrains Junie (`.junie/`) and GitHub Copilot (`.github/copilot-instructions.md`)
- **Init:** Correct Junie MCP path to `.junie/mcp/mcp.json` (was incorrectly using `.mcp.json`)
- **Init:** Copilot gets reflex injection only (no MCP — Copilot doesn't support it)
