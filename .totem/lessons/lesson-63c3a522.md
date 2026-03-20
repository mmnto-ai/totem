## Lesson — Use path.relative(process.cwd(),

**Tags:** style, curated
**Pattern:** \.replace\(\s*process\.cwd\(\)
**Engine:** regex
**Scope:** **/*.ts, **/*.tsx, **/*.js, **/*.jsx
**Severity:** warning

Use path.relative(process.cwd(), path.resolve(process.cwd(), input)) instead of string replacement for robust path normalization
