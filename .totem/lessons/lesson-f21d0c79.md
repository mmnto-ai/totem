## Lesson — 2026-03-06T01:32:23.369Z

**Tags:** security, curated
**Pattern:** \bstripAnsi\s*\(|\.replace\(\s*\/\\(x1[bB]|u001[bB])
**Engine:** regex
**Scope:** packages/mcp/**/\*.ts, !**/\*.test.ts
**Severity:** error

Do not strip ANSI escapes or control characters from MCP tool output. LLMs benefit from the full fidelity of formatting and snippets; terminal sanitization is a CLI concern, not an MCP payload concern.
