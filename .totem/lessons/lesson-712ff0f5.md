## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** security, curated
**Pattern:** text:\s*(?!(?:formatXmlResponse|wrapXml|formatSystemWarning)\b|['"`\[\{]|err|error|message|text|undefined|null\b)\b\w+
**Engine:** regex
**Scope:** packages/mcp/\*\*/*.ts, !**/\*.test.ts
**Severity:\*\*\*\* error

MCP tool returns must be wrapped in XML tags (use formatXmlResponse) to prevent Indirect Prompt Injection from untrusted content.
