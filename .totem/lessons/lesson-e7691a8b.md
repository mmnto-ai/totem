## Lesson — 2026-03-06T10:00:40.352Z

**Tags:** architecture, curated
**Pattern:** console\.(log|info|dir|table)\s*\(
**Engine:** regex
**Scope:** packages/mcp/\*\*/*.ts, !**/\*.test.ts
**Severity:\*\*\*\* error

Route host hook output to stderr (console.error or console.warn) rather than stdout (console.log) to prevent AI tool pollution.
