---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': patch
---

Agent config cleanup, shield ignorePatterns separation, and Junie support.

- **Shield:** `shieldIgnorePatterns` config field separates shield exclusions from sync indexing
- **Shield:** Deterministic shield now respects `ignorePatterns` from config
- **Core:** Export `matchesGlob` for shield file filtering
- **Init:** Fix Gemini CLI reflexFile path (`.gemini/gemini.md` → `GEMINI.md`)
- **Init:** Export `AI_PROMPT_BLOCK` for drift test consumption
- **MCP:** Replace empty catch blocks with `logSearch()` disk-based diagnostics
- **Config:** Add `shieldIgnorePatterns` to config schema
- **Junie:** Lean guidelines.md, correct MCP path (`.junie/mcp/mcp.json`), compiled rules as skill
- **Drift Tests:** 41-assertion config drift test suite guarding hooks, agent configs, MCP scaffolding, and secrets
