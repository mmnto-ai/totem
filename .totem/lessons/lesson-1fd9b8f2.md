## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** architecture, curated
**Pattern:** ^(?!.*\b(await|return)\b).*?\.(index|upsert|persist|addDocument|deleteDocument)\s*\(
**Engine:** regex
**Scope:** **/*tool*/**/*.ts, **/tools/**/*.ts, packages/mcp/**/*.ts, !**/*.test.ts
**Severity:** error

Always await side-effect operations like indexing during tool execution to provide the LLM with definitive success or failure confirmation.
