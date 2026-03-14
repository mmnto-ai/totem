---
'@mmnto/totem': minor
'@mmnto/cli': minor
'@mmnto/mcp': minor
---

Agent hooks, rule testing harness, multi-domain MCP, and docs migration.

- **CLI:** `totem test` command — TDD harness for compiled shield rules with pass/fail fixtures
- **CLI:** Agent hooks reinstated — Claude PreToolUse shield gate, Gemini SessionStart + BeforeTool
- **CLI:** Instruction file length enforcement (FR-C01, <50 lines)
- **Core:** `parseFixture()`, `testRule()`, `runRuleTests()` — rule testing engine
- **Core:** Export `matchesGlob` for shield file filtering
- **MCP:** `--cwd` flag for multi-domain knowledge architecture (strategy Totem)
- **MCP:** Robust `--cwd` validation with `[Totem Error]` prefix
- **Shield:** `shieldIgnorePatterns` config field (separate from sync ignorePatterns)
- **Shield:** Compiled rules respect ignorePatterns from config
- **Shield:** execSync rule scoped to exclude hook scripts
- **Shield:** Literal-file-path rule scoped to lesson files only (#457)
- **Docs:** README-to-wiki migration — marketing-lean README + 5 new wiki pages
- **Config:** Consumer hook templates use `--deterministic` shield
