## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** style, curated
**Pattern:** \$\{\s*err\s*\}
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** warning

Avoid interpolating the raw 'err' object in template literals; use 'err.message' or 'err.stack' for informative logging.
