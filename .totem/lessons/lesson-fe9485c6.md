## Lesson — 2026-03-03T01:52:20.000Z

**Tags:** style, curated
**Pattern:** \b(main|master)\.\.\.HEAD\b
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.sh
**Severity:** warning

Do not hardcode main...HEAD in git commands; use the configurable base branch.
