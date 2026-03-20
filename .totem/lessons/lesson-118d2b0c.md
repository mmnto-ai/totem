## Lesson — Centralize error signature detection (such as 429 status

**Tags:** style, curated
**Pattern:** (\.status\s*===?\s*429|['"]rate\s+limit['"])
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.sh
**Severity:** warning

Centralize error signature detection (such as 429 status.
