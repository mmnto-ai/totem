## Lesson — 2026-03-03T03:20:15.923Z

**Tags:** architecture, curated
**Pattern:** (\|\||\?\?)\s*['"]main['"]
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** error

Avoid hardcoded fallbacks like 'main' for environmental configuration; throw an explicit error if the value cannot be detected.
