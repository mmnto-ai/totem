## Lesson — When catching and re-logging errors that originate

**Tags:** style, curated
**Pattern:** (['"`])\[[^\]]+\].*?\b(err|error)\.message\b(?!.*\.replace)
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** warning

When catching and re-logging errors that originate.
