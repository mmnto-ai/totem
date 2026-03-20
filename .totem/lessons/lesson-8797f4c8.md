## Lesson — 2026-03-05T04:05:14.473Z

**Tags:** architecture, curated
**Pattern:** JSON\.parse\(.*(exec|spawn|stdout|stderr)
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts, !**/*.spec.ts
**Severity:** error

Do not JSON.parse raw stdout/stderr from child processes without error handling.
