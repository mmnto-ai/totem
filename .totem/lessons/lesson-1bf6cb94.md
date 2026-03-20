## Lesson — Standard console.log or console.error calls in MCP tools

**Tags:** style, curated
**Pattern:** \bconsole\.(log|error)\(
**Engine:** regex
**Scope:** packages/mcp/**/\*.ts, packages/mcp/**/_.js, !\*\*/_.test.ts, !**/\*.test.js
**Severity:\*\*\*\* warning

Standard console.log or console.error calls in MCP tools can corrupt the stdio transport protocol. Use dedicated loggers or return formatted system warnings instead.
