## Lesson — AI agent memory config architectures differ significantly

**Tags:** style, curated
**Pattern:** \.gemini/gemini\.md|\.mcp\.json|\bgemini\.md
**Engine:** regex
**Scope:** **/\*.json, **/_.yaml, \*\*/_.yml, **/\*.md, **/_.sh, .gemini/\*\*/_, .junie/**/\*, .github/workflows/**/\*
**Severity:** warning

AI agent configuration naming error. Use GEMINI.md (uppercase) for Gemini CLI, .gemini/config.yaml for GCA, or .junie/mcp/mcp.json for Junie. The files .gemini/gemini.md and .mcp.json are not supported.
