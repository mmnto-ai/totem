## Lesson — 2026-03-07T21:45:57.754Z

**Tags:** security, curated
**Pattern:** (^|\s)\$([a-zA-Z_0-9*@#?!\-]+\b|\{[a-zA-Z_0-9*@#?!\-]+\})
**Engine:** regex
**Scope:** _.sh, _.bash, _.yml, _.yaml
**Severity:** error

Always quote shell variables (e.g., "$VAR") to prevent word-splitting and argument injection.
