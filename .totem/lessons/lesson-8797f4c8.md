## Lesson — 2026-03-05T04:05:14.473Z

**Tags:** architecture, curated
**Pattern:** JSON\.parse\(.*(exec|spawn|stdout|stderr)
**Engine:** regex
**Scope:** **/*.ts, **/*.js, !**/*.test.ts, !**/*.spec.ts
**Severity:** error

Extract the shared exec → JSON.parse → schema.validate pattern into a private helper method to avoid duplicating boilerplate in CLI adapters.
