## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** architecture, curated
**Pattern:** \b(latency|tokens?|duration|ms|count)\b\s\*\|\|
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** error

Avoid hardcoded fallbacks like 'main' for environmental configuration; throw an explicit error if the value cannot be detected.
