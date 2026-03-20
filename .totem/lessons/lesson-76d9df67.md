## Lesson — 2026-03-06T06:25:26.036Z

**Tags:** performance, curated
**Pattern:** \$\{\s*err\s*\}
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx, !**/*.test.ts
**Severity:** warning

Use dynamic imports for heavy dependencies like 'ora' within the specific functions that require them to avoid startup performance tax.
