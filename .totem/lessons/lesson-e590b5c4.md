## Lesson — 2026-03-08T00:11:33.219Z

**Tags:** architecture, curated
**Pattern:** process\.env\.[A-Z0-9_]+\s*(?:!==|!=)\s*(?:undefined|null|['"]['"])
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** error

Environment variable checks must validate non-whitespace content, not just undefined/null.
