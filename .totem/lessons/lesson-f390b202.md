## Lesson — Junie requires specific file locations for auto-detection,

**Tags:** architecture, curated
**Pattern:** \.junie\/(?!mcp\/mcp\.json|guidelines\.md)[^'"\s>]+\.(json|md)
**Engine:** regex
**Scope:** **/\*.js, **/_.ts, \*\*/_.json, **/\*.md, **/_.sh, \*\*/_.yml, **/\*.yaml, .gitignore
**Severity:\*\*\*\* warning

Junie requires MCP configurations at .junie/mcp/mcp.json (gitignored) and tool-specific guidelines at .junie/guidelines.md.
