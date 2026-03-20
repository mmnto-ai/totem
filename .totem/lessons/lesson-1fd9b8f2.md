## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** architecture, curated
**Pattern:** ^(?!._\b(await|return)\b)._?\.(index|upsert|persist|addDocument|deleteDocument)\s*\(
**Engine:** regex
**Scope:** \*\*/*tool*/\*\*/*.ts, **/tools/**/_.ts, packages/mcp/\*\*/_.ts, !**/\*.test.ts
**Severity:\*\* error

Always await side-effect operations like indexing during tool execution to provide the LLM with definitive success or failure confirmation.
