## Lesson — 2026-03-07T00:44:37.037Z

**Tags:** architecture, curated
**Pattern:** ^(?!.*\b(await|return)\b).*?\.(index|upsert|persist|addDocument|deleteDocument)\s*\(
**Engine:** regex
**Scope:** **/*tool*/**/*.ts, **/tools/**/*.ts, packages/mcp/**/*.ts, !**/*.test.ts
**Severity:** error

LanceDB operations (index, upsert, persist) must be awaited to prevent silent data loss.
