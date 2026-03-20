## Lesson — AI tool metadata must treat MCP-related fields as optional

**Tags:** architecture, curated
**Pattern:** \bmcp[a-zA-Z0-9_]_(?!\?)\s_:
**Engine:** regex
**Scope:** **/\*.ts, **/_.tsx, !\*\*/_.test.ts
**Severity:** warning

AI tool metadata must treat MCP-related fields as optional (use '?:') to accommodate agents like GitHub Copilot that lack Model Context Protocol capabilities.
