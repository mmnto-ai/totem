## Lesson — 2026-03-06T03:36:17.521Z

**Tags:** architecture, curated
**Pattern:** \.(where|delete)\s*\(\s*(?:'[^']*"[^"]+"[^']*'|"[^"]*\\"[^"]+\\"[^"]*"|`[^`]*"[^"]+"[^`]*`)\s*\)
**Engine:** regex
**Scope:** packages/core/**/*.ts, !**/*.test.ts
**Severity:** error

SQL WHERE/DELETE clauses must use parameterized queries, not string interpolation.
