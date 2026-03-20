## Lesson — Sanitize user-provided text before persisting to files

**Tags:** security, curated
**Pattern:** \b(?:write|append)File(?:Sync)?\s*\(\s*['"][^'"]*\.(?:md|log)['"]\s*,\s*(?![^,]*\b(?:stripAnsi|sanitize|replace)\b)[^,)\s]+
**Engine:** regex
**Scope:** **/*.ts, **/*.js, **/*.tsx, **/*.jsx
**Severity:** error

Sanitize user-provided text before persisting to files.
