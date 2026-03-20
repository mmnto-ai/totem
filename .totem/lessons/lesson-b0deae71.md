## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** security, curated
**Pattern:** \b(latency|tokens?|duration|ms|count)\b\s\*\|\|
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** error

Use nullish coalescing (??) instead of logical OR (||) for numeric metrics to prevent valid 0 values from triggering fallbacks.
